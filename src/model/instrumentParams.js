// Public control catalog for webdsp's synthesized instruments (AudioRuntime.createInstrument/
// setInstrumentParameter — node_modules/webdsp's docs/instruments.md). Same shape/conventions
// as model/fxParams.js's FX_PARAMS and model/envelopeParams.js's ENVELOPE_PARAMS (id/label/
// min/max/default/step/unit) — model/ stays webdsp-free (docs/EXTENDING.md's layer map);
// audio/instrument.js is the only place `webdspParam` below gets bridged to webdsp's real
// per-kind param enum (e.g. KickParam) and actually sent to the engine, the same split
// audio/fx.js has for FX_PARAMS#nodeParam.
//
// min/max/default/unit mirror webdsp's own docs/kick-instrument.md table exactly — not this
// app's own musical range the way e.g. model/fxParams.js's Filter/Delay ranges are (those
// genuinely aren't documented by webdsp itself). Kick's are authoritative straight from the
// engine's own control contract (`getInstrumentParams` — the engine self-describes every
// instrument's controls), so there's no reason to invent different ones here.
export const KICK_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 30, max: 120, default: 50, step: 1, unit: "Hz" },
  { id: "pitchDrop", webdspParam: "PitchDrop", label: "Pitch Drop", min: 0, max: 4, default: 2.5, step: 0.1, unit: "oct" },
  { id: "pitchDecay", webdspParam: "PitchDecay", label: "Pitch Decay", min: 0.005, max: 0.25, default: 0.04, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 2, default: 0.45, step: 0.01, unit: "s" },
  { id: "punch", webdspParam: "Punch", label: "Punch", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

// Registry of every synthesized-instrument kind's own param catalog, keyed by the same string
// `Instrument.output.kind` (model/instrument.js) uses — today just "kick", but the shape is
// already generic: a future second webdsp instrument (its own docs/instruments.md "intended
// for future instruments" list — snare, hat, bass...) is one more entry here, not a new code
// path through InstrumentPanel.jsx or audio/instrument.js.
export const SYNTH_PARAMS_BY_KIND = { kick: KICK_PARAMS };

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
