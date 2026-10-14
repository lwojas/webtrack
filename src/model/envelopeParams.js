// Public control catalog for the per-sample ADSR amplitude envelope (webdsp's EnvelopeParams —
// see node_modules/webdsp's docs/adsr-envelope.md). Same shape/conventions as model/fxParams.js's
// FX_PARAMS (id/label/min/max/default/step/unit), but deliberately a separate, smaller catalog:
// an envelope is a per-instrument/per-sample property (model/instrument.js#envelope), never a
// track/master-bus FX-chain parameter, so it doesn't belong in FX_PARAMS/FX_TYPES (those are
// bus-level — see docs/EXTENDING.md's layer map). ui/chrome/InstrumentPanel.jsx's instrument
// editor is this catalog's only consumer today.
//
// min/max/default below mirror webdsp's own EnvelopeParams doc comment exactly (attack/decay/
// release 0..30s, sustain 0..1, defaults attack 0/decay 0/sustain 1/release 0.01) for the
// *default*, so a freshly-created instrument's envelope is bit-identical to the engine's own
// pre-envelope behavior — but the UI *max* for each time field is a musically practical ceiling
// (5s), not webdsp's own 30s engine ceiling, the same relationship model/fxParams.js's
// comp.attack/comp.release already have to their own engine maximums. A value outside this UI
// range is still valid and clamped engine-side (0..30s) — nothing here prevents a hand-edited
// project from carrying one.
export const ENVELOPE_PARAMS = [
  { id: "attack", label: "Attack", min: 0, max: 5, default: 0, step: 0.001, unit: "s" },
  { id: "decay", label: "Decay", min: 0, max: 5, default: 0, step: 0.001, unit: "s" },
  { id: "sustain", label: "Sustain", min: 0, max: 1, default: 1, step: 0.01, unit: "" },
  { id: "release", label: "Release", min: 0, max: 5, default: 0.01, step: 0.001, unit: "s" },
];

export function getEnvelopeParam(id) {
  return ENVELOPE_PARAMS.find((param) => param.id === id);
}

function decimalsForStep(step) {
  if (!step || step >= 1) return 0;
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function formatEnvelopeValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
