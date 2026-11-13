import { describe, expect, it } from "vitest";
import { compileRow, compileEventTones } from "../src/audio/compile.js";
import { compileNativeSequence } from "../src/audio/nativeSequence.js";
import { toExtraVoiceParams } from "../src/audio/automation.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";
import { getPatternQueueEntries, getSelectedPattern } from "../src/model/query.js";
import { cloneEvent, createEmptyEvent } from "../src/model/event.js";
import { createScale, patchScale } from "../src/model/scale.js";
import {
  CHORD_TYPES,
  MAX_CHORD_VOICES,
  chordLabel,
  chordNotes,
  chordOffsets,
  createChord,
  isChordEvent,
  normalizeChord,
  toCustomChord,
  toggleChordTone,
  voicesNeededForSlot,
} from "../src/model/chord.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const STEP = 0.125;
const C_MAJOR = patchScale(createScale(), { root: 0, scale: "major" });
const A_MINOR = patchScale(createScale(), { root: 9, scale: "minor" });

function setup(chord, instrument = {}) {
  const song = createSong({ rowCount: 16, trackCount: 2 });
  const ref = { patternId: song.patterns[0].id, trackIndex: 0, rowIndex: 0 };
  setEventField(song, ref, "note", 60);
  setEventField(song, ref, "instrument", 0);
  setEventField(song, ref, "length", 2);
  if (chord !== undefined) setEventField(song, ref, "chord", chord);
  const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60, ...instrument })];
  return { song, instruments };
}
const synth = (extra = {}) => ({ sampleId: null, output: { type: "instrument", channel: null, kind: "pad", track: null }, engineInstrumentId: 10, engineVoiceIds: [11, 12], ...extra });
const row = ({ song, instruments }) => compileRow(getSelectedPattern(song), song.trackChannels, instruments, 0, 10, STEP, undefined, undefined, song.scale);

describe("chord tones", () => {
  it("stacks fixed types on the root", () => {
    expect(chordNotes(createChord("maj"), 60)).toEqual([60, 64, 67]);
    expect(chordNotes(createChord("m7"), 57)).toEqual([57, 60, 64, 67]);
    expect(chordNotes(createChord("sus4"), 60)).toEqual([60, 65, 67]);
  });

  it("every type has 3-5 ascending tones starting at the root", () => {
    for (const t of CHORD_TYPES) {
      expect(t.intervals[0]).toBe(0);
      expect(t.intervals.length).toBeGreaterThanOrEqual(3);
      expect(t.intervals.length).toBeLessThanOrEqual(MAX_CHORD_VOICES);
      expect([...t.intervals].sort((a, b) => a - b)).toEqual(t.intervals);
    }
  });

  it("inverts: the lowest tones move up an octave one at a time", () => {
    expect(chordNotes({ ...createChord("maj"), inversion: 1 }, 60)).toEqual([64, 67, 72]);
    expect(chordNotes({ ...createChord("maj"), inversion: 2 }, 60)).toEqual([67, 72, 76]);
  });

  it("clamps an inversion beyond the tone count", () => {
    expect(normalizeChord({ type: "maj", inversion: 9 }).inversion).toBe(2);
  });

  it("spreads: open lifts the second tone, drop 2 lowers the second from the top, wide lifts every other tone", () => {
    expect(chordOffsets({ ...createChord("maj7"), spread: "open" })).toEqual([0, 7, 11, 16]);
    expect(chordOffsets({ ...createChord("maj7"), spread: "drop2" })).toEqual([-5, 0, 4, 11]);
    expect(chordOffsets({ ...createChord("maj7"), spread: "wide" })).toEqual([0, 7, 16, 23]);
  });

  it("a two-tone chord ignores spread", () => {
    expect(chordOffsets({ type: "custom", offsets: [0, 7], spread: "open" })).toEqual([0, 7]);
  });

  it("diatonic types follow the project scale", () => {
    expect(chordNotes(createChord("dia3"), 60, C_MAJOR)).toEqual([60, 64, 67]);
    expect(chordNotes(createChord("dia3"), 62, C_MAJOR)).toEqual([62, 65, 69]); // D minor
    expect(chordNotes(createChord("dia4"), 59, C_MAJOR)).toEqual([59, 62, 65, 69]); // B half-diminished
    expect(chordNotes(createChord("dia3"), 60, A_MINOR)).toEqual([60, 64, 67]);
    expect(chordNotes(createChord("dia3"), 57, A_MINOR)).toEqual([57, 60, 64]);
  });

  it("diatonic types fall back to a major stack without a key", () => {
    expect(chordNotes(createChord("dia4"), 60, createScale())).toEqual([60, 64, 67, 71]);
  });

  it("drops tones outside the note range", () => {
    expect(chordNotes(createChord("maj"), 125)).toEqual([125]);
  });

  it("custom chords: toggle tones, keep 1..MAX", () => {
    const custom = toCustomChord({ ...createChord("maj"), inversion: 1 }, 60);
    expect(custom).toMatchObject({ type: "custom", offsets: [4, 7, 12], inversion: 0 });
    expect(toggleChordTone(custom, 12).offsets).toEqual([4, 7]);
    expect(toggleChordTone(custom, 9).offsets).toEqual([4, 7, 9, 12]);
    expect(toggleChordTone({ ...custom, offsets: [4] }, 4).offsets).toEqual([4]);
    const full = { ...custom, offsets: [0, 2, 4, 6, 8] };
    expect(toggleChordTone(full, 10).offsets).toEqual([0, 2, 4, 6, 8]);
    expect(toggleChordTone(createChord("maj"), 5)).toEqual(createChord("maj"));
  });

  it("normalizeChord rejects junk and repairs fields", () => {
    expect(normalizeChord(null)).toBeNull();
    expect(normalizeChord({ type: "nope" })).toBeNull();
    expect(normalizeChord({ type: "custom", offsets: [] })).toBeNull();
    expect(normalizeChord({ type: "custom", offsets: [7, 0, 7, 99, "x"] }).offsets).toEqual([0, 7]);
    expect(normalizeChord({ type: "min", spread: "bogus", inversion: -3 })).toEqual({ type: "min", inversion: 0, spread: "close" });
  });

  it("labels", () => {
    expect(chordLabel({ type: "m7", inversion: 1, spread: "open" })).toBe("Minor 7 · inv 1 · Open");
    expect(chordLabel(createChord("maj"))).toBe("Major");
  });

  it("isChordEvent needs a note and a usable chord, and refuses chop slots", () => {
    const e = { ...createEmptyEvent(), note: 60, chord: createChord() };
    expect(isChordEvent(e, { output: { type: "sample" }, sampleMode: "chromatic" })).toBe(true);
    expect(isChordEvent(e, { output: { type: "sample" }, sampleMode: "chop" })).toBe(false);
    expect(isChordEvent({ ...e, note: null }, {})).toBe(false);
    expect(isChordEvent({ ...e, chord: { type: "x" } }, {})).toBe(false);
  });
});

