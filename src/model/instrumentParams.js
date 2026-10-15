// Public control catalog for webdsp's synthesized instruments (AudioRuntime.createInstrument/
// setInstrumentParameter — node_modules/webdsp's docs/instruments.md). Same shape/conventions
// as model/fxParams.js's FX_PARAMS and model/envelopeParams.js's ENVELOPE_PARAMS (id/label/
// min/max/default/step/unit) — model/ stays webdsp-free (docs/EXTENDING.md's layer map);
// audio/instrument.js is the only place `webdspParam` below gets bridged to webdsp's real
// per-kind param enum (e.g. KickParam) and actually sent to the engine, the same split
// audio/fx.js has for FX_PARAMS#nodeParam.
//
// min/max/default/unit mirror webdsp's own docs/kick-instrument.md and
// docs/percussion-instruments.md tables exactly — not this app's own musical range the way
// e.g. model/fxParams.js's Filter/Delay ranges are (those genuinely aren't documented by
// webdsp itself). Every kind's are authoritative straight from the engine's own control
// contract (`getInstrumentParams` — the engine self-describes every instrument's controls),
// so there's no reason to invent different ones here.
export const KICK_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 30, max: 120, default: 50, step: 1, unit: "Hz" },
  { id: "pitchDrop", webdspParam: "PitchDrop", label: "Pitch Drop", min: 0, max: 4, default: 2.5, step: 0.1, unit: "oct" },
  { id: "pitchDecay", webdspParam: "PitchDecay", label: "Pitch Decay", min: 0.005, max: 0.25, default: 0.04, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 2, default: 0.45, step: 0.01, unit: "s" },
  { id: "punch", webdspParam: "Punch", label: "Punch", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

// Snare/Clap/Tom/Hi-Hat — mirror webdsp's own docs/percussion-instruments.md table exactly,
// the same hand-mirroring convention KICK_PARAMS above already follows.
export const SNARE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 100, max: 400, default: 185, step: 1, unit: "Hz" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 0.8, default: 0.22, step: 0.01, unit: "s" },
  { id: "snap", webdspParam: "Snap", label: "Snap", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
];

export const CLAP_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 600, max: 3000, default: 1300, step: 1, unit: "Hz" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 0.8, default: 0.25, step: 0.01, unit: "s" },
  { id: "spread", webdspParam: "Spread", label: "Spread", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "snap", webdspParam: "Snap", label: "Snap", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
];

export const TOM_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 60, max: 400, default: 120, step: 1, unit: "Hz" },
  { id: "pitchDrop", webdspParam: "PitchDrop", label: "Pitch Drop", min: 0, max: 2, default: 0.6, step: 0.1, unit: "oct" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.1, max: 1.5, default: 0.45, step: 0.01, unit: "s" },
  { id: "body", webdspParam: "Body", label: "Body", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "damp", webdspParam: "Damp", label: "Damp", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

export const HIHAT_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: -12, max: 12, default: 0, step: 1, unit: "st" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.02, max: 1.2, default: 0.08, step: 0.01, unit: "s" },
  { id: "metal", webdspParam: "Metal", label: "Metal", min: 0, max: 1, default: 0.7, step: 0.01, unit: "" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
];

// One entry per webdsp InstrumentKind, mirroring the `{ id, name, category, params }` shape
// `runtime.getCapabilities().instruments` itself reports (node_modules/webdsp's
// docs/instruments.md) — model/ stays webdsp-free (docs/EXTENDING.md's layer map) so this is a
// hand-mirror, not a live read, but it means this one table is both the param catalog lookup
// (SYNTH_PARAMS_BY_KIND below) and the only place UI code needs to iterate to list every synth
// kind (ui/chrome/InstrumentPanel.jsx's output-type buttons) — not a second, separate list of
// instrument names.
export const SYNTH_KINDS = [
  { id: "kick", name: "Kick", category: "drum", params: KICK_PARAMS },
  { id: "snare", name: "Snare", category: "drum", params: SNARE_PARAMS },
  { id: "clap", name: "Clap", category: "drum", params: CLAP_PARAMS },
  { id: "tom", name: "Tom", category: "drum", params: TOM_PARAMS },
  { id: "hihat", name: "Hi-Hat", category: "drum", params: HIHAT_PARAMS },
];

// Registry of every synthesized-instrument kind's own param catalog, keyed by the same string
// `Instrument.output.kind` (model/instrument.js) uses. Derived from SYNTH_KINDS above rather
// than hand-listed again.
export const SYNTH_PARAMS_BY_KIND = Object.fromEntries(SYNTH_KINDS.map((k) => [k.id, k.params]));

export function getSynthParams(kind) {
  return SYNTH_PARAMS_BY_KIND[kind] ?? [];
}

export function getSynthParam(kind, id) {
  return getSynthParams(kind).find((param) => param.id === id);
}

export function defaultSynthParamValues(kind) {
  return Object.fromEntries(getSynthParams(kind).map((param) => [param.id, param.default]));
}

function decimalsForStep(step) {
  if (!step || step >= 1) return 0;
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function formatSynthParamValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
