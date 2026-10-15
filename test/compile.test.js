import { describe, expect, it } from "vitest";
import { compileEvent, compileRow, compileRowFx, noteDurationSteps } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField, setTrackLength, setCellFxParam, setCellFxInstanceParam, addTrackFx } from "../src/model/mutations.js";
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

  it("maps note-relative-to-rootNote into a semitone pitch offset and scales gain by velocity/volume", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 67); // 7 semitones above rootNote 60
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "velocity", 64);
    song.trackChannels[0].volume = 0.5;
    // instrument.gain (2, deliberately not 1) must NOT show up in compiled.gain — it's pushed
    // straight to webdsp's own per-sample gain stage instead (audio/instrumentGain.js), not
    // folded into this compile-time number (see audio/compile.js's doc comment).
    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60, gain: 2 })];
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], instruments, 1.25, 0.5);

    expect(compiled.sampleId).toBe(1);
    expect(compiled.pitch).toBe(7);
    expect(compiled.gain).toBeCloseTo((64 / 127) * 0.5);
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

  it("passes event.pan straight through as webdsp's TriggerParams.pan", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "pan", -0.5);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled.pan).toBe(-0.5);
  });

  it("omits pan (falls back to the instrument's own default pan, no per-note offset) when the cell's pan is unset", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(event.pan).toBe(null); // createEmptyEvent's default — never touched above
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled).not.toHaveProperty("pan");
  });

  it("never sets pan for a MIDI-output instrument — there's no webdsp voice to pan", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "pan", 0.5);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const midiInstruments = [createInstrumentSlot({ id: 0, output: { type: "midi", channel: 0 } })];
    const compiled = compileEvent(event, song.trackChannels[0], midiInstruments);
    expect(compiled).not.toHaveProperty("pan");
  });

  it("tags a compiled sample event with kind: 'sample'", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], makeInstruments());
    expect(compiled.kind).toBe("sample");
  });
});

describe("compileEvent — MIDI output", () => {
  function makeMidiInstruments(channel = 3) {
    return [createInstrumentSlot({ id: 0, name: "Synth", rootNote: 72, output: { type: "midi", channel } })];
  }

  it("sends the event's note verbatim, ignoring the instrument's rootNote entirely", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    // rootNote is 72 here specifically to prove it's never read: a sample-output instrument
    // with the same rootNote would transpose this note by -12 semitones (see the "maps
    // note-relative-to-rootNote" test above); a MIDI-output instrument must not.
    const compiled = compileEvent(event, song.trackChannels[0], makeMidiInstruments());

    expect(compiled).toEqual({ kind: "midi", channel: 3, note: 60, velocity: 127 });
    expect(compiled).not.toHaveProperty("pitch");
  });

  it("carries the event's velocity straight through as MIDI velocity (no gain/volume scaling)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "velocity", 90);
    song.trackChannels[0].volume = 0.3; // a sample output would fold this into gain — MIDI must not
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], makeMidiInstruments());

    expect(compiled.velocity).toBe(90);
  });

  it("includes time/duration when scheduled, omits them for an unscheduled audition", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    const scheduled = compileEvent(event, song.trackChannels[0], makeMidiInstruments(), 1.5, 0.25);
    expect(scheduled.time).toBe(1.5);
    expect(scheduled.duration).toBe(0.25);

    const auditioned = compileEvent(event, song.trackChannels[0], makeMidiInstruments());
    expect(auditioned).not.toHaveProperty("time");
    expect(auditioned).not.toHaveProperty("duration");
  });

  it("returns null when the MIDI-output instrument has no channel assigned", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeMidiInstruments(null))).toBe(null);
  });

  it("is still gated by a muted track channel, same as sample output", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[0].muted = true;
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeMidiInstruments())).toBe(null);
  });
});