describe("chord playback", () => {
  it("a plain note compiles exactly as before", () => {
    const events = row(setup());
    expect(events).toHaveLength(1);
    expect(row(setup(null))).toEqual(events);
  });

  it("a sample chord is one trigger per tone, same time and length, pitched per tone", () => {
    const events = row(setup(createChord("maj")));
    expect(events.map((e) => e.pitch)).toEqual([0, 4, 7]);
    expect(events.every((e) => e.time === 10 && e.duration === 2 * STEP && e.sampleId === 1)).toBe(true);
  });

  it("a chop slot plays its note as a plain slice", () => {
    const events = row(setup(createChord("maj"), { sampleMode: "chop", cues: [0.5] }));
    expect(events).toHaveLength(1);
  });

  it("each tone of a synth chord goes to its own engine instance", () => {
    const events = row(setup(createChord("maj"), synth()));
    expect(events.map((e) => e.instrumentId)).toEqual([10, 11, 12]);
    expect(events.map((e) => e.pitch)).toEqual([0, 4, 7]);
  });

  it("tones past the existing instances share the last one", () => {
    const events = row(setup(createChord("maj7"), synth()));
    expect(events.map((e) => e.instrumentId)).toEqual([10, 11, 12, 12]);
  });

  it("a slot with no extra instances plays every tone on its own", () => {
    const events = row(setup(createChord("maj"), synth({ engineVoiceIds: [] })));
    expect(events.map((e) => e.instrumentId)).toEqual([10, 10, 10]);
  });

  it("midi output sends one note per tone", () => {
    const events = row(setup(createChord("min"), { sampleId: null, output: { type: "midi", channel: 2, kind: null, track: null } }));
    expect(events.map((e) => e.note)).toEqual([60, 63, 67]);
  });

  it("ratchet repeats the whole chord", () => {
    const s = setup(createChord("maj"));
    setEventField(s.song, { patternId: s.song.patterns[0].id, trackIndex: 0, rowIndex: 0 }, "ratchet", 2);
    const events = row(s);
    expect(events).toHaveLength(6);
    expect(events.filter((e) => e.time === 10)).toHaveLength(3);
  });

  it("only the lowest tone glides into a tie", () => {
    const s = setup(createChord("maj"), synth());
    const tones = compileEventTones({ ...s.song.patterns[0].tracks[0].events[0] }, s.song.trackChannels[0], s.instruments, 0, 1, undefined, undefined, true, s.song.scale);
    expect(tones.map((t) => t.tie)).toEqual([true, undefined, undefined]);
  });

  it("an arp-enabled slot plays its notes as written, not as chords", () => {
    const s = setup(createChord("maj"), { arp: { enabled: true, mode: "up", rate: "1/16", octaves: 1, gate: 1, swing: 0, pattern: [] } });
    expect(row(s).length).toBeLessThanOrEqual(1);
  });

  it("diatonic chords read the song's scale", () => {
    const s = setup(createChord("dia3"));
    s.song.scale = { root: 0, scale: "major", snap: false, preset: null };
    const ref = { patternId: s.song.patterns[0].id, trackIndex: 0, rowIndex: 0 };
    setEventField(s.song, ref, "note", 62);
    expect(row(s).map((e) => e.pitch)).toEqual([2, 5, 9]); // D minor: the chord is built from the key, not from major thirds
  });

  it("the native sequence carries every tone and the extra instances' automation", () => {
    const s = setup(createChord("maj"), synth());
    const entries = getPatternQueueEntries(s.song);
    const seq = compileNativeSequence({ entries, trackChannels: s.song.trackChannels, instruments: s.instruments, trackBusIds: undefined, swing: 0, scale: s.song.scale, hasSample: () => true, paramContext: {} });
    expect(seq.events.filter((e) => e.kind === "instrument").map((e) => e.instrument)).toEqual([10, 11, 12]);
  });

  it("automation of a synth control also targets the extra instances", () => {
    const ctx = { instruments: [synth()], instrumentParam: () => 3 };
    const item = { trackIndex: 0, kind: "inst", slot: 0, paramId: "tone", value: 0.5 };
    expect(toExtraVoiceParams(item, 1, ctx).map((p) => p.target.instrument)).toEqual([11, 12]);
    expect(toExtraVoiceParams({ ...item, kind: "fx" }, 1, ctx)).toEqual([]);
  });
});

