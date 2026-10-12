// The one place model/fxParams.js's webdsp-free FX_PARAMS catalog gets bridged to webdsp's
// real NodeParam enum and actually sent to the engine — the audio/ counterpart to
// model/effects.js, matching docs/EXTENDING.md's "Wiring up a real effect" recipe. Both the
// FX panel (a user dragging a slider, ui/chrome/FxPanel.jsx, via appContext.js) and cell
// automation during playback (audio/lookaheadPlayer.js's tick(), via
// audio/playbackController.js) call setTrackFxParam/setMasterFxParam below — there is exactly
// one path from an FX parameter id to a real runtime.setNodeParameter() call, never a second,
// parallel one for either consumer.
import { MASTER_BUS, NodeParam } from "webdsp";
import { initRuntime, ensureTrackBuses } from "./runtime.js";
import { FX_PARAMS } from "../model/fxParams.js";

const NODE_PARAM_BY_ID = new Map(FX_PARAMS.map((param) => [param.id, NodeParam[param.nodeParam]]));

export function resolveNodeParam(paramId) {
  return NODE_PARAM_BY_ID.get(paramId);
}

// trackIndex + 1 rather than some fixed/song-wide count: a slider touched for track 3 before
// playback has ever started shouldn't have to wait on knowing the song's full trackCount —
// ensureTrackBuses grows the shared array exactly as far as whatever's actually been asked
// for so far (audio/runtime.js).
export async function setTrackFxParam(trackIndex, paramId, value) {
  const nodeParam = resolveNodeParam(paramId);
  if (nodeParam === undefined) return;
  const runtime = await initRuntime();
  const busIds = await ensureTrackBuses(trackIndex + 1);
  runtime.setNodeParameter(busIds[trackIndex], nodeParam, value);
}

export async function setMasterFxParam(paramId, value) {
  const nodeParam = resolveNodeParam(paramId);
  if (nodeParam === undefined) return;
  const runtime = await initRuntime();
  runtime.setNodeParameter(MASTER_BUS, nodeParam, value);
}
