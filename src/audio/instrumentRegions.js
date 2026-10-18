// Bridges model/instrument.js's `cues` to webdsp's sample cue regions
// (AudioRuntime.setSampleRegions — node_modules/webdsp's docs/sample-chop.md): the audio/
// counterpart to audio/instrumentGain.js. Regions describe the audio, so they are pushed for any
// sample with cues regardless of the slot's sampleMode; whether a note uses them is decided at
// compile time (audio/compile.js). An empty cue list clears the regions.
import { cueRegions } from "../model/chop.js";
import { initRuntime } from "./runtime.js";

export async function setInstrumentRegions(sampleId, cues) {
  if (sampleId === null || sampleId === undefined) return;
  const runtime = await initRuntime();
  const meta = runtime.getSample(sampleId);
  if (!meta) return;
  runtime.setSampleRegions(sampleId, cues && cues.length > 0 ? cueRegions(cues, meta.length) : []);
}