describe("chord data", () => {
  it("cloneEvent copies the chord so pasted cells do not alias it", () => {
    const e = { ...createEmptyEvent(), note: 60, chord: toCustomChord(createChord("maj"), 60) };
    const copy = cloneEvent(e);
    copy.chord.offsets.push(99);
    copy.chord.type = "x";
    expect(e.chord.offsets).toEqual([0, 4, 7]);
    expect(e.chord.type).toBe("custom");
  });

  it("empty events have no chord and survive a save/load round trip", async () => {
    expect(createEmptyEvent().chord).toBeNull();
    const { song, instruments } = setup({ ...createChord("m7"), spread: "open" }, synth());
    const saved = JSON.parse(JSON.stringify(serializeProject({ song, instruments, ui: {} })));
    expect(saved.instruments[0].engineVoiceIds).toBeUndefined();
    const restored = await deserializeProject(saved, { loadSampleBytes: async () => null });
    expect(restored.song.patterns[0].tracks[0].events[0].chord).toEqual({ type: "m7", inversion: 0, spread: "open" });
    expect(restored.instruments[0].engineVoiceIds).toEqual([]);
  });

  it("counts the instances a synth slot needs from its largest chord, across patterns", () => {
    const s = setup(createChord("maj"), synth());
    expect(voicesNeededForSlot(s.song, s.instruments, 0)).toBe(3);
    setEventField(s.song, { patternId: s.song.patterns[0].id, trackIndex: 1, rowIndex: 4 }, "note", 60);
    setEventField(s.song, { patternId: s.song.patterns[0].id, trackIndex: 1, rowIndex: 4 }, "instrument", 0);
    setEventField(s.song, { patternId: s.song.patterns[0].id, trackIndex: 1, rowIndex: 4 }, "chord", createChord("13"));
    expect(voicesNeededForSlot(s.song, s.instruments, 0)).toBe(5);
    expect(voicesNeededForSlot(setup().song, setup().instruments, 0)).toBe(1);
    const chop = setup(createChord("maj"), { sampleMode: "chop" });
    expect(voicesNeededForSlot(chop.song, chop.instruments, 0)).toBe(1);
  });
});
