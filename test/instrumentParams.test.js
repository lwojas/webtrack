import { describe, expect, it } from "vitest";
import {
  KICK_PARAMS,
  SNARE_PARAMS,
  CLAP_PARAMS,
  TOM_PARAMS,
  HIHAT_PARAMS,
  BASS_PARAMS,
  PULSE_PARAMS,
  PAD_PARAMS,
  FM_PARAMS,
  HYPERSAW_PARAMS,
  PWMBEAST_PARAMS,
  DM_THUMP_PARAMS,
  DM_METAL_PARAMS,
  DM_TONE_PARAMS,
  DM_CRACK_PARAMS,
  DM_CHAOS_PARAMS,
  PERCSYNTH_PARAMS,
  SYNTH_KINDS,
  isSustainedSynthKind,
  synthKindRootNote,
  getSynthParams,
  getSynthParam,
  defaultSynthParamValues,
  formatSynthParamValue,
  synthParamControl,
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
    expect(SYNTH_KINDS.map((k) => k.id)).toEqual(["kick", "snare", "clap", "tom", "hihat", "bass", "pulse", "pad", "fm", "hypersaw", "pwmbeast", "dm_thump", "dm_metal", "dm_tone", "dm_crack", "dm_chaos", "percsynth"]);
    expect(SYNTH_KINDS.map((k) => k.name)).toEqual(["Kick", "Snare", "Clap", "Tom", "Hi-Hat", "Bass", "Pulse", "Pad", "FM", "Hypersaw", "PWM Beast", "FM Thump", "FM Metal", "FM Tone", "FM Crack", "FM Chaos", "Perc Synth"]);
    for (const kind of SYNTH_KINDS) {
      expect(kind.category).toBe({ bass: "bass", pulse: "synth", pad: "synth", fm: "synth", hypersaw: "synth", pwmbeast: "synth", dm_thump: "digital", dm_metal: "digital", dm_tone: "digital", dm_crack: "digital", dm_chaos: "digital", percsynth: "synth" }[kind.id] ?? "drum");
      expect(getSynthParams(kind.id)).toBe(kind.params);
    }
  });

  it("mirrors webdsp's bass-instrument.md table — eleven params, the Bass's own ADSR included", () => {
    expect(BASS_PARAMS.map((p) => p.id)).toEqual([
      "tune", "body", "bite", "cutoff", "resonance", "attack", "decay", "sustain", "release", "legato", "slide",
    ]);
    expect(BASS_PARAMS.map((p) => p.webdspParam)).toEqual([
      "Tune", "Body", "Bite", "Cutoff", "Resonance", "Attack", "Decay", "Sustain", "Release", "Legato", "Slide",
    ]);
    for (const param of BASS_PARAMS) {
      expect(param.min).toBeLessThan(param.max);
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("mirrors webdsp's pulse-instrument.md table — thirteen params, rates stepped, attack/release only", () => {
    expect(PULSE_PARAMS.map((p) => p.id)).toEqual([
      "tune", "cutoff", "resonance", "grit", "pluck", "pump", "pumpRate", "pumpAttack", "repeat", "rate", "diffuse", "attack", "release",
    ]);
    expect(PULSE_PARAMS.map((p) => p.webdspParam)).toEqual([
      "Tune", "Cutoff", "Resonance", "Grit", "Pluck", "Pump", "PumpRate", "PumpAttack", "Repeat", "Rate", "Diffuse", "Attack", "Release",
    ]);
    for (const param of PULSE_PARAMS) {
      expect(param.min).toBeLessThan(param.max);
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("shows Pulse's stepped rate as its note value", () => {
    const rate = getSynthParam("pulse", "rate");
    expect(rate.step).toBe(1);
    expect(rate.options).toHaveLength(rate.max - rate.min + 1);
    expect([0, 2, 4, 5].map((v) => formatSynthParamValue(v, rate))).toEqual(["1/1", "1/4", "1/16", "1/32"]);
  });

  it("shows the pumper's own rate, with -1 as Link (follows the repeater rate)", () => {
    const pumpRate = getSynthParam("pulse", "pumpRate");
    expect(pumpRate.default).toBe(-1);
    expect(pumpRate.options).toHaveLength(pumpRate.max - pumpRate.min + 1);
    expect([-1, 0, 2, 5].map((v) => formatSynthParamValue(v, pumpRate))).toEqual(["Link", "1/1", "1/4", "1/32"]);
    expect(getSynthParam("pulse", "pluck").default).toBe(0);
    expect(getSynthParam("pulse", "grit").default).toBe(0.5);
  });

  it("mirrors webdsp's pad-instrument.md table — seven params, long attack/release", () => {
    expect(PAD_PARAMS.map((p) => p.id)).toEqual(["tune", "tone", "movement", "detune", "space", "attack", "release"]);
    expect(PAD_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Tone", "Movement", "Detune", "Space", "Attack", "Release"]);
    for (const param of PAD_PARAMS) {
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("mirrors webdsp's fm-instrument.md table — eleven params, stepped ratio", () => {
    expect(FM_PARAMS.map((p) => p.id)).toEqual(["tune", "ratio", "timbre", "snap", "tone", "attack", "decay", "sustain", "release", "legato", "slide"]);
    expect(FM_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Ratio", "Timbre", "Snap", "Tone", "Attack", "Decay", "Sustain", "Release", "Legato", "Slide"]);
    expect(FM_PARAMS.find((p) => p.id === "ratio").options).toHaveLength(8);
    for (const param of FM_PARAMS) {
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("mirrors webdsp's hypersaw-instrument.md table — nine params, detune in cents", () => {
    expect(HYPERSAW_PARAMS.map((p) => p.id)).toEqual(["tune", "detune", "spread", "density", "cutoff", "attack", "decay", "sustain", "release"]);
    expect(HYPERSAW_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Detune", "Spread", "Density", "Cutoff", "Attack", "Decay", "Sustain", "Release"]);
    expect(HYPERSAW_PARAMS.find((p) => p.id === "detune").unit).toBe("ct");
    for (const param of HYPERSAW_PARAMS) {
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("mirrors webdsp's pwm-beast-instrument.md table — fifteen params, PWM rate in Hz", () => {
    expect(PWMBEAST_PARAMS.map((p) => p.id)).toEqual(["tune", "width", "pwm", "rate", "shape", "harmonics", "drive", "cutoff", "resonance", "envamt", "sub", "attack", "decay", "sustain", "release"]);
    expect(PWMBEAST_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Width", "Pwm", "Rate", "Shape", "Harmonics", "Drive", "Cutoff", "Resonance", "EnvAmount", "Sub", "Attack", "Decay", "Sustain", "Release"]);
    expect(PWMBEAST_PARAMS.find((p) => p.id === "rate").options).toBeUndefined();
    for (const param of PWMBEAST_PARAMS) {
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("mirrors webdsp's digital-machines.md tables — tune/decay/depth first, engine enum member names", () => {
    expect(DM_THUMP_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Decay", "Fm", "Sweep", "Punch", "Ratio", "Body", "Drive"]);
    expect(DM_METAL_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Decay", "Fm", "Spread", "Tone", "Noise", "Chick", "Drive"]);
    expect(DM_TONE_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Decay", "Fm", "Structure", "Ratio", "Damp", "Attack", "Hold", "Drive"]);
    expect(DM_CRACK_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Decay", "Fm", "Body", "Noise", "Burst", "Tone", "Drive"]);
    expect(DM_CHAOS_PARAMS.map((p) => p.webdspParam)).toEqual(["Tune", "Decay", "Chaos", "Ratio", "Fold", "Noise", "Sweep", "Hold"]);
    expect(DM_TONE_PARAMS.find((p) => p.id === "structure").options).toHaveLength(6);
    expect(DM_THUMP_PARAMS.find((p) => p.id === "ratio").options).toBeUndefined();
    for (const params of [DM_THUMP_PARAMS, DM_METAL_PARAMS, DM_TONE_PARAMS, DM_CRACK_PARAMS, DM_CHAOS_PARAMS]) {
      for (const param of params) {
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it("mirrors webdsp's percussion-synth.md table — engine enum member names, one-shot, no sustain/release", () => {
    expect(PERCSYNTH_PARAMS.map((p) => p.webdspParam)).toEqual([
      "Tune", "Osc1Wave", "Osc1Level", "Osc2Wave", "Osc2Pitch", "Osc2Level", "Osc2Fm", "PitchEnv", "PitchDecay", "Osc2Env",
      "Noise", "NoiseTone", "NoiseDecay", "FilterType", "Cutoff", "Resonance", "FilterEnv", "FilterDecay", "Attack", "Decay", "Drive",
    ]);
    expect(new Set(PERCSYNTH_PARAMS.map((p) => p.id)).size).toBe(PERCSYNTH_PARAMS.length);
    expect(PERCSYNTH_PARAMS.find((p) => p.id === "osc1Wave").options).toHaveLength(3);
    expect(PERCSYNTH_PARAMS.find((p) => p.id === "filterEnv").min).toBe(-1);
    expect(isSustainedSynthKind("percsynth")).toBe(false);
    expect(synthKindRootNote("percsynth")).toBe(60);
    for (const param of PERCSYNTH_PARAMS) {
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    }
  });

  it("only the Bass, Pulse, Pad and FM are sustained and bring their own root note (A-1 = 33, A-2 = 45)", () => {
    expect(SYNTH_KINDS.filter((k) => isSustainedSynthKind(k.id)).map((k) => k.id)).toEqual(["bass", "pulse", "pad", "fm", "hypersaw", "pwmbeast", "dm_tone", "dm_chaos"]);
    expect(synthKindRootNote("pad")).toBe(45);
    expect(synthKindRootNote("fm")).toBe(45);
    expect(synthKindRootNote("hypersaw")).toBe(45);
    expect(synthKindRootNote("pwmbeast")).toBe(33);
    expect(synthKindRootNote("dm_tone")).toBe(45);
    expect(synthKindRootNote("dm_chaos")).toBe(57);
    expect(synthKindRootNote("dm_thump")).toBe(60);
    expect(synthKindRootNote("bass")).toBe(33);
    expect(synthKindRootNote("pulse")).toBe(45);
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
    expect(formatSynthParamValue(50, tune)).toBe("G-1 +35c"); // stored Hz, shown musically
    const pitchDecay = getSynthParam("kick", "pitchDecay");
    expect(formatSynthParamValue(0.04, pitchDecay)).toBe("0.040s");
    expect(formatSynthParamValue(null, tune)).toBe("--");
  });

  it("note-scaled tune params convert slider note <-> Hz and stay inside the catalog Hz range", () => {
    const bass = synthParamControl(getSynthParam("bass", "tune"));
    expect([bass.min, bass.max, bass.step]).toEqual([21, 45, 1]); // A-0 .. A-2
    expect(bass.fromSlider(bass.min)).toBeCloseTo(27.5, 6);
    expect(bass.fromSlider(bass.max)).toBeCloseTo(110, 6);
    expect(bass.toSlider(55)).toBeCloseTo(33, 9);
    expect(bass.fromSlider(33)).toBeCloseTo(55, 6);
    expect(bass.fromSlider(34) / bass.fromSlider(33)).toBeCloseTo(2 ** (1 / 12), 9);
    expect(bass.fromSlider(45) / bass.fromSlider(33)).toBeCloseTo(2, 9);
    for (const [kind, id] of [["kick", "tune"], ["snare", "tune"], ["clap", "tune"], ["tom", "tune"]]) {
      const param = getSynthParam(kind, id);
      const c = synthParamControl(param);
      expect(c.fromSlider(c.min)).toBeGreaterThanOrEqual(param.min);
      expect(c.fromSlider(c.max)).toBeLessThanOrEqual(param.max);
      // a saved Hz value is untouched until the user moves the slider
      expect(c.fromSlider(c.toSlider(param.default))).toBeCloseTo(param.default, 6);
    }
  });

  it("formats note-scaled tune as a note name (cents only when off-grid) and Hi-Hat tune as signed st", () => {
    const bass = getSynthParam("bass", "tune");
    expect(formatSynthParamValue(55, bass)).toBe("A-1");
    expect(formatSynthParamValue(110, bass)).toBe("A-2");
    expect(formatSynthParamValue(61.735, bass)).toBe("B-1");
    const hat = getSynthParam("hihat", "tune");
    expect(formatSynthParamValue(0, hat)).toBe("0 st");
    expect(formatSynthParamValue(7, hat)).toBe("+7 st");
    expect(formatSynthParamValue(-12, hat)).toBe("-12 st");
  });
});
