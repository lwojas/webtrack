import { describe, expect, it } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";

// state/store.js#setInstrumentOutput — switching an "instrument"-output slot from one
// webdsp synth kind to another (now that there's more than just Kick) must reseed
// instrumentParams with the *new* kind's own catalog defaults, not silently keep the
// previous kind's values (wrong ranges/units once a different kind's sliders render).
describe("store.setInstrumentOutput — switching synth kind", () => {
  it("seeds instrumentParams with the kind's catalog defaults the first time a slot becomes an instrument", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "kick" });

    expect(store.getState().instruments[0].instrumentParams).toEqual({
      gain: 0,
      tune: 50,
      pitchDrop: 2.5,
      pitchDecay: 0.04,
      decay: 0.45,
      punch: 0.5,
      drive: 0.3,
    });
  });

  it("reseeds instrumentParams with the new kind's own defaults when switching kind, not the old kind's values", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "kick" });
    store.setInstrumentParam(0, "tune", 99); // hand-edit Kick's tune away from its default
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "tom" });

    expect(store.getState().instruments[0].instrumentParams).toEqual({
      gain: 0,
      tune: 120,
      pitchDrop: 0.6,
      decay: 0.45,
      body: 0.5,
      damp: 0.3,
    });
  });

  it("does not reseed when re-setting the same kind, preserving hand-edited values", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "snare" });
    store.setInstrumentParam(0, "snap", 0.9);
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "snare" });

    expect(store.getState().instruments[0].instrumentParams.snap).toBe(0.9);
  });

  it("gives the Bass its own root note (A-1), and restores the default when leaving it", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "kick" });
    expect(store.getState().instruments[0].rootNote).toBe(60); // drums keep C-4

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "bass" });
    expect(store.getState().instruments[0].rootNote).toBe(33);
    expect(store.getState().instruments[0].instrumentParams.cutoff).toBe(400);

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "snare" });
    expect(store.getState().instruments[0].rootNote).toBe(60);
  });

  it("gives Pulse its own root note (A-2) and seeds its catalog defaults", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "pulse" });
    expect(store.getState().instruments[0].rootNote).toBe(45);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ pump: 0.5, repeat: 0.4, rate: 2 });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "bass" });
    expect(store.getState().instruments[0].rootNote).toBe(33);
  });

  it("gives Pad its own root note (A-2) and seeds its catalog defaults", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "pad" });
    expect(store.getState().instruments[0].rootNote).toBe(45);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ movement: 0.5, detune: 0.4, space: 0.6, attack: 0.8, release: 3 });
  });

  it("gives FM its own root note (A-2) and seeds its catalog defaults", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "fm" });
    expect(store.getState().instruments[0].rootNote).toBe(45);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ ratio: 1, timbre: 0.35, snap: 0.6, tone: 0.75, decay: 0.3, legato: 0 });
  });

  it("gives Hypersaw its own root note (A-2) and seeds its catalog defaults", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "hypersaw" });
    expect(store.getState().instruments[0].rootNote).toBe(45);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ detune: 25, spread: 0.8, density: 0.7, cutoff: 5000, sustain: 0.8 });
  });

  it("gives PWM Beast its own root note (A-1) and seeds its catalog defaults", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "pwmbeast" });
    expect(store.getState().instruments[0].rootNote).toBe(33);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ width: 0.3, pwm: 0.5, rate: 3.5, harmonics: 0.5, drive: 0.4, envamt: 0.7, sustain: 0.6 });
  });

  it("seeds the Digital Machines' catalog defaults and root notes", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "dm_tone" });
    expect(store.getState().instruments[0].rootNote).toBe(45);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ structure: 0, ratio: 0.111, damp: 0.4, hold: 0, drive: 0.1 });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "dm_chaos" });
    expect(store.getState().instruments[0].rootNote).toBe(57);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ chaos: 0.4, fold: 0.3, sweep: 0 });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "dm_crack" });
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ burst: 0, noise: 0.6, body: 0.5 });
  });

  it("seeds the Percussion Synth's catalog defaults at the default root", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "percsynth" });
    expect(store.getState().instruments[0].rootNote).toBe(60);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ osc1Wave: 0, osc2Wave: 1, pitchEnv: 2.5, pitchDecay: 0.07, filterType: 0, decay: 0.35, drive: 0.2 });
  });

  it("seeds Edge's catalog defaults at its own root (A-3)", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 })] });
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "edge" });
    expect(store.getState().instruments[0].rootNote).toBe(57);
    expect(store.getState().instruments[0].instrumentParams).toMatchObject({ shape: 0, bright: 0.55, pitchEnv: 3, routing: 1, filterA: 0, filterB: 2, sustain: 0, decay: 0.3 });
  });

  it("leaves a hand-set rootNote alone when switching between drum kinds", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0, rootNote: 48 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "kick" });
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "tom" });

    expect(store.getState().instruments[0].rootNote).toBe(48);
  });
});