describe("compileEvent — synthesized instrument output (webdsp Kick/Snare/Clap/Tom/Hi-Hat)", () => {
  function makeSynthInstruments({ engineInstrumentId = 7, rootNote = 72 } = {}) {
    return [
      createInstrumentSlot({
        id: 0,
        name: "Kick",
        rootNote, // non-default (not 60) so pitch-from-rootNote tests have something to see
        output: { type: "instrument", channel: null, kind: "kick" },
        engineInstrumentId,
      }),
    ];
  }

  it("addresses the instrument's own live engineInstrumentId and derives pitch from note - rootNote, same as sample output", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    // rootNote is 72 here specifically to prove the conversion is the same one the sample
    // branch uses: webdsp's InstrumentNoteParams.pitch is "semitones on top of tune," the same
    // convention as a sample's rootNote-relative pitch (see node_modules/webdsp's
    // docs/percussion-instruments.md's "Note pitch") — a note 12 semitones below rootNote
    // compiles to pitch: -12, exactly like the "maps note-relative-to-rootNote" sample test.
    const compiled = compileEvent(event, song.trackChannels[0], makeSynthInstruments());

    expect(compiled.kind).toBe("instrument");
    expect(compiled.instrumentId).toBe(7);
    expect(compiled.pitch).toBe(-12);
    expect(compiled).not.toHaveProperty("note");
  });

  it("compiles pitch: 0 when the note matches rootNote — the default (C-4/60) keeps a pre-pitch Kick project sounding unchanged", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], makeSynthInstruments({ rootNote: 60 }));

    expect(compiled.pitch).toBe(0);
  });

  it("gives a Tom (or any pitched synth instrument) a positive pitch for a note above rootNote", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 67); // +7 semitones above C-4
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    const tomInstruments = [
      createInstrumentSlot({
        id: 0,
        name: "Tom",
        rootNote: 60,
        output: { type: "instrument", channel: null, kind: "tom" },
        engineInstrumentId: 3,
      }),
    ];
    const compiled = compileEvent(event, song.trackChannels[0], tomInstruments);

    expect(compiled.pitch).toBe(7);
  });

  it("scales velocity by track volume into a 0..1 level, same scalar sample output uses for gain", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "velocity", 64);
    song.trackChannels[0].volume = 0.5;
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], makeSynthInstruments());

    expect(compiled.velocity).toBeCloseTo((64 / 127) * 0.5);
  });

  it("carries pan straight through, same as sample output", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "pan", -0.4);
    const event = getSelectedPattern(song).tracks[0].events[0];

    const compiled = compileEvent(event, song.trackChannels[0], makeSynthInstruments());

    expect(compiled.pan).toBe(-0.4);
  });

  it("includes time when scheduled, omits it for an unscheduled audition, and never includes duration", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];

    const scheduled = compileEvent(event, song.trackChannels[0], makeSynthInstruments(), 1.5, 0.25);
    expect(scheduled.time).toBe(1.5);
    expect(scheduled).not.toHaveProperty("duration"); // webdsp instruments are one-shot/self-ending

    const auditioned = compileEvent(event, song.trackChannels[0], makeSynthInstruments());
    expect(auditioned).not.toHaveProperty("time");
  });

  it("returns null when the slot has no live engineInstrumentId yet", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeSynthInstruments({ engineInstrumentId: null }))).toBe(null);
  });

  it("is still gated by a muted track channel, same as sample/MIDI output", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    song.trackChannels[0].muted = true;
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], makeSynthInstruments())).toBe(null);
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

  it("tags each compiled event with the trackIndex that produced it (audio/voiceTracker.js's correlation key)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "note", 48);
    setEventField(song, { patternId, trackIndex: 3, rowIndex: 0 }, "instrument", 1);

    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1 }), createInstrumentSlot({ id: 1, sampleId: 2 })];
    const pattern = getSelectedPattern(song);

    const events = compileRow(pattern, song.trackChannels, instruments, 0, 0, 0.25);
    expect(events.find((e) => e.sampleId === 1).trackIndex).toBe(0);
    expect(events.find((e) => e.sampleId === 2).trackIndex).toBe(3);
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
  it("returns a sparse change per track whose cell at this row has instance fx set, carrying the instance id", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const filterId = addTrackFx(song, 0, "filter");
    const delayId = addTrackFx(song, 2, "delay");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterId, "filter.cutoff", 1200);
    setCellFxInstanceParam(song, { patternId, trackIndex: 2, rowIndex: 0 }, delayId, "delay.mix", 0.25);
    const pattern = getSelectedPattern(song);

    const changes = compileRowFx(pattern, 0);

    expect(changes).toEqual(
      expect.arrayContaining([
        { trackIndex: 0, instanceId: filterId, paramId: "filter.cutoff", value: 1200 },
        { trackIndex: 2, instanceId: delayId, paramId: "delay.mix", value: 0.25 },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it("returns a change with instanceId: null for the flat bus.gain entry", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", 0.5);
    const pattern = getSelectedPattern(song);

    expect(compileRowFx(pattern, 0)).toEqual([{ trackIndex: 0, instanceId: null, paramId: "bus.gain", value: 0.5 }]);
  });

  it("returns nothing for a row with no fx-automated cells", () => {
    const song = createSong();
    const pattern = getSelectedPattern(song);
    expect(compileRowFx(pattern, 0)).toEqual([]);
  });

  it("isn't gated by mute/solo — fx automation latches in even on a muted track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const filterId = addTrackFx(song, 0, "filter");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterId, "filter.cutoff", 1200);
    song.trackChannels[0].muted = true;
    const pattern = getSelectedPattern(song);

    expect(compileRowFx(pattern, 0)).toEqual([{ trackIndex: 0, instanceId: filterId, paramId: "filter.cutoff", value: 1200 }]);
  });

  it("folds the transport step through each track's own polymetric length, same as compileRow", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 4);
    const delayId = addTrackFx(song, 0, "delay");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 3 }, delayId, "delay.mix", 0.5);
    const pattern = getSelectedPattern(song);

    // transport step 7 -> local row 3 (7 % 4) on a track of length 4
    expect(compileRowFx(pattern, 7)).toEqual([{ trackIndex: 0, instanceId: delayId, paramId: "delay.mix", value: 0.5 }]);
  });

  it("keeps two instances of the same type independent — automating one never shows up under the other's id", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const filterA = addTrackFx(song, 0, "filter");
    const filterB = addTrackFx(song, 0, "filter");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterA, "filter.cutoff", 400);
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterB, "filter.cutoff", 4000);
    const pattern = getSelectedPattern(song);

    expect(compileRowFx(pattern, 0)).toEqual(
      expect.arrayContaining([
        { trackIndex: 0, instanceId: filterA, paramId: "filter.cutoff", value: 400 },
        { trackIndex: 0, instanceId: filterB, paramId: "filter.cutoff", value: 4000 },
      ]),
    );
  });
});
