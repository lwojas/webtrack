// Bridges model/instrument.js's `envelope` field to webdsp's real per-sample ADSR envelope
// (SampleParam.EnvAttack..EnvRelease, exposed as AudioRuntime.setSampleEnvelope() — see
// node_modules/webdsp's docs/adsr-envelope.md) — the audio/ counterpart to
// audio/instrumentGain.js's bridging of model/instrument.js#gain to SampleParam.Gain. There is
// exactly one path from an instrument's envelope to a real runtime.setSampleEnvelope() call:
// appContext.js's instrumentController calls this whenever the envelope fields change
// (InstrumentPanel.jsx's editor) or a new sample is loaded into a slot that already has a
// non-default envelope. Only the fields actually passed are changed (webdsp's own semantics —
// see EnvelopeParams), so a single-slider edit can be pushed as a one-field partial object
// without first reading back the instrument's other three fields.
import { SampleParam } from "webdsp";
import { initRuntime } from "./runtime.js";

const ENVELOPE_SAMPLE_PARAM = {
  attack: SampleParam.EnvAttack,
  decay: SampleParam.EnvDecay,
  sustain: SampleParam.EnvSustain,
  release: SampleParam.EnvRelease,
};

// The engine's SampleParam for one envelope stage ("attack" ... "release"), for scheduled
// parameter events (audio/automation.js); undefined for anything else.
export function resolveEnvelopeParam(paramId) {
  return ENVELOPE_SAMPLE_PARAM[paramId];
}

export async function setInstrumentEnvelope(sampleId, envelope) {
  if (sampleId === null || sampleId === undefined) return;
  const runtime = await initRuntime();
  runtime.setSampleEnvelope(sampleId, envelope);
}
