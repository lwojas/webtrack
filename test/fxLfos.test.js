import { describe, expect, it } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getFxParam, getFxParamsForType, FX_TYPES } from "../src/model/fxParams.js";
import { MAX_INSTRUMENT_LFOS } from "../src/model/instrumentLfos.js";
import { planLfoUpdates } from "../src/audio/instrumentLfo.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";
import { fxModulationOptions, resolveNodeParam } from "../src/audio/fx.js";

function storeWith(type) {
  const store = createStore({ song: createSong(), instruments: [] });
  const id = store.addTrackFx(0, type);
  return { store, id, entry: () => store.getState().song.trackChannels[0].fxChain.find((e) => e.id === id) };
}

describe("Utility FX in the catalog", () => {
  it("is an addable kind with one dB gain parameter that cell FX can automate", () => {
    expect(FX_TYPES.map((t) => t.id)).toContain("utility");
    const gain = getFxParam("utility.gain");
    expect(gain).toMatchObject({ type: "utility", nodeParam: "UtilityGain", unit: "dB", min: -60, max: 12, default: 0 });
    expect(gain.cellAutomatable).not.toBe(false);
    expect(getFxParamsForType("utility")).toEqual([gain]);
  });

  it("is seeded at unity and resolves to the engine's NodeParam", () => {
    const { store, id } = storeWith("utility");
    expect(store.getState().song.trackChannels[0].fx.instances[id]["utility.gain"]).toBe(0);
    expect(resolveNodeParam("utility.gain")).toBeTypeOf("number");
    expect(resolveNodeParam("dub.division")).toBeTypeOf("number"); // needs webdsp with DubDelay
    expect(resolveNodeParam("glitch.mix")).toBeTypeOf("number"); // needs webdsp with Glitch
  });
});

describe("FX LFO stack (model)", () => {
  it("adds, edits (clamped) and removes LFOs on one instance, up to the bank size", () => {
    const { store, id, entry } = storeWith("filter");
    expect(entry().lfos).toBeUndefined();
    for (let i = 0; i < 6; i++) store.addFxLfo(0, id, "filter.cutoff");
    expect(entry().lfos).toHaveLength(MAX_INSTRUMENT_LFOS);
    store.setFxLfo(0, id, 1, { amount: 9, rateHz: 999, waveform: "saw" });
    expect(entry().lfos[1]).toMatchObject({ amount: 1, rateHz: 40, waveform: "saw", target: "filter.cutoff" });
    store.removeFxLfo(0, id, 0);
    expect(entry().lfos).toHaveLength(MAX_INSTRUMENT_LFOS - 1);
    while (entry().lfos) store.removeFxLfo(0, id, 0);
    expect(entry().lfos).toBeUndefined(); // an empty stack is dropped, not left as []
  });

  it("refuses a target that is not a parameter of that FX, and keeps the old one on retarget", () => {
    const { store, id, entry } = storeWith("delay");
    store.addFxLfo(0, id, "filter.cutoff");
    expect(entry().lfos).toBeUndefined();
    store.addFxLfo(0, id, "delay.mix");
    store.setFxLfo(0, id, 0, { target: "reverb.mix" });
    expect(entry().lfos[0].target).toBe("delay.mix");
    store.setFxLfo(0, id, 0, { target: "delay.feedback" });
    expect(entry().lfos[0].target).toBe("delay.feedback");
  });

  it("works on the master chain (trackIndex null) and leaves other instances alone", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const a = store.addMasterFx("reverb");
    const b = store.addMasterFx("reverb");
    store.addFxLfo(null, a, "reverb.mix");
    const chain = store.getState().song.masterFxChain;
    expect(chain.find((e) => e.id === a).lfos).toHaveLength(1);
    expect(chain.find((e) => e.id === b).lfos).toBeUndefined();
  });

  it("ignores unknown instances and out-of-range LFOs", () => {
    const { store, id } = storeWith("filter");
    store.addFxLfo(0, 9999, "filter.cutoff");
    store.setFxLfo(0, id, 3, { amount: 1 });
    store.removeFxLfo(0, id, 0);
    expect(store.getState().song.trackChannels[0].fxChain[0].lfos).toBeUndefined();
  });

  it("round-trips through save and load, base values untouched", async () => {
    const { store, id } = storeWith("filter");
    store.addFxLfo(0, id, "filter.cutoff");
    store.setFxLfo(0, id, 0, { sync: true, division: "1/8", amount: -0.5 });
    const json = serializeProject({ song: store.getState().song, instruments: [], ui: {} });
    const loaded = await deserializeProject(json, { loadSampleBytes: async () => null });
    const entry = loaded.song.trackChannels[0].fxChain[0];
    expect(entry.lfos).toEqual([expect.objectContaining({ sync: true, division: "1/8", amount: -0.5, target: "filter.cutoff" })]);
    expect(loaded.song.trackChannels[0].fx.instances[id]["filter.cutoff"]).toBe(20000);
  });
});

describe("FX LFOs reach the engine", () => {
  // A stand-in for the engine's FX tables: filter cutoff/resonance and delay feedback/mix modulate.
  const NP = (id) => resolveNodeParam(id);
  const runtime = {
    getModulationInfo: () => ({ maxLfos: 4, waveforms: ["sine", "triangle", "square", "saw"], divisions: [{ name: "1/4" }, { name: "1/8" }] }),
    getEffectModulationTargets: (kind) =>
      kind === 0 ? [{ id: NP("filter.cutoff") }, { id: NP("filter.resonance") }] : [],
  };

  it("offers only the catalog params the engine reports as modulation targets", () => {
    const opts = fxModulationOptions(runtime, "filter");
    expect(opts.targets).toEqual(["filter.cutoff", "filter.resonance"]); // not mode / slope
    expect(opts.divisions).toEqual(["1/4", "1/8"]);
    expect(fxModulationOptions(runtime, "delay").targets).toEqual([]);
    expect(fxModulationOptions({}, "filter")).toBeNull(); // an engine without FX modulation
  });

  it("plans each slot once, resolving names to engine ids, and clears removed ones", () => {
    const opts = fxModulationOptions(runtime, "filter");
    const lfos = [
      { waveform: "sine", sync: false, rateHz: 2, division: "1/4", phase: 0, amount: 0.4, target: "filter.cutoff" },
      { waveform: "saw", sync: true, rateHz: 1, division: "1/8", phase: 0, amount: -0.2, target: "filter.cutoff" },
      { waveform: "sine", sync: false, rateHz: 1, division: "1/4", phase: 0, amount: 0.3, target: "filter.mode" }, // not a target
    ];
    const sent = [];
    const ops = planLfoUpdates(lfos, opts, resolveNodeParam, sent);
    expect(ops.filter((o) => !o.clear).map((o) => [o.slot, o.settings.target])).toEqual([[0, NP("filter.cutoff")], [1, NP("filter.cutoff")]]);
    expect(planLfoUpdates(lfos, opts, resolveNodeParam, sent)).toEqual([]); // unchanged: nothing resent
    expect(planLfoUpdates([lfos[0]], opts, resolveNodeParam, sent)).toEqual([{ slot: 1, clear: true }]);
  });
});
