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
import { FX_PARAMS, getFxType, getFxParamsForType, getFxTypeForParam } from "../model/fxParams.js";

const NODE_PARAM_BY_ID = new Map(FX_PARAMS.map((param) => [param.id, NodeParam[param.nodeParam]]));

export function resolveNodeParam(paramId) {
  return NODE_PARAM_BY_ID.get(paramId);
}

function pushValues(runtime, busId, values) {
  for (const paramId in values) {
    const nodeParam = resolveNodeParam(paramId);
    if (nodeParam !== undefined) runtime.setNodeParameter(busId, nodeParam, values[paramId]);
  }
}

// The subset of fxBag (a trackChannel.fx or song.masterFx bag) belonging to one FX_TYPES id —
// what gets pushed to the engine when that type is active/unbypassed, as opposed to its
// FX_TYPES#bypassValues when it isn't (see setTrackFxTypeState/setMasterFxTypeState below).
function activeValuesForType(type, fxBag) {
  const values = {};
  for (const param of getFxParamsForType(type)) {
    if (fxBag[param.id] !== undefined) values[param.id] = fxBag[param.id];
  }
  return values;
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

// One place both chain add/remove (model/mutations.js#addTrackFx/removeTrackFx) and the bypass
// toggle (#setTrackFxBypass) actually reach the engine, via appContext.js's fxController:
// `active` (enabled-and-unbypassed) pushes fxBag's own stored values for this type; otherwise
// pushes FX_TYPES#bypassValues — webdsp has no real per-node bypass primitive, so re-asserting
// each node's own documented neutral value (model/fxParams.js's FX_TYPES doc comment) is the
// bypass mechanism. fxBag is the live trackChannel.fx object, not a one-off snapshot, so this
// always reflects whatever the FX panel/cell automation most recently set.
export async function setTrackFxTypeState(trackIndex, type, active, fxBag) {
  const fxType = getFxType(type);
  if (!fxType) return;
  const runtime = await initRuntime();
  const busIds = await ensureTrackBuses(trackIndex + 1);
  pushValues(runtime, busIds[trackIndex], active ? activeValuesForType(type, fxBag) : fxType.bypassValues);
}

// Master-bus equivalent of setTrackFxTypeState above (model/song.js's masterFx/masterFxChain).
export async function setMasterFxTypeState(type, active, fxBag) {
  const fxType = getFxType(type);
  if (!fxType) return;
  const runtime = await initRuntime();
  pushValues(runtime, MASTER_BUS, active ? activeValuesForType(type, fxBag) : fxType.bypassValues);
}

// Is paramId's FX currently bypassed (or inactive) on the given fxChain? Pure/model-only — used
// by appContext.js's applyTrackFxParam/applyMasterFxParam and
// audio/playbackController.js's cell-automation wiring to decide whether a parameter write
// should actually reach the engine, or update the model only (model/fxParams.js's
// getFxTypeForParam resolves bus.gain, whose type is null, to "never bypassed" — it isn't part
// of any chain). Lives here rather than in model/ since nothing in model/ needs it — only the
// two engine-call sites above do.
export function isFxBypassed(fxChain, paramId) {
  const type = getFxTypeForParam(paramId);
  if (type === null) return false;
  const entry = fxChain.find((e) => e.type === type);
  return !entry || entry.bypassed;
}
