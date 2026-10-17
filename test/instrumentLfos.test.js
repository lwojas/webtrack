import { describe, expect, it } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { MAX_INSTRUMENT_LFOS, createLfo, patchLfo, rateToSlider, sliderToRate } from "../src/model/instrumentLfos.js";
import { planLfoUpdates } from "../src/audio/instrumentLfo.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const OPTIONS = {
  maxLfos: 4,
  waveforms: ["sine", "triangle", "square", "saw"],
  divisions: ["4 bars", "2 bars", "1/1", "1/2.", "1/2", "1/4.", "1/2T", "1/4", "1/8.", "1/4T", "1/8"],
  targets: ["tune", "body", "cutoff", "resonance"],
};
const ids = { tune: 0, body: 1, bite: 2, cutoff: 3, resonance: 4, attack: 5 };
const resolve = (name) => ids[name];

function bassStore() {
  const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });
  store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "bass", track: null });
  return store;
}

describe("model/instrumentLfos", () => {
  it("clamps edits to their ranges and keeps names", () => {
    const lfo = patchLfo(createLfo("cutoff"), { rateHz: 999, amount: -4, phase: 3, waveform: "saw" });
    expect(lfo).toMatchObject({ rateHz: 40, amount: -1, phase: 1, waveform: "saw", target: "cutoff", sync: false, division: "1/4" });
  });

  it("maps the log rate slider both ways", () => {
    for (const hz of [0.01, 0.5, 2, 13, 40]) expect(sliderToRate(rateToSlider(hz)) / hz).toBeCloseTo(1, 1);
    expect(rateToSlider(0.01)).toBe(0);
    expect(rateToSlider(40)).toBe(1000);
  });
});

describe("store LFO slots", () => {
  it("adds up to the maximum, edits, and removes", () => {
    const store = bassStore();
    for (let i = 0; i < 10; i++) store.addInstrumentLfo(0, "cutoff");
    expect(store.getState().instruments[0].instrumentLfos).toHaveLength(MAX_INSTRUMENT_LFOS);
    store.setInstrumentLfo(0, 1, { sync: true, division: "1/8" });
    expect(store.getState().instruments[0].instrumentLfos[1]).toMatchObject({ sync: true, division: "1/8" });
    store.setInstrumentLfo(0, 9, { amount: 1 }); // no such LFO: ignored
    store.removeInstrumentLfo(0, 0);
    expect(store.getState().instruments[0].instrumentLfos).toHaveLength(MAX_INSTRUMENT_LFOS - 1);
  });

  it("a kind change clears LFOs (their targets belong to the old kind)", () => {
    const store = bassStore();
    store.addInstrumentLfo(0, "cutoff");
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "pulse", track: null });
    expect(store.getState().instruments[0].instrumentLfos).toEqual([]);
  });

  it("leaves the base instrumentParams alone", () => {
    const store = bassStore();
    const before = { ...store.getState().instruments[0].instrumentParams };
    store.addInstrumentLfo(0, "cutoff");
    store.setInstrumentLfo(0, 0, { amount: 1, rateHz: 5 });
    expect(store.getState().instruments[0].instrumentParams).toEqual(before);
  });
});

describe("planLfoUpdates", () => {
  it("resolves names to engine ids/indices and sends each slot once", () => {
    const lfos = [{ ...createLfo("cutoff"), sync: true, division: "1/8", waveform: "triangle", amount: 0.5 }];
    const sent = [];
    expect(planLfoUpdates(lfos, OPTIONS, resolve, sent)).toEqual([
      { slot: 0, settings: { target: 3, amount: 0.5, waveform: 1, sync: true, rateHz: 1, division: 10, phase: 0 } },
    ]);
    expect(planLfoUpdates(lfos, OPTIONS, resolve, sent)).toEqual([]); // unchanged
    lfos[0] = { ...lfos[0], amount: -0.25 };
    expect(planLfoUpdates(lfos, OPTIONS, resolve, sent)).toHaveLength(1);
    expect(planLfoUpdates([], OPTIONS, resolve, sent)).toEqual([{ slot: 0, clear: true }]);
  });

  it("clears slots whose target the engine does not offer or whose names are unknown", () => {
    const sent = [];
    const ops = planLfoUpdates(
      [createLfo("attack"), { ...createLfo("cutoff"), waveform: "noise" }, { ...createLfo("cutoff"), sync: true, division: "7/9" }, createLfo("cutoff")],
      OPTIONS,
      resolve,
      sent,
    );
    expect(ops.filter((o) => o.clear).map((o) => o.slot)).toEqual([]); // nothing was sent before, so nothing to clear
    expect(ops.map((o) => o.slot)).toEqual([3]); // only the valid one is sent
  });
});

describe("project file", () => {
  it("round-trips LFO slots by name and loads old projects with none", async () => {
    const lfos = [{ ...createLfo("cutoff"), sync: true, division: "1/8", waveform: "saw", amount: -0.4 }];
    const slot = createInstrumentSlot({ id: 0, output: { type: "instrument", channel: null, kind: "bass", track: null }, instrumentLfos: lfos });
    const serialized = serializeProject({ song: createSong(), instruments: [slot], ui: {} });
    expect(serialized.instruments[0].instrumentLfos).toEqual(lfos);
    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });
    expect(restored.instruments[0].instrumentLfos).toEqual(lfos);

    delete serialized.instruments[0].instrumentLfos;
    const old = await deserializeProject(serialized, { loadSampleBytes: async () => null });
    expect(old.instruments[0].instrumentLfos).toEqual([]);
  });
});
