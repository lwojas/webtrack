import { describe, expect, it } from "vitest";
import {
  SCALES,
  SCALE_PRESETS,
  applyScalePreset,
  createScale,
  formatScale,
  getNearestScaleNote,
  getNotesInRange,
  getScaleDegree,
  getScaleNotes,
  isChromatic,
  isNoteInScale,
  normalizeScale,
  patchScale,
  scaleOf,
  snapEnteredNote,
} from "../src/model/scale.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { createEditController } from "../src/input/editController.js";
import { setEventField } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const cMajor = { ...createScale(), root: 0, scale: "major" };
const aMinor = { ...createScale(), root: 9, scale: "minor" };

describe("scale definitions", () => {
  it("every scale starts on the root, ascends strictly and stays inside one octave", () => {
    for (const s of SCALES) {
      expect(s.intervals[0], s.id).toBe(0);
      s.intervals.forEach((v, i) => {
        expect(v, s.id).toBeLessThan(12);
        if (i > 0) expect(v, s.id).toBeGreaterThan(s.intervals[i - 1]);
      });
    }
  });

  it("defines the requested library with the right sizes and interval patterns", () => {
    const iv = (id) => SCALES.find((s) => s.id === id).intervals;
    expect(SCALES.map((s) => s.id)).toEqual([
      "major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor",
      "pentatonicMajor", "pentatonicMinor", "blues", "wholeTone", "chromatic",
    ]);
    ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor"].forEach((id) => expect(iv(id)).toHaveLength(7));
    expect([iv("pentatonicMajor").length, iv("pentatonicMinor").length, iv("blues").length, iv("wholeTone").length, iv("chromatic").length]).toEqual([5, 5, 6, 6, 12]);
    expect(iv("major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(iv("minor")).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(iv("dorian")).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(iv("harmonicMinor")).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(iv("blues")).toEqual([0, 3, 5, 6, 7, 10]);
  });
});

describe("scale queries", () => {
  it("computes scale pitch classes from the root", () => {
    expect(getScaleNotes(0, "major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(getScaleNotes(2, "minor")).toEqual([2, 4, 5, 7, 9, 10, 0]);
    expect(getScaleNotes(6, "pentatonicMinor")).toEqual([6, 9, 11, 1, 4]);
  });

  it("answers membership in every octave", () => {
    for (const octave of [24, 36, 60, 84]) {
      expect(isNoteInScale(aMinor, octave + 9)).toBe(true);
      expect(isNoteInScale(aMinor, octave + 0)).toBe(true);
      expect(isNoteInScale(aMinor, octave + 1)).toBe(false);
    }
    expect(isChromatic(aMinor)).toBe(false);
    expect(isChromatic(createScale())).toBe(true);
    expect(isNoteInScale(createScale(), 61)).toBe(true);
  });

  it("gives 1-based scale degrees, null outside the scale", () => {
    expect([57, 59, 60, 69].map((n) => getScaleDegree(aMinor, n))).toEqual([1, 2, 3, 1]);
    expect(getScaleDegree(aMinor, 61)).toBeNull();
  });

  it("snaps to the nearest scale note, ties going down", () => {
    expect(getNearestScaleNote(cMajor, 60)).toBe(60);
    expect(getNearestScaleNote(cMajor, 61)).toBe(60);
    expect(getNearestScaleNote(cMajor, 66)).toBe(65);
    expect(getNearestScaleNote(cMajor, 70)).toBe(69);
    expect(getNearestScaleNote({ ...createScale(), scale: "pentatonicMajor" }, 65)).toBe(64);
  });

  it("lists scale notes in a range", () => {
    expect(getNotesInRange(cMajor, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(getNotesInRange(cMajor, 61, 61)).toEqual([]);
  });
});

describe("project scale state", () => {
  it("defaults to chromatic for a song without one, and a new song carries it", () => {
    expect(scaleOf({})).toEqual({ root: 0, scale: "chromatic", snap: false, preset: null });
    expect(createSong().scale).toEqual(createScale());
  });

  it("normalises junk to safe values", () => {
    expect(normalizeScale({ root: 14, scale: "nope", snap: "yes", preset: "ghost" })).toEqual({ root: 2, scale: "chromatic", snap: false, preset: null });
    expect(normalizeScale({ root: -3 }).root).toBe(9);
  });

  it("applies musical presets as root + scale, keeping snap, and labels them", () => {
    expect(SCALE_PRESETS.length).toBeGreaterThanOrEqual(11);
    for (const p of SCALE_PRESETS) expect(SCALES.some((s) => s.id === p.scale), p.id).toBe(true);
    const liquid = applyScalePreset({ ...createScale(), snap: true }, "liquidDnb");
    expect(liquid).toMatchObject({ root: 2, scale: "dorian", snap: true, preset: "liquidDnb" });
    expect(formatScale(liquid)).toBe("Liquid DnB (D Dorian)");
    expect(formatScale(aMinor)).toBe("A Minor");
  });

  it("choosing a key by hand drops the preset label", () => {
    const liquid = applyScalePreset(createScale(), "liquidDnb");
    expect(patchScale(liquid, { root: 5 })).toMatchObject({ root: 5, scale: "dorian", preset: null });
    expect(patchScale(liquid, { snap: true })).toMatchObject({ preset: "liquidDnb", snap: true });
  });

  it("snapEnteredNote only moves a note when Snap is on and the entry is not chromatic", () => {
    expect(snapEnteredNote(cMajor, 61)).toBe(61);
    const snapping = { ...cMajor, snap: true };
    expect(snapEnteredNote(snapping, 61)).toBe(60);
    expect(snapEnteredNote(snapping, 61, { chromatic: true })).toBe(61);
    expect(snapEnteredNote(snapping, 62)).toBe(62);
  });
});

describe("store and note entry", () => {
  function setup() {
    const song = createSong();
    const store = createStore({ song, instruments: [] });
    const listeners = new Set();
    const source = { onNoteOn: (fn) => (listeners.add(fn), () => listeners.delete(fn)), onNoteOff: () => () => {}, emit: (p) => listeners.forEach((fn) => fn(p)) };
    createEditController({ store, noteSources: [source] }).attach({ addEventListener() {}, removeEventListener() {} });
    return { store, source };
  }

  it("changing the scale never rewrites a note, and emits SCALE_CHANGED", () => {
    const { store } = setup();
    const song = store.getState().song;
    setEventField(song, { patternId: song.patterns[0].id, trackIndex: 0, rowIndex: 3 }, "note", 61);
    const before = JSON.stringify(song.patterns);
    let changes = 0;
    store.subscribe("SCALE_CHANGED", () => changes++);
    store.setScale({ root: 7, scale: "dorian" });
    store.setScale({ snap: true });
    expect(JSON.stringify(store.getState().song.patterns)).toBe(before);
    expect(store.getState().song.scale).toMatchObject({ root: 7, scale: "dorian", snap: true });
    expect(changes).toBe(2);
  });

  it("a musical preset also sets the edit octave", () => {
    const { store } = setup();
    store.setScale({ preset: "acid" });
    expect(store.getState().octave).toBe(2);
    expect(store.getState().song.scale).toMatchObject({ root: 9, scale: "pentatonicMinor", preset: "acid" });
  });

  it("writes played notes verbatim until Snap is on; Shift (chromatic) bypasses Snap", () => {
    const { store, source } = setup();
    const noteAt = (row) => getSelectedPattern(store.getState().song).tracks[0].events[row].note;
    source.emit({ note: 61, velocity: 100 });
    expect(noteAt(0)).toBe(61);
    store.setScale({ root: 0, scale: "major", snap: true });
    source.emit({ note: 61, velocity: 100 });
    expect(noteAt(1)).toBe(60);
    source.emit({ note: 61, velocity: 100, chromatic: true });
    expect(noteAt(2)).toBe(61);
  });
});

describe("persistence", () => {
  const ui = { selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } };

  it("round-trips the scale", async () => {
    const song = createSong();
    song.scale = applyScalePreset(createScale(), "acid");
    const restored = await deserializeProject(JSON.parse(JSON.stringify(serializeProject({ song, instruments: [], ui }))), { loadSampleBytes: async () => null });
    expect(restored.song.scale).toEqual(song.scale);
  });

  it("opens a project saved without a scale as chromatic, leaving every note alone", async () => {
    const song = createSong();
    setEventField(song, { patternId: song.patterns[0].id, trackIndex: 0, rowIndex: 0 }, "note", 61);
    const file = JSON.parse(JSON.stringify(serializeProject({ song, instruments: [], ui })));
    delete file.song.scale;
    const restored = await deserializeProject(file, { loadSampleBytes: async () => null });
    expect(restored.song.scale).toEqual(createScale());
    expect(restored.song.patterns[0].tracks[0].events[0].note).toBe(61);
  });
});
