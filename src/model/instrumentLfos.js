// LFO modulation slots for a synthesized-instrument slot (model/instrument.js#instrumentLfos).
// webdsp-free, like the rest of model/: the model stores only what the user chose, by webdsp's
// own *names* (waveform "sine", division "1/8", target "cutoff") so a saved project survives the
// engine reordering its tables. Which controls are valid targets, and the waveform/division
// option lists, come from the engine at runtime (audio/instrument.js#getModulationOptions —
// AudioRuntime.getModulationTargets/getModulationInfo); nothing here lists targets per synth.
// See webdsp's docs/lfo-modulation.md.

// Mirrors webdsp's per-instrument LFO slot count (the engine reports the real limit).
export const MAX_INSTRUMENT_LFOS = 4;
export const LFO_WAVEFORMS = ["sine", "triangle", "square", "saw"];
export const LFO_WAVEFORM_LABELS = { sine: "SINE", triangle: "TRI", square: "SQ", saw: "SAW" };
export const LFO_MIN_RATE_HZ = 0.01;
export const LFO_MAX_RATE_HZ = 40;
export const DEFAULT_LFO_DIVISION = "1/4";

export function createLfo(target) {
  return { waveform: "sine", sync: false, rateHz: 1, division: DEFAULT_LFO_DIVISION, phase: 0, amount: 0.3, target };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Merges a patch into an LFO and clamps the numeric fields to their ranges.
export function patchLfo(lfo, patch) {
  const next = { ...lfo, ...patch };
  next.rateHz = clamp(Number(next.rateHz) || 1, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ);
  next.phase = clamp(Number(next.phase) || 0, 0, 1);
  next.amount = clamp(Number(next.amount) || 0, -1, 1);
  return next;
}

// Rate is edited on a log slider (0.01-40 Hz spans four decades).
export const LFO_RATE_STEPS = 1000;
export function rateToSlider(hz) {
  return Math.round((Math.log(hz / LFO_MIN_RATE_HZ) / Math.log(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ)) * LFO_RATE_STEPS);
}
export function sliderToRate(v) {
  return LFO_MIN_RATE_HZ * Math.pow(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ, v / LFO_RATE_STEPS);
}
export function formatLfoRate(hz) {
  return `${hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : String(Math.round(hz))}Hz`;
}
