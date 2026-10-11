import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { isEmptyEvent } from "../src/model/event.js";
import { getEvent, getActivePattern, isAnyTrackSoloed } from "../src/model/query.js";
import {
  setEventField,
  clearEvent,
  setTrackChannelMuted,
  setTrackChannelSolo,
  setTrackChannelVolume,
  setActivePatternIndex,
  setPatternRowCount,
} from "../src/model/mutations.js";
import { noteNumberToName, parseNoteName, toHex } from "../src/model/notes.js";

describe("createSong", () => {
  it("builds the MVP shape: 4 banks, 8 tracks, 64 rows, independent pattern lists per bank", () => {
    const song = createSong();
    expect(song.banks).toHaveLength(4);
    expect(song.trackChannels).toHaveLength(8);
    expect(song.banks[0].patterns).not.toBe(song.banks[1].patterns);
    expect(song.banks[0].patterns[0].tracks).toHaveLength(8);
    expect(song.banks[0].patterns[0].tracks[0].events).toHaveLength(64);
  });

  it("starts every cell empty", () => {
    const song = createSong();
    const event = getEvent(song, 0, 0, 0, 0);
    expect(isEmptyEvent(event)).toBe(true);
  });
});

describe("mutations", () => {
  it("setEventField mutates only the targeted cell", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 2, rowIndex: 5 }, "note", 60);
    expect(getEvent(song, 0, 0, 2, 5).note).toBe(60);
    expect(isEmptyEvent(getEvent(song, 0, 0, 2, 6))).toBe(true);
  });

  it("clearEvent resets a cell to empty", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    clearEvent(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 });
    expect(isEmptyEvent(getEvent(song, 0, 0, 0, 0))).toBe(true);
  });

  it("track channel mute/solo/volume persist independently of pattern switches", () => {
    const song = createSong();
    setTrackChannelMuted(song, 1, true);
    setTrackChannelSolo(song, 2, true);
    setTrackChannelVolume(song, 3, 0.5);
    expect(song.trackChannels[1].muted).toBe(true);
    expect(isAnyTrackSoloed(song)).toBe(true);
    expect(song.trackChannels[3].volume).toBe(0.5);

    setActivePatternIndex(song, 0, 0); // no-op, only one pattern exists for bank 0 by default
    expect(song.trackChannels[1].muted).toBe(true);
  });

  it("setActivePatternIndex only accepts an index that exists", () => {
    const song = createSong();
    setActivePatternIndex(song, 0, 5); // out of range — bank 0 has 1 pattern by default
    expect(song.banks[0].activePatternIndex).toBe(0);
  });
});

describe("setPatternRowCount", () => {
  it("growing a pattern preserves existing notes and appends empty rows", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 10 }, "note", 60);

    setPatternRowCount(song, 0, 0, 96);

    const pattern = getActivePattern(song, 0);
    expect(pattern.rowCount).toBe(96);
    expect(pattern.tracks[0].events).toHaveLength(96);
    expect(pattern.tracks[0].events[10].note).toBe(60);
    expect(isEmptyEvent(pattern.tracks[0].events[64])).toBe(true);
  });

  it("shrinking a pattern drops notes past the new boundary and keeps the rest", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 5 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 40 }, "note", 62);

    setPatternRowCount(song, 0, 0, 16);

    const pattern = getActivePattern(song, 0);
    expect(pattern.rowCount).toBe(16);
    expect(pattern.tracks[0].events).toHaveLength(16);
    expect(pattern.tracks[0].events[5].note).toBe(60);
  });

  it("is a no-op when the new row count matches the current one", () => {
    const song = createSong();
    setPatternRowCount(song, 0, 0, 64);
    expect(getActivePattern(song, 0).rowCount).toBe(64);
  });
});

describe("getActivePattern", () => {
  it("resolves the bank's currently active pattern", () => {
    const song = createSong();
    const pattern = getActivePattern(song, 0);
    expect(pattern).toBe(song.banks[0].patterns[0]);
  });
});

describe("notes", () => {
  it("round-trips note numbers through display names", () => {
    expect(noteNumberToName(60)).toBe("C-4");
    expect(noteNumberToName(61)).toBe("C#4");
    expect(parseNoteName("C-4")).toBe(60);
    expect(parseNoteName("C#4")).toBe(61);
    expect(parseNoteName(noteNumberToName(72))).toBe(72);
  });

  it("noteNumberToName/parseNoteName handle empty input", () => {
    expect(noteNumberToName(null)).toBe("---");
    expect(parseNoteName("---")).toBe(null);
    expect(parseNoteName(null)).toBe(null);
  });

  it("toHex formats and pads", () => {
    expect(toHex(127)).toBe("7F");
    expect(toHex(1)).toBe("01");
    expect(toHex(null)).toBe("--");
  });
});
