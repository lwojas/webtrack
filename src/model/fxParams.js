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
export const FX_PARAMS = [
  { id: "filter.cutoff", nodeParam: "FilterCutoff", group: "Filter", label: "Cutoff", min: 20, max: 20000, default: 20000, step: 1, unit: "Hz" },
  { id: "filter.resonance", nodeParam: "FilterResonance", group: "Filter", label: "Resonance", min: 0.1, max: 20, default: 0.707, step: 0.01, unit: "Q" },

  { id: "delay.time", nodeParam: "DelayTime", group: "Delay", label: "Time", min: 0, max: 2, default: 0.25, step: 0.001, unit: "s" },
  { id: "delay.feedback", nodeParam: "DelayFeedback", group: "Delay", label: "Feedback", min: 0, max: 0.95, default: 0.3, step: 0.01, unit: "" },
  { id: "delay.mix", nodeParam: "DelayMix", group: "Delay", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "reverb.decay", nodeParam: "ReverbDecay", group: "Reverb", label: "Decay", min: 0, max: 0.9999, default: 0.5, step: 0.001, unit: "" },
  { id: "reverb.damping", nodeParam: "ReverbDamping", group: "Reverb", label: "Damping", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "reverb.mix", nodeParam: "ReverbMix", group: "Reverb", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "comp.threshold", nodeParam: "CompThreshold", group: "Compressor", label: "Threshold", min: -60, max: 0, default: -24, step: 0.5, unit: "dB" },
  { id: "comp.ratio", nodeParam: "CompRatio", group: "Compressor", label: "Ratio", min: 1, max: 20, default: 1, step: 0.1, unit: ":1" },
  { id: "comp.attack", nodeParam: "CompAttack", group: "Compressor", label: "Attack", min: 0.0001, max: 1, default: 0.01, step: 0.0001, unit: "s" },
  { id: "comp.release", nodeParam: "CompRelease", group: "Compressor", label: "Release", min: 0.001, max: 3, default: 0.1, step: 0.001, unit: "s" },
  { id: "comp.knee", nodeParam: "CompKnee", group: "Compressor", label: "Knee", min: 0, max: 24, default: 6, step: 0.5, unit: "dB" },
  { id: "comp.makeup", nodeParam: "CompMakeup", group: "Compressor", label: "Makeup", min: -24, max: 24, default: 0, step: 0.5, unit: "dB" },

  { id: "sat.drive", nodeParam: "SatDrive", group: "Saturation", label: "Drive", min: 0, max: 40, default: 0, step: 0.5, unit: "dB" },
  { id: "sat.asymmetry", nodeParam: "SatAsymmetry", group: "Saturation", label: "Asymmetry", min: -1, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "sat.outputGain", nodeParam: "SatOutputGain", group: "Saturation", label: "Output", min: -24, max: 24, default: 0, step: 0.5, unit: "dB" },
  { id: "sat.mix", nodeParam: "SatMix", group: "Saturation", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "chorus.rate", nodeParam: "ChorusFlangerRate", group: "Chorus/Flanger", label: "Rate", min: 0.01, max: 10, default: 0.5, step: 0.01, unit: "Hz" },
  { id: "chorus.depth", nodeParam: "ChorusFlangerDepth", group: "Chorus/Flanger", label: "Depth", min: 0, max: 20, default: 5, step: 0.1, unit: "ms" },
  { id: "chorus.delay", nodeParam: "ChorusFlangerDelay", group: "Chorus/Flanger", label: "Delay", min: 0.1, max: 40, default: 15, step: 0.1, unit: "ms" },
  { id: "chorus.feedback", nodeParam: "ChorusFlangerFeedback", group: "Chorus/Flanger", label: "Feedback", min: -0.95, max: 0.95, default: 0, step: 0.01, unit: "" },
  { id: "chorus.stereoPhase", nodeParam: "ChorusFlangerStereoPhase", group: "Chorus/Flanger", label: "Stereo", min: 0, max: 1, default: 0.25, step: 0.01, unit: "" },
  { id: "chorus.mix", nodeParam: "ChorusFlangerMix", group: "Chorus/Flanger", label: "Mix", min: 0, max: 1, default: 0, step: 0.01, unit: "" },

  { id: "bus.gain", nodeParam: "BusGain", group: "Output", label: "Bus Gain", min: 0, max: 2, default: 1, step: 0.01, unit: "x" },
];

export function getFxParam(id) {
  return FX_PARAMS.find((param) => param.id === id);
}

// FX_PARAMS grouped by node (Filter/Delay/Reverb/...), in declaration order — what the FX
// panel renders one module per group from (ui/chrome/FxPanel.jsx).
export function getFxParamGroups() {
  const groups = [];
  const byName = new Map();
  for (const param of FX_PARAMS) {
    let group = byName.get(param.group);
    if (!group) {
      group = { name: param.group, params: [] };
      byName.set(param.group, group);
      groups.push(group);
    }
    group.params.push(param);
  }
  return groups;
}

function decimalsForStep(step) {
  if (!step || step >= 1) return 0;
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Shared by the FX panel and the cell editor so a given parameter's value always reads the
// same way everywhere (model/notes.js's toHex/noteNumberToName is the existing precedent for
// formatting living in model/, not duplicated per-consumer).
export function formatFxValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
