import { describe, expect, it } from "vitest";
import { compileEvent } from "../src/audio/compile.js";
import { computePeaks } from "../src/audio/peaks.js";
import { addCue, cueRegions, evenCues, MIN_SLICE, moveCue, normalizeCues, removeCue } from "../src/model/chop.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { createSong } from "../src/model/song.js";
import { deserializeProject, serializeProject } from "../src/persistence/projectFile.js";
import { createStore } from "../src/state/store.js";

const channel = { muted: false, volume: 1, index: 0 };
const event = (note) => ({ note, instrument: 0, velocity: 127, pan: null });

describe("cue model", () => {
  it("makes N equal slices from N-1 cues and converts to frame regions", () => {
    expect(evenCues(4)).toEqual([0.25, 0.5, 0.75]);
    expect(evenCues(1)).toEqual([]);
    expect(cueRegions([0.5], 100)).toEqual([{ start: 0, end: 50 }, { start: 50, end: 100 }]);
  });

  it("normalises, adds, moves (never crossing neighbours) and removes cues", () => {
    expect(normalizeCues([0.6, 0.2, 0.2, 1.5, -1, NaN])).toEqual([0.2, 0.6]);
    expect(addCue([0.5], 0.5 + MIN_SLICE / 2)).toEqual([0.5]);
    expect(addCue([0.5], 0.25)).toEqual([0.25, 0.5]);
    expect(moveCue([0.25, 0.5], 0, 0.9)[0]).toBeCloseTo(0.5 - MIN_SLICE, 6);
    expect(moveCue([0.25, 0.5], 1, 0.1)[1]).toBeCloseTo(0.25 + MIN_SLICE, 6);
    expect(removeCue([0.25, 0.5], 0)).toEqual([0.5]);
  });

  it("reduces channels to per-bin peaks", () => {
    const peaks = computePeaks([new Float32Array([0, 0.5, -0.9, 0.1])], 2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.9);
  });
});

describe("compiling chop notes", () => {
  it("leaves a chromatic slot unchanged: pitch transposes, no region", () => {
    const compiled = compileEvent(event(63), channel, [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60 })], 1, 0.5);
    expect(compiled.pitch).toBe(3);
    expect(compiled.region).toBeUndefined();
  });

  it("uses (note - rootNote) as the slice index in chop mode and never transposes", () => {
    const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60, sampleMode: "chop" })];
    expect(compileEvent(event(60), channel, instruments).region).toBe(0);
    const compiled = compileEvent(event(65), channel, instruments);
    expect(compiled.region).toBe(5);
    expect(compiled.pitch).toBeUndefined();
    expect(compileEvent(event(59), channel, instruments)).toBeNull();
  });
});

describe("store and persistence", () => {
  it("normalises cues, switches mode, and resets cues when a new sample is loaded", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0, name: "Break" })] });
    store.setInstrumentSampleMode(0, "chop");
    store.setInstrumentSampleMode(0, "bogus");
    store.setInstrumentCues(0, [0.6, 0.2]);
    const slot = store.getState().instruments[0];
    expect(slot.sampleMode).toBe("chop");
    expect(slot.cues).toEqual([0.2, 0.6]);
    store.setInstrumentSample(0, 9, "x");
    expect(store.getState().instruments[0].cues).toEqual([]);
  });

  it("round-trips mode and cues, and loads older projects as chromatic with no cues", async () => {
    const instruments = [createInstrumentSlot({ id: 0, name: "Break", sampleId: "x", sampleMode: "chop", cues: [0.25, 0.5] })];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });
    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh" });
    expect(restored.instruments[0].sampleMode).toBe("chop");
    expect(restored.instruments[0].cues).toEqual([0.25, 0.5]);

    delete serialized.instruments[0].sampleMode;
    delete serialized.instruments[0].cues;
    const old = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh" });
    expect(old.instruments[0].sampleMode).toBe("chromatic");
    expect(old.instruments[0].cues).toEqual([]);
  });
});
