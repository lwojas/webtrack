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

  it("leaves a hand-set rootNote alone when switching between drum kinds", () => {
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0, rootNote: 48 })] });

    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "kick" });
    store.setInstrumentOutput(0, { type: "instrument", channel: null, kind: "tom" });

    expect(store.getState().instruments[0].rootNote).toBe(48);
  });
});
