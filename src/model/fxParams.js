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
  // bypass toggle (webdsp's own per-instance enable/disable — see FX_TYPES' doc comment below)
  // — bypassing the filter doesn't change which mode it's in, it just disables the instance
  // entirely.
  { id: "filter.mode", nodeParam: "FilterMode", type: "filter", group: "Filter", label: "Mode", kind: "boolean", min: 0, max: 1, default: 0, step: 1, unit: "", onLabel: "HIGH", offLabel: "LOW", cellAutomatable: false },
  // webdsp's NodeParam.FilterSlope (12 = two-pole/default, 24 = four-pole — see
  // node_modules/webdsp/lib/index.d.ts's own FilterSlope enum) is a second `kind: "boolean"`
  // filter param, same reasoning as filter.mode above: a discrete two-way choice, not a
  // continuous range. Unlike filter.mode's 0/1 value space, this one's two values (12/24) are
  // webdsp's own real engine values, sent straight through — isFxBooleanOn below reads off
  // param.min/max rather than assuming 0/1, so this didn't need a third value space invented.
  // Also independent of the filter's bypass values, for the same reason filter.mode is: bypass
  // mutes the filter's effect, it doesn't change which slope it would otherwise use.
  { id: "filter.slope", nodeParam: "FilterSlope", type: "filter", group: "Filter", label: "Slope", kind: "boolean", min: 12, max: 24, default: 12, step: 12, unit: "", onLabel: "24dB", offLabel: "12dB", cellAutomatable: false },

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

  // Phaser/Bitcrusher (node_modules/webdsp's docs/fx-chain.md, "Phaser and Bitcrusher") — added
  // alongside webdsp's generic ordered FX chains (see this file's own FX_TYPES doc comment below
  // for why FX_TYPES no longer carries bypassValues: real per-instance enable/disable replaced
  // the old "push a neutral value" bypass trick these two never needed in the first place).
  { id: "phaser.rate", nodeParam: "PhaserRate", type: "phaser", group: "Phaser", label: "Rate", min: 0.01, max: 10, default: 0.5, step: 0.01, unit: "Hz" },
  { id: "phaser.depth", nodeParam: "PhaserDepth", type: "phaser", group: "Phaser", label: "Depth", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "phaser.center", nodeParam: "PhaserCenter", type: "phaser", group: "Phaser", label: "Center", min: 100, max: 5000, default: 1000, step: 1, unit: "Hz" },
  { id: "phaser.feedback", nodeParam: "PhaserFeedback", type: "phaser", group: "Phaser", label: "Feedback", min: -0.95, max: 0.95, default: 0, step: 0.01, unit: "" },
  // Rounded to even (2..12) by the engine itself — a discrete stage count, not a continuous
  // sweep, same reasoning as comp.knee/comp.makeup above for why this is a setup param rather
  // than a cell automation target.
  { id: "phaser.stages", nodeParam: "PhaserStages", type: "phaser", group: "Phaser", label: "Stages", min: 2, max: 12, default: 4, step: 2, unit: "", cellAutomatable: false },
  { id: "phaser.mix", nodeParam: "PhaserMix", type: "phaser", group: "Phaser", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "crush.bits", nodeParam: "CrushBits", type: "bitcrusher", group: "Bitcrusher", label: "Bits", min: 1, max: 16, default: 16, step: 1, unit: "" },
  { id: "crush.downsample", nodeParam: "CrushDownsample", type: "bitcrusher", group: "Bitcrusher", label: "Downsample", min: 1, max: 64, default: 1, step: 1, unit: "" },
  { id: "crush.mix", nodeParam: "CrushMix", type: "bitcrusher", group: "Bitcrusher", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  // Utility: a bare gain stage (webdsp EffectKind.Utility). The automatable track volume: unity is
  // 0 dB, the bottom of the range is silence. Smoothed by the engine, so step automation does not
  // click. The mixer's bus.gain stays the track's plain mix state; put a Utility first in the chain
  // for "track -> Utility -> other FX" and automate its gain from cell FX.
  { id: "utility.gain", nodeParam: "UtilityGain", type: "utility", group: "Utility", label: "Gain", min: -60, max: 12, default: 0, step: 0.1, unit: "dB" },

  // Dub Delay (webdsp EffectKind.DubDelay): a tempo-synced delay. `division` is webdsp's
  // DubDelayDivision step index (not seconds): the engine derives the time from the transport BPM, so
  // it follows tempo changes by itself. `labels` is this catalog's extension for a stepped value that
  // reads as names (formatFxValue). Tone is a low-pass inside the feedback loop: repeats darken.
  { id: "dub.division", nodeParam: "DubDelayDivision", type: "dubdelay", group: "Dub Delay", label: "Time", min: 0, max: 5, default: 2, step: 1, unit: "", labels: ["1/16", "1/8", "1/8.", "1/4", "1/4.", "1/2"] },
  { id: "dub.feedback", nodeParam: "DubDelayFeedback", type: "dubdelay", group: "Dub Delay", label: "Feedback", min: 0, max: 0.95, default: 0.45, step: 0.01, unit: "" },
  { id: "dub.tone", nodeParam: "DubDelayTone", type: "dubdelay", group: "Dub Delay", label: "Tone", min: 200, max: 16000, default: 3000, step: 1, unit: "Hz" },
  { id: "dub.mix", nodeParam: "DubDelayMix", type: "dubdelay", group: "Dub Delay", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  // Not one of the toggleable FX nodes below — the bus's own always-present output stage
  // (see FX_TYPES' doc comment), so it has no `type` and is exempt from chain-gating wherever
  // that's checked (model/mutations.js#setCellFxParam, ui/chrome/NoteEditor.jsx).
  { id: "bus.gain", nodeParam: "BusGain", type: null, group: "Output", label: "Bus Gain", min: 0, max: 2, default: 1, step: 0.01, unit: "x" },
];

// The catalog of FX kinds a track or the master bus can add one or more instances of —
// distinct from FX_PARAMS above, which describes every parameter the DSP supports regardless of
// whether any track actually uses it (see model/trackChannel.js#fxChain's doc comment for the
// full three-layer model: FX_TYPES → fxChain → fx values, now chain-of-*instances* rather than
// chain-of-types — see node_modules/webdsp's docs/fx-chain.md).
//
// No `bypassValues` field (unlike before webdsp's FX chains existed): bypass is now backed by a
// real per-instance engine primitive (`AudioRuntime.setEffectEnabled` — audio/fx.js), not the old
// "push this node's neutral value" trick a bus-level-only engine required. A freshly-added
// instance is inert on its own anyway (mix 0 for Delay/Reverb/Saturation/Chorus/Phaser/
// Bitcrusher, ratio 1 for Compressor, cutoff/resonance at FX_PARAMS' own defaults for Filter —
// webdsp's own "inert until parameterized" convention, docs/fx-chain.md).
export const FX_TYPES = [
  { id: "filter", label: "Filter" },
  { id: "delay", label: "Delay" },
  { id: "reverb", label: "Reverb" },
  { id: "compressor", label: "Compressor" },
  { id: "saturation", label: "Saturation" },
  { id: "chorus", label: "Chorus/Flanger" },
  { id: "phaser", label: "Phaser" },
  { id: "bitcrusher", label: "Bitcrusher" },
  { id: "utility", label: "Utility" },
  { id: "dubdelay", label: "Dub Delay" },
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

// A `kind: "boolean"` param only ever sits at param.min (off) or param.max (on) — filter.mode's
// 0/1, filter.slope's 12/24, and whatever the next one turns out to be. Comparing against the
// midpoint rather than a hardcoded 0.5 is what lets both values mean "off"/"on" without this (or
// any of its callers: FxPanel.jsx, midi/push/encoderController.js) needing to know which boolean
// param it's looking at. Falls back to 0/1 when a param defines no min/max at all, matching this
// function's pre-filter.slope behavior.
export function isFxBooleanOn(value, param) {
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  return (value ?? param.default) >= (min + max) / 2;
}

// A human label for one fxChain entry that disambiguates stacked instances of the same kind —
// "Filter #1", "Filter #2" — counting this entry's position among same-type siblings already in
// the chain (1-based). Always numbered, even when only one instance of a kind exists, so the
// label never has to change shape the moment a second one is added (model/trackChannel.js#
// fxChain's stacking doc comment; ui/chrome/FxPanel.jsx's module headers and
// ui/chrome/NoteEditor.jsx's "+ ADD FX" dropdown both use this instead of each inventing their
// own numbering).
export function getFxInstanceLabel(fxChain, entryId) {
  const entry = fxChain.find((e) => e.id === entryId);
  if (!entry) return "";
  const fxType = getFxType(entry.type);
  const ordinal = fxChain.filter((e) => e.type === entry.type).indexOf(entry) + 1;
  return `${fxType?.label ?? entry.type} #${ordinal}`;
}

// Shared by the FX panel, the cell editor, and Push's encoder LCD (midi/push/
// encoderController.js) so a given parameter's value always reads the same way everywhere
// (model/notes.js's toHex/noteNumberToName is the existing precedent for formatting living in
// model/, not duplicated per-consumer). A `kind: "boolean"` param (filter.mode, filter.slope)
// has no natural numeric string — onLabel/offLabel stand in for it instead.
export function formatFxValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  if (param.labels) return param.labels[Math.min(param.labels.length - 1, Math.max(0, Math.round(Number(value))))] ?? "--";
  if (param.kind === "boolean") return isFxBooleanOn(value, param) ? param.onLabel ?? "ON" : param.offLabel ?? "OFF";
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
