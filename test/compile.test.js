import { describe, expect, it } from "vitest";
import { compileEvent, compileRow, noteDurationSteps } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";
import { getActivePattern } from "../src/model/query.js";

function makeInstruments() {
  return [createInstrumentSlot({ id: 0, name: "Kick", sampleId: 1, rootNote: 60 })];
}

describe("compileEvent", () => {
  it("returns null for an empty event", () => {
    const song = createSong();
    const event = getActivePattern(song, 0).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeInstruments())).toBe(null);
  });

  it("returns null when the owning track channel is muted", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[0].muted = true;
    const event = getActivePattern(song, 0).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeInstruments())).toBe(null);
  });

  it("returns null when the instrument has no sample assigned", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getActivePattern(song, 0).tracks[0].events[0];
    const emptyInstruments = [createInstrumentSlot({ id: 0, sampleId: null })];
    expect(compileEvent(event, song.trackChannels[0], emptyInstruments)).toBe(null);
  });

  it("maps note-relative-to-rootNote into a semitone pitch offset and scales gain by velocity/volume/instrument gain", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 67); // 7 semitones above rootNote 60
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "velocity", 64);
    song.trackChannels[0].volume = 0.5;
    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60, gain: 2 })];
    const event = getActivePattern(song, 0).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], instruments, 1.25, 0.5);

    expect(compiled.sampleId).toBe(1);
    expect(compiled.pitch).toBe(7);
    expect(compiled.gain).toBeCloseTo((64 / 127) * 0.5 * 2);
    expect(compiled.time).toBe(1.25);
    expect(compiled.duration).toBe(0.5);
  });

  it("omits time/duration when not given (preview/audition use)", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getActivePattern(song, 0).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled).not.toHaveProperty("time");
    expect(compiled).not.toHaveProperty("duration");
  });
});

describe("noteDurationSteps", () => {
  it("holds until the next non-empty note on the same track", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 4 }, "note", 62);
    const track = getActivePattern(song, 0).tracks[0];
    expect(noteDurationSteps(track, 0)).toBe(4);
  });

  it("falls back to a 1-step default when no further note exists", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 60 }, "note", 60);
    const track = getActivePattern(song, 0).tracks[0];
    expect(noteDurationSteps(track, 60)).toBe(1);
  });

  it("an explicit Event.length overrides the scan-to-next-note behavior", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 4 }, "note", 62);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "length", 2);
    const track = getActivePattern(song, 0).tracks[0];
    expect(noteDurationSteps(track, 0)).toBe(2);
  });
});

describe("compileRow", () => {
  it("drops events on muted tracks and tracks excluded by another track's solo", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 1, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 1, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[2].solo = true; // soloing track 2 (silent, no event) should mute tracks 0 and 1

    const instruments = new Array(8).fill(null).map((_, i) => createInstrumentSlot({ id: i, sampleId: 1 }));
    const pattern = getActivePattern(song, 0);

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 0, 0.25);
    expect(events).toHaveLength(0);
  });

  it("compiles every unmuted, non-excluded track's event at a row", () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 3, rowIndex: 0 }, "note", 48);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 3, rowIndex: 0 }, "instrument", 1);

    const instruments = [
      createInstrumentSlot({ id: 0, sampleId: 1 }),
      createInstrumentSlot({ id: 1, sampleId: 2 }),
    ];
    const pattern = getActivePattern(song, 0);

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 2.0, 0.25);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sampleId).sort()).toEqual([1, 2]);
    expect(events.every((e) => e.time === 2.0)).toBe(true);
  });
});
