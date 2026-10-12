import { describe, expect, it } from "vitest";
import { compileEvent, compileRow, compileRowFx, noteDurationSteps } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField, setTrackLength, setCellFxParam, addTrackFx } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";

function makeInstruments() {
  return [createInstrumentSlot({ id: 0, name: "Kick", sampleId: 1, rootNote: 60 })];
}

describe("compileEvent", () => {
  it("returns null for an empty event", () => {
    const song = createSong();
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeInstruments())).toBe(null);
  });

  it("returns null when the owning track channel is muted", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[0].muted = true;
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeInstruments())).toBe(null);
  });

  it("returns null when the instrument has no sample assigned", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const emptyInstruments = [createInstrumentSlot({ id: 0, sampleId: null })];
    expect(compileEvent(event, song.trackChannels[0], emptyInstruments)).toBe(null);
  });

  it("maps note-relative-to-rootNote into a semitone pitch offset and scales gain by velocity/volume/instrument gain", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 67); // 7 semitones above rootNote 60
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "velocity", 64);
    song.trackChannels[0].volume = 0.5;
    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60, gain: 2 })];
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], instruments, 1.25, 0.5);

    expect(compiled.sampleId).toBe(1);
    expect(compiled.pitch).toBe(7);
    expect(compiled.gain).toBeCloseTo((64 / 127) * 0.5 * 2);
    expect(compiled.time).toBe(1.25);
    expect(compiled.duration).toBe(0.5);
  });

  it("omits time/duration when not given (preview/audition use)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled).not.toHaveProperty("time");
    expect(compiled).not.toHaveProperty("duration");
  });

  it("routes the compiled voice into the given bus (a track's insert-bus FX chain)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments(), undefined, undefined, 7);
    expect(compiled.bus).toBe(7);
  });

  it("omits bus (falls back to AudioRuntime's MASTER_BUS default) when none is given", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled).not.toHaveProperty("bus");
  });
});

describe("noteDurationSteps", () => {
  it("holds until the next non-empty note on the same track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 4 }, "note", 62);
    const track = getSelectedPattern(song).tracks[0];
    expect(noteDurationSteps(track, 0)).toBe(4);
  });

  it("falls back to a 1-step default when no further note exists", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 60 }, "note", 60);
    const track = getSelectedPattern(song).tracks[0];
    expect(noteDurationSteps(track, 60)).toBe(1);
  });

  it("an explicit Event.length overrides the scan-to-next-note behavior", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 4 }, "note", 62);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "length", 2);
    const track = getSelectedPattern(song).tracks[0];
    expect(noteDurationSteps(track, 0)).toBe(2);
  });

  it("the auto scan stops at the track's own playback length, not the full events array", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    // A note sitting past the track's shortened loop — shouldn't extend this note's auto duration.
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 40 }, "note", 62);
    setTrackLength(song, patternId, 0, 8);

    const track = getSelectedPattern(song).tracks[0];
    expect(noteDurationSteps(track, 0)).toBe(1); // nothing follows before row 8, so the 1-step default
  });
});

describe("compileRow", () => {
  it("drops events on muted tracks and tracks excluded by another track's solo", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[2].solo = true; // soloing track 2 (silent, no event) should mute tracks 0 and 1

    const instruments = new Array(8).fill(null).map((_, i) => createInstrumentSlot({ id: i, sampleId: 1 }));
    const pattern = getSelectedPattern(song);

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 0, 0.25);
    expect(events).toHaveLength(0);
  });

  it("compiles every unmuted, non-excluded track's event at a row", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "note", 48);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "instrument", 1);

    const instruments = [
      createInstrumentSlot({ id: 0, sampleId: 1 }),
      createInstrumentSlot({ id: 1, sampleId: 2 }),
    ];
    const pattern = getSelectedPattern(song);

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 2.0, 0.25);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sampleId).sort()).toEqual([1, 2]);
    expect(events.every((e) => e.time === 2.0)).toBe(true);
  });

  it("folds one shared transport step into each track's own playback length independently (polymetric)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    // Track 0 loops every 4 steps, track 1 every 3 — at shared transport step 7 that's local
    // row 3 (7 % 4) on track 0 and local row 1 (7 % 3) on track 1.
    setTrackLength(song, patternId, 0, 4);
    setTrackLength(song, patternId, 1, 3);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 3 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 3 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 1 }, "note", 48);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 1 }, "instrument", 1);

    const instruments = [
      createInstrumentSlot({ id: 0, sampleId: 1 }),
      createInstrumentSlot({ id: 1, sampleId: 2 }),
    ];
    const pattern = getSelectedPattern(song);

    const events = compileRow(pattern, song.trackChannels, instruments, 7, 0, 0.25);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sampleId).sort()).toEqual([1, 2]);
  });

  it("a shortened track plays nothing once the transport step has moved past its loop's live rows, until it wraps back", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 4);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1 })];
    const pattern = getSelectedPattern(song);

    // transport step 1 -> local row 1 (empty); transport step 4 -> wraps back to local row 0 (the note)
    expect(compileRow(pattern, song.trackChannels, instruments, 1, 0, 0.25)).toHaveLength(0);
    expect(compileRow(pattern, song.trackChannels, instruments, 4, 0, 0.25)).toHaveLength(1);
  });

  it("routes each track's compiled voice into its own trackBusIds entry", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "note", 48);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "instrument", 1);

    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1 }), createInstrumentSlot({ id: 1, sampleId: 2 })];
    const pattern = getSelectedPattern(song);
    const trackBusIds = [10, 11, 12, 13, 14, 15, 16, 17];

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 0, 0.25, trackBusIds);
    expect(events.find((e) => e.sampleId === 1).bus).toBe(10);
    expect(events.find((e) => e.sampleId === 2).bus).toBe(13);
  });
});

describe("compileRowFx", () => {
  it("returns a sparse change per track whose cell at this row has fx set", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    addTrackFx(song, 0, "filter");
    addTrackFx(song, 2, "delay");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "filter.cutoff", 1200);
    setCellFxParam(song, { patternId, trackIndex: 2, rowIndex: 0 }, "delay.mix", 0.25);
    const pattern = getSelectedPattern(song);

    const changes = compileRowFx(pattern, 0);

    expect(changes).toEqual(
      expect.arrayContaining([
        { trackIndex: 0, paramId: "filter.cutoff", value: 1200 },
        { trackIndex: 2, paramId: "delay.mix", value: 0.25 },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it("returns nothing for a row with no fx-automated cells", () => {
    const song = createSong();
    const pattern = getSelectedPattern(song);
    expect(compileRowFx(pattern, 0)).toEqual([]);
  });

  it("isn't gated by mute/solo — fx automation latches in even on a muted track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    addTrackFx(song, 0, "filter");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "filter.cutoff", 1200);
    song.trackChannels[0].muted = true;
    const pattern = getSelectedPattern(song);

    expect(compileRowFx(pattern, 0)).toEqual([{ trackIndex: 0, paramId: "filter.cutoff", value: 1200 }]);
  });

  it("folds the transport step through each track's own polymetric length, same as compileRow", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 4);
    addTrackFx(song, 0, "delay");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 3 }, "delay.mix", 0.5);
    const pattern = getSelectedPattern(song);

    // transport step 7 -> local row 3 (7 % 4) on a track of length 4
    expect(compileRowFx(pattern, 7)).toEqual([{ trackIndex: 0, paramId: "delay.mix", value: 0.5 }]);
  });
});
