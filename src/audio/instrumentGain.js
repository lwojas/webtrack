// Bridges model/instrument.js's `gain` field to webdsp's real per-sample gain stage
// (SampleParam.Gain) — the audio/ counterpart to audio/fx.js's bridging of model/fxParams.js
// to NodeParam. There is exactly one path from an instrument's gain to a real
// runtime.setSampleParameter() call: appContext.js's instrumentController calls this whenever
// the gain field changes (InstrumentPanel.jsx's editor) or a new sample is loaded into a slot
// that already has a non-default gain.
import { SampleParam } from "webdsp";
import { initRuntime } from "./runtime.js";

export async function setInstrumentGain(sampleId, gain) {
  if (sampleId === null || sampleId === undefined) return;
  const runtime = await initRuntime();
  runtime.setSampleParameter(sampleId, SampleParam.Gain, gain);
}
