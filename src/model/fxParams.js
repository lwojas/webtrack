// Single source of truth for the FX parameters the tracker exposes to a human (the FX panel,
// the cell editor) or a future external control surface (tracker FX columns, Push/MIDI
// mappings — see docs/EXTENDING.md's "Adding to the external control contract"). Nothing here
// imports webdsp — this file stays as webdsp-free as model/effects.js's EFFECT_COMMANDS, for
// the same reason (model/ "No DOM, no webdsp, no React" — docs/EXTENDING.md's layer map).
// audio/fx.js is the only place that bridges `nodeParam` below to webdsp's real NodeParam enum.
//
// `id` is "<node>.<param>" — the same shape a tracker cell's sparse automation map uses
// (Event.fx = { "filter.cutoff": 1200, "delay.mix": 0.25 }, see model/event.js). Every entry
// here targets a *bus*-level NodeParam (a track's insert bus, or MASTER_BUS) — never a
// per-voice VoiceParam — matching the brief's track-FX/master-FX-only scope (no per-voice
// automation, no sends).
//
// min/max/default/step are this app's own UI-side musical ranges, not part of webdsp's
// contract (its enum doc comments give authoritative ranges for Reverb/Compressor/
// Saturation/Chorus-Flanger already; Filter/Delay/BusGain aren't range-documented there, so
// the values below are reasonable musical defaults, not an engine-mandated scale).
//
// `type` is which FX_TYPES entry this parameter belongs to (null for bus.gain — see below).
// `cellAutomatable` (default true, so most entries omit it) marks the handful of setup/
// gain-staging params that aren't natural step-automation targets — those still live on the
// FX panel, just not in the cell editor's "+ ADD FX" list (ui/chrome/NoteEditor.jsx).
export const FX_PARAMS = [
  { id: "filter.cutoff", nodeParam: "FilterCutoff", type: "filter", group: "Filter", label: "Cutoff", min: 20, max: 20000, default: 20000, step: 1, unit: "Hz" },
  { id: "filter.resonance", nodeParam: "FilterResonance", type: "filter", group: "Filter", label: "Resonance", min: 0.1, max: 20, default: 0.707, step: 0.01, unit: "Q" },
  // webdsp's NodeParam.FilterMode (0 = LowPass, 1 = HighPass — see node_modules/webdsp/lib/
  // index.d.ts's own FilterMode enum) was previously left out of this catalog entirely (see
  // docs/FX.md's "Boundaries" — "a discrete on/off mode isn't a great fit for cell automation").
  // `kind: "boolean"` is this catalog's own extension for exactly that case: a parameter whose
  // only two values are meaningfully "on"/"off" rather than a continuous range — formatFxValue
  // below renders it via onLabel/offLabel instead of a numeric string, and both FxPanel.jsx and
  // Push's encoder LCD (midi/push/encoderController.js) branch on `kind` the same way, so there's
  // exactly one definition of what this parameter means, not two. Independent of this FX's own
  // bypass toggle (FX_TYPES' bypassValues below only ever resets cutoff/resonance) — bypassing
  // the filter doesn't change which mode it's in, it just mutes the filter's effect entirely.
  { id: "filter.mode", nodeParam: "FilterMode", type: "filter", group: "Filter", label: "Mode", kind: "boolean", min: 0, max: 1, default: 0, step: 1, unit: "", onLabel: "HIGH", offLabel: "LOW", cellAutomatable: false },

  { id: "delay.time", nodeParam: "DelayTime", type: "delay", group: "Delay", label: "Time", min: 0, max: 2, default: 0.25, step: 0.001, unit: "s" },
  { id: "delay.feedback", nodeParam: "DelayFeedback", type: "delay", group: "Delay", label: "Feedback", min: 0, max: 0.95, default: 0.3, step: 0.01, unit: "" },
  { id: "delay.mix", nodeParam: "DelayMix", type: "delay", group: "Delay", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "reverb.decay", nodeParam: "ReverbDecay", type: "reverb", group: "Reverb", label: "Decay", min: 0, max: 0.9999, default: 0.5, step: 0.001, unit: "" },
  { id: "reverb.damping", nodeParam: "ReverbDamping", type: "reverb", group: "Reverb", label: "Damping", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "reverb.mix", nodeParam: "ReverbMix", type: "reverb", group: "Reverb", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "comp.threshold", nodeParam: "CompThreshold", type: "compressor", group: "Compressor", label: "Threshold", min: -60, max: 0, default: -24, step: 0.5, unit: "dB" },
  { id: "comp.ratio", nodeParam: "CompRatio", type: "compressor", group: "Compressor", label: "Ratio", min: 1, max: 20, default: 1, step: 0.1, unit: ":1" },
  { id: "comp.attack", nodeParam: "CompAttack", type: "compressor", group: "Compressor", label: "Attack", min: 0.0001, max: 1, default: 0.01, step: 0.0001, unit: "s" },
  { id: "comp.release", nodeParam: "CompRelease", type: "compressor", group: "Compressor", label: "Release", min: 0.001, max: 3, default: 0.1, step: 0.001, unit: "s" },
  { id: "comp.knee", nodeParam: "CompKnee", type: "compressor", group: "Compressor", label: "Knee", min: 0, max: 24, default: 6, step: 0.5, unit: "dB", cellAutomatable: false },
  { id: "comp.makeup", nodeParam: "CompMakeup", type: "compressor", group: "Compressor", label: "Makeup", min: -24, max: 24, default: 0, step: 0.5, unit: "dB", cellAutomatable: false },

  { id: "sat.drive", nodeParam: "SatDrive", type: "saturation", group: "Saturation", label: "Drive", min: 0, max: 40, default: 0, step: 0.5, unit: "dB" },
  { id: "sat.asymmetry", nodeParam: "SatAsymmetry", type: "saturation", group: "Saturation", label: "Asymmetry", min: -1, max: 1, default: 0, step: 0.01, unit: "", cellAutomatable: false },
  { id: "sat.outputGain", nodeParam: "SatOutputGain", type: "saturation", group: "Saturation", label: "Output", min: -24, max: 24, default: 0, step: 0.5, unit: "dB", cellAutomatable: false },
  { id: "sat.mix", nodeParam: "SatMix", type: "saturation", group: "Saturation", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "chorus.rate", nodeParam: "ChorusFlangerRate", type: "chorus", group: "Chorus/Flanger", label: "Rate", min: 0.01, max: 10, default: 0.5, step: 0.01, unit: "Hz" },
  { id: "chorus.depth", nodeParam: "ChorusFlangerDepth", type: "chorus", group: "Chorus/Flanger", label: "Depth", min: 0, max: 20, default: 5, step: 0.1, unit: "ms" },
  { id: "chorus.delay", nodeParam: "ChorusFlangerDelay", type: "chorus", group: "Chorus/Flanger", label: "Delay", min: 0.1, max: 40, default: 15, step: 0.1, unit: "ms", cellAutomatable: false },
  { id: "chorus.feedback", nodeParam: "ChorusFlangerFeedback", type: "chorus", group: "Chorus/Flanger", label: "Feedback", min: -0.95, max: 0.95, default: 0, step: 0.01, unit: "" },
  { id: "chorus.stereoPhase", nodeParam: "ChorusFlangerStereoPhase", type: "chorus", group: "Chorus/Flanger", label: "Stereo", min: 0, max: 1, default: 0.25, step: 0.01, unit: "", cellAutomatable: false },
  { id: "chorus.mix", nodeParam: "ChorusFlangerMix", type: "chorus", group: "Chorus/Flanger", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  // Not one of the six toggleable FX nodes below — the bus's own always-present output stage
  // (see FX_TYPES' doc comment), so it has no `type` and is exempt from chain-gating wherever
  // that's checked (model/mutations.js#setCellFxParam, ui/chrome/NoteEditor.jsx).
  { id: "bus.gain", nodeParam: "BusGain", type: null, group: "Output", label: "Bus Gain", min: 0, max: 2, default: 1, step: 0.01, unit: "x" },
];

// The catalog of FX a track or the master bus can choose to enable/disable — distinct from
// FX_PARAMS above, which describes every parameter the DSP supports regardless of whether any
// track actually uses it (see model/trackChannel.js#fxChain's doc comment for the full
// three-layer model: FX_TYPES → fxChain → fx values).
//
// `bypassValues` is what gets sent to the engine while this type is disabled or bypassed on a
// bus — each one is that node's own documented "neutral"/no-op value (same values as each
// param's own `default` above; webdsp's NodeParam doc comments call these out explicitly as
// each node's bypass convention — see docs/FX.md), so disabling an FX never requires a real
// engine-side bypass primitive, just re-asserting the node's inert state.
export const FX_TYPES = [
  { id: "filter", label: "Filter", bypassValues: { "filter.cutoff": 20000, "filter.resonance": 0.707 } },
  { id: "delay", label: "Delay", bypassValues: { "delay.mix": 0 } },
  { id: "reverb", label: "Reverb", bypassValues: { "reverb.mix": 0 } },
  { id: "compressor", label: "Compressor", bypassValues: { "comp.ratio": 1 } },
  { id: "saturation", label: "Saturation", bypassValues: { "sat.mix": 0 } },
  { id: "chorus", label: "Chorus/Flanger", bypassValues: { "chorus.mix": 0 } },
];

export function getFxParam(id) {
  return FX_PARAMS.find((param) => param.id === id);
}

export function getFxType(id) {
  return FX_TYPES.find((type) => type.id === id);
}

// Every FX_PARAMS entry belonging to one FX_TYPES id, in catalog order — what the FX panel
// renders one enabled chain module's sliders from (ui/chrome/FxPanel.jsx), and what seeds a
// track's `fx` bag with defaults when that type is first enabled (model/mutations.js#addTrackFx).
export function getFxParamsForType(typeId) {
  return FX_PARAMS.filter((param) => param.type === typeId);
}

// null for bus.gain (see its FX_PARAMS entry above) — callers that gate on "this param's FX
// type must be active" already treat a null type as exempt.
export function getFxTypeForParam(paramId) {
  return getFxParam(paramId)?.type ?? null;
}

function decimalsForStep(step) {
  if (!step || step >= 1) return 0;
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Shared by the FX panel, the cell editor, and Push's encoder LCD (midi/push/
// encoderController.js) so a given parameter's value always reads the same way everywhere
// (model/notes.js's toHex/noteNumberToName is the existing precedent for formatting living in
// model/, not duplicated per-consumer). A `kind: "boolean"` param (filter.mode above) has no
// natural numeric string — onLabel/offLabel stand in for it instead.
export function formatFxValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  if (param.kind === "boolean") return value >= 0.5 ? param.onLabel ?? "ON" : param.offLabel ?? "OFF";
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
