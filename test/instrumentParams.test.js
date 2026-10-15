import { describe, expect, it } from "vitest";
import {
  KICK_PARAMS,
  SNARE_PARAMS,
  CLAP_PARAMS,
  TOM_PARAMS,
  HIHAT_PARAMS,
  BASS_PARAMS,
  SYNTH_KINDS,
  isSustainedSynthKind,
  synthKindRootNote,
  getSynthParams,
  getSynthParam,
  defaultSynthParamValues,
  formatSynthParamValue,
} from "../src/model/instrumentParams.js";

describe("model/instrumentParams.js", () => {
  it("mirrors webdsp's own kick-instrument.md table — six params, each with a webdspParam enum name", () => {
    expect(KICK_PARAMS).toHaveLength(6);
    expect(KICK_PARAMS.map((p) => p.id)).toEqual(["tune", "pitchDrop", "pitchDecay", "decay", "punch", "drive"]);
    for (const param of KICK_PARAMS) {
      expect(typeof param.webdspParam).toBe("string");
      expect(param.min).toBeLessThan(param.max);
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("getSynthParams resolves 'kick' to KICK_PARAMS and an unknown kind to an empty list", () => {
    expect(getSynthParams("kick")).toBe(KICK_PARAMS);
    expect(getSynthParams("nope")).toEqual([]);
  });

  it("mirrors webdsp's own percussion-instruments.md table for Snare/Clap/Tom/Hi-Hat", () => {
    expect(SNARE_PARAMS.map((p) => p.id)).toEqual(["tune", "decay", "snap", "noise"]);
    expect(CLAP_PARAMS.map((p) => p.id)).toEqual(["tune", "decay", "spread", "snap"]);
    expect(TOM_PARAMS.map((p) => p.id)).toEqual(["tune", "pitchDrop", "decay", "body", "damp"]);
    expect(HIHAT_PARAMS.map((p) => p.id)).toEqual(["tune", "decay", "metal", "tone"]);
    for (const params of [SNARE_PARAMS, CLAP_PARAMS, TOM_PARAMS, HIHAT_PARAMS]) {
      for (const param of params) {
        expect(typeof param.webdspParam).toBe("string");
        expect(param.min).toBeLessThan(param.max);
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it("SYNTH_KINDS lists every webdsp instrument kind with a stable id, a display name, and a category", () => {
    expect(SYNTH_KINDS.map((k) => k.id)).toEqual(["kick", "snare", "clap", "tom", "hihat", "bass"]);
    expect(SYNTH_KINDS.map((k) => k.name)).toEqual(["Kick", "Snare", "Clap", "Tom", "Hi-Hat", "Bass"]);
    for (const kind of SYNTH_KINDS) {
      expect(kind.category).toBe(kind.id === "bass" ? "bass" : "drum");
      expect(getSynthParams(kind.id)).toBe(kind.params);
    }
  });

  it("mirrors webdsp's bass-instrument.md table — nine params, the Bass's own ADSR included", () => {
    expect(BASS_PARAMS.map((p) => p.id)).toEqual([
      "tune", "body", "bite", "cutoff", "resonance", "attack", "decay", "sustain", "release",
    ]);
    expect(BASS_PARAMS.map((p) => p.webdspParam)).toEqual([
      "Tune", "Body", "Bite", "Cutoff", "Resonance", "Attack", "Decay", "Sustain", "Release",
    ]);
    for (const param of BASS_PARAMS) {
      expect(param.min).toBeLessThan(param.max);
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("only the Bass is sustained and brings its own root note (A-1 = 33, the note at its 55 Hz tune)", () => {
    expect(SYNTH_KINDS.filter((k) => isSustainedSynthKind(k.id)).map((k) => k.id)).toEqual(["bass"]);
    expect(synthKindRootNote("bass")).toBe(33);
    expect(synthKindRootNote("kick")).toBe(60);
    expect(synthKindRootNote("nope")).toBe(60);
  });

  it("getSynthParam finds one entry by id", () => {
    expect(getSynthParam("kick", "drive")?.label).toBe("Drive");
    expect(getSynthParam("kick", "nope")).toBeUndefined();
  });

  it("defaultSynthParamValues seeds every param at its catalog default", () => {
    expect(defaultSynthParamValues("kick")).toEqual({
      tune: 50,
      pitchDrop: 2.5,
      pitchDecay: 0.04,
      decay: 0.45,
      punch: 0.5,
      drive: 0.3,
    });
  });

  it("defaultSynthParamValues returns an empty object for an unknown kind", () => {
    expect(defaultSynthParamValues("nope")).toEqual({});
  });

  it("defaultSynthParamValues seeds every param at its catalog default for Tom (pitch-sensitive kind)", () => {
    expect(defaultSynthParamValues("tom")).toEqual({
      tune: 120,
      pitchDrop: 0.6,
      decay: 0.45,
      body: 0.5,
      damp: 0.3,
    });
  });

  it("formatSynthParamValue formats with the param's own unit and step precision", () => {
    const tune = getSynthParam("kick", "tune");
    expect(formatSynthParamValue(50, tune)).toBe("50Hz");
    const pitchDecay = getSynthParam("kick", "pitchDecay");
    expect(formatSynthParamValue(0.04, pitchDecay)).toBe("0.040s");
    expect(formatSynthParamValue(null, tune)).toBe("--");
  });
});
