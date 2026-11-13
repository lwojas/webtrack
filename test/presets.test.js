import { describe, it, expect } from "vitest";
import { electricPresets, subBassPresets, compressorPresets } from "../src/audio/presets.js";
import { ELECTRIC_PARAMS, SUB_BASS_PARAMS } from "../src/model/instrumentParams.js";
import { getFxParam } from "../src/model/fxParams.js";

describe("audio/presets.js", () => {
  it("expresses every Electric preset in catalog ids, in range, with unspecified controls at their defaults", () => {
    const presets = electricPresets();
    expect(Object.keys(presets)).toEqual(["electric", "bright", "warm", "digital", "keys", "glass"]);
    for (const values of Object.values(presets)) {
      expect(Object.keys(values).sort()).toEqual(ELECTRIC_PARAMS.map((p) => p.id).sort());
      for (const p of ELECTRIC_PARAMS) {
        expect(values[p.id]).toBeGreaterThanOrEqual(p.min);
        expect(values[p.id]).toBeLessThanOrEqual(p.max);
      }
    }
    expect(presets.glass.bell).toBe(1);
    expect(presets.glass.tune).toBe(261.63);
  });

  it("expresses every Sub Bass preset in catalog ids, in range, with unspecified controls at their defaults", () => {
    const presets = subBassPresets();
    expect(Object.keys(presets)).toEqual(["sub", "warm", "punchy", "acid", "aggressive"]);
    for (const values of Object.values(presets)) {
      expect(Object.keys(values).sort()).toEqual(SUB_BASS_PARAMS.map((p) => p.id).sort());
      for (const p of SUB_BASS_PARAMS) {
        expect(values[p.id]).toBeGreaterThanOrEqual(p.min);
        expect(values[p.id]).toBeLessThanOrEqual(p.max);
      }
    }
    expect(presets.sub.tune).toBe(41.2);
    expect(presets.acid.profile).toBe(4);
    expect(presets.warm.pitchAmount).toBe(0);
  });

  it("expresses compressor presets as in-range FX param values", () => {
    const presets = compressorPresets();
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      for (const [id, value] of Object.entries(preset.values)) {
        const param = getFxParam(id);
        expect(value).toBeGreaterThanOrEqual(param.min);
        expect(value).toBeLessThanOrEqual(param.max);
      }
    }
  });
});
