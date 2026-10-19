// The one place model/fxParams.js's webdsp-free FX_PARAMS catalog gets bridged to webdsp's
// real NodeParam/EffectKind enums and actually sent to the engine — the audio/ counterpart to
// model/effects.js, matching docs/EXTENDING.md's "Wiring up a real effect" recipe. Both the
// FX panel (a user dragging a slider, ui/chrome/FxPanel.jsx, via appContext.js) and cell
// automation during playback (audio/lookaheadPlayer.js's tick(), via
// audio/playbackController.js) call the functions below — there is exactly one path from an FX
// parameter id to a real runtime call, never a second, parallel one for either consumer.
//
// Built on webdsp's ordered-FX-chain-of-instances primitive (node_modules/webdsp's
// docs/fx-chain.md: `addEffect`/`removeEffect`/`moveEffect`/`setEffectEnabled`/
// `setEffectParameter`/`getEffectChain`) rather than the older bus-level `setNodeParameter` —
// that legacy call creates its own hidden "legacy instance" per kind the moment it's used
// (docs/fx-chain.md's "Legacy setNodeParameter API"), which would silently coexist with (and
// double up alongside) any explicit instance this file creates for the same kind. So every
// FX_TYPES-chain parameter below goes through setEffectParameter against a real instance id;
// `setNodeParameter` is only ever used here for the two things that are genuinely bus-level, not
// chain members — BusGain (bus.gain) and BusPan (model/trackChannel.js#pan) — exactly as
// docs/fx-chain.md calls out ("BusGain / BusPan remain bus-level, not effects").
import { MASTER_BUS, NodeParam, EffectKind } from "webdsp";
import { initRuntime, ensureTrackBuses } from "./runtime.js";
import { FX_PARAMS, getFxParamsForType } from "../model/fxParams.js";
import { planLfoUpdates } from "./instrumentLfo.js";

const NODE_PARAM_BY_ID = new Map(FX_PARAMS.map((param) => [param.id, NodeParam[param.nodeParam]]));

export function resolveNodeParam(paramId) {
  return NODE_PARAM_BY_ID.get(paramId);
}

// The live EffectId of one track's chain instance (this session's own mapping), or undefined if
// the instance has no engine-side effect (yet). Synchronous: cell automation needs it per step.
export function getTrackEffectId(trackIndex, instanceId) {
  return trackEffectIds[trackIndex]?.get(instanceId);
}

const EFFECT_KIND_BY_TYPE = {
  filter: EffectKind.Filter,
  chorus: EffectKind.ChorusFlanger,
  delay: EffectKind.Delay,
  reverb: EffectKind.Reverb,
  compressor: EffectKind.Compressor,
  saturation: EffectKind.Saturation,
  phaser: EffectKind.Phaser,
  bitcrusher: EffectKind.Bitcrusher,
  utility: EffectKind.Utility,
};

// This session's own instanceId -> webdsp EffectId mapping, one Map per bus — never persisted
// (model/trackChannel.js#fxChain's own ids are the stable, save/load-able handle; a webdsp
// EffectId only means anything within the current AudioRuntime session, same relationship
// audio/runtime.js's trackBusIds already has to a project's trackIndex). Indexed by trackIndex,
// alongside a dedicated master map — mirrors audio/runtime.js's own module-level trackBusIds
// array/cache shape.
const trackEffectIds = [];
let masterEffectIds = new Map();

function effectIdMapFor(target, trackIndex) {
  if (target === "master") return masterEffectIds;
  if (!trackEffectIds[trackIndex]) trackEffectIds[trackIndex] = new Map();
  return trackEffectIds[trackIndex];
}

async function resolveBusId(target, trackIndex) {
  if (target === "master") return MASTER_BUS;
  const busIds = await ensureTrackBuses(trackIndex + 1);
  return busIds[trackIndex];
}

// --- LFO modulation (webdsp's per-effect LFO bank; docs/modulation.md) ---
// Model LFOs (model/instrumentLfos.js shape, on the chain entry) target catalog param ids
// ("filter.cutoff"); the engine's targets are NodeParam ids, so a catalog id is a valid target
// when its NodeParam is in the kind's engine-reported modulation targets. Which are valid is
// therefore asked of the engine (never listed here), and planLfoUpdates validates every slot.

// What the engine offers for an FX `type`: waveform/division names, the LFO count, and the
// modulatable catalog param ids. Null if the engine has no FX modulation (an older webdsp).
export function fxModulationOptions(runtime, type) {
  const kind = EFFECT_KIND_BY_TYPE[type];
  if (kind === undefined || !runtime.getModulationInfo || !runtime.getEffectModulationTargets) return null;
  const info = runtime.getModulationInfo();
  const engineTargets = new Set(runtime.getEffectModulationTargets(kind).map((p) => p.id));
  return {
    maxLfos: info.maxLfos,
    waveforms: info.waveforms,
    divisions: info.divisions.map((d) => d.name),
    targets: getFxParamsForType(type)
      .filter((p) => engineTargets.has(NODE_PARAM_BY_ID.get(p.id)))
      .map((p) => p.id),
  };
}

export async function getFxModulationOptions(type) {
  return fxModulationOptions(await initRuntime(), type);
}

// Last signature pushed per live engine effect and LFO slot ("bus:effect" -> string[]), so an
// unchanged slot is never resent. Dropped when the instance goes away or the chain is resynced.
const fxLfoSent = new Map();

function applyFxLfos(runtime, busId, effectId, entry) {
  const options = fxModulationOptions(runtime, entry.type);
  if (!options) return;
  const key = `${busId}:${effectId}`;
  let sent = fxLfoSent.get(key);
  if (!sent) fxLfoSent.set(key, (sent = []));
  for (const op of planLfoUpdates(entry.lfos, options, resolveNodeParam, sent)) {
    if (op.clear) runtime.clearEffectLfo(busId, effectId, op.slot);
    else runtime.setEffectLfo(busId, effectId, op.slot, op.settings);
  }
}

// appContext.js's fxController, after any LFO edit of a chain entry in the model: pushes that
// instance's LFO slots. `trackIndex` null = the master chain. A no-op without a live instance.
export async function syncFxInstanceLfos(trackIndex, entry) {
  const target = trackIndex === null ? "master" : "track";
  const runtime = await initRuntime();
  const busId = await resolveBusId(target, trackIndex);
  const effectId = effectIdMapFor(target, trackIndex).get(entry.id);
  if (effectId === undefined) return;
  applyFxLfos(runtime, busId, effectId, entry);
}

function pushInstanceValues(runtime, busId, effectId, type, values) {
  for (const param of getFxParamsForType(type)) {
    const nodeParam = resolveNodeParam(param.id);
    if (nodeParam === undefined) continue;
    runtime.setEffectParameter(busId, effectId, nodeParam, values[param.id] ?? param.default);
  }
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

// One chain instance's own parameter (ui/chrome/FxPanel.jsx's per-module sliders, and cell
// automation's instance-scoped entries — audio/playbackController.js). instanceId must already
// have a live engine-side effect (created by addTrackFxInstance below, or by a chain resync) —
// a no-op otherwise, same "nothing to address yet" shape setTrackFxParam already has for an
// unresolved nodeParam.
export async function setTrackFxInstanceParam(trackIndex, instanceId, paramId, value) {
  const nodeParam = resolveNodeParam(paramId);
  if (nodeParam === undefined) return;
  const runtime = await initRuntime();
  const busId = await resolveBusId("track", trackIndex);
  const effectId = effectIdMapFor("track", trackIndex).get(instanceId);
  if (effectId === undefined) return;
  runtime.setEffectParameter(busId, effectId, nodeParam, value);
}

export async function setMasterFxInstanceParam(instanceId, paramId, value) {
  const nodeParam = resolveNodeParam(paramId);
  if (nodeParam === undefined) return;
  const runtime = await initRuntime();
  const effectId = effectIdMapFor("master").get(instanceId);
  if (effectId === undefined) return;
  runtime.setEffectParameter(MASTER_BUS, effectId, nodeParam, value);
}

// Creates the new instance's real engine-side effect, appended at the end of the bus's current
// chain (webdsp's own default — docs/fx-chain.md) — called right after
// model/mutations.js#addTrackFx/addMasterFx allocates the model-side id, with that id and the
// freshly-seeded parameter bag it was given (so the new instance's catalog-default values are
// pushed immediately, not left silently at the engine's own "inert until parameterized" state
// until the user first touches a slider).
export async function addTrackFxInstance(trackIndex, instanceId, type, paramValues) {
  const runtime = await initRuntime();
  const busId = await resolveBusId("track", trackIndex);
  const effectId = runtime.addEffect(busId, EFFECT_KIND_BY_TYPE[type]);
  effectIdMapFor("track", trackIndex).set(instanceId, effectId);
  pushInstanceValues(runtime, busId, effectId, type, paramValues);
}

export async function addMasterFxInstance(instanceId, type, paramValues) {
  const runtime = await initRuntime();
  const effectId = runtime.addEffect(MASTER_BUS, EFFECT_KIND_BY_TYPE[type]);
  effectIdMapFor("master").set(instanceId, effectId);
  pushInstanceValues(runtime, MASTER_BUS, effectId, type, paramValues);
}

export async function removeTrackFxInstance(trackIndex, instanceId) {
  const runtime = await initRuntime();
  const busId = await resolveBusId("track", trackIndex);
  const idMap = effectIdMapFor("track", trackIndex);
  const effectId = idMap.get(instanceId);
  if (effectId === undefined) return;
  runtime.removeEffect(busId, effectId);
  fxLfoSent.delete(`${busId}:${effectId}`);
  idMap.delete(instanceId);
}

export async function removeMasterFxInstance(instanceId) {
  const runtime = await initRuntime();
  const idMap = effectIdMapFor("master");
  const effectId = idMap.get(instanceId);
  if (effectId === undefined) return;
  runtime.removeEffect(MASTER_BUS, effectId);
  fxLfoSent.delete(`${MASTER_BUS}:${effectId}`);
  idMap.delete(instanceId);
}

export async function setTrackFxInstanceEnabled(trackIndex, instanceId, enabled) {
  const runtime = await initRuntime();
  const busId = await resolveBusId("track", trackIndex);
  const effectId = effectIdMapFor("track", trackIndex).get(instanceId);
  if (effectId === undefined) return;
  runtime.setEffectEnabled(busId, effectId, enabled);
}

export async function setMasterFxInstanceEnabled(instanceId, enabled) {
  const runtime = await initRuntime();
  const effectId = effectIdMapFor("master").get(instanceId);
  if (effectId === undefined) return;
  runtime.setEffectEnabled(MASTER_BUS, effectId, enabled);
}

export async function moveTrackFxInstance(trackIndex, instanceId, newIndex) {
  const runtime = await initRuntime();
  const busId = await resolveBusId("track", trackIndex);
  const effectId = effectIdMapFor("track", trackIndex).get(instanceId);
  if (effectId === undefined) return;
  runtime.moveEffect(busId, effectId, newIndex);
}

export async function moveMasterFxInstance(instanceId, newIndex) {
  const runtime = await initRuntime();
  const effectId = effectIdMapFor("master").get(instanceId);
  if (effectId === undefined) return;
  runtime.moveEffect(MASTER_BUS, effectId, newIndex);
}

// Track/master bus output balance (model/trackChannel.js#pan / model/song.js#masterPan) —
// NodeParam.BusPan is bus-level, not a chain member (see this file's own module doc comment), so
// this is a plain setNodeParameter call, the same shape bus.gain's own setTrackFxParam/
// setMasterFxParam above already use.
export async function setTrackPan(trackIndex, pan) {
  const runtime = await initRuntime();
  const busIds = await ensureTrackBuses(trackIndex + 1);
  runtime.setNodeParameter(busIds[trackIndex], NodeParam.BusPan, pan);
}

export async function setMasterPan(pan) {
  const runtime = await initRuntime();
  runtime.setNodeParameter(MASTER_BUS, NodeParam.BusPan, pan);
}

// Fully rebuilds one bus's engine-side FX chain from the model's own current fxChain/fx —
// removing every effect instance the engine currently holds on that bus first (not just the
// ones this session's idMap happens to know about), then recreating the model's chain fresh, in
// order, with its stored parameter values and bypass state.
//
// Why a full teardown rather than a diff: a bus (audio/runtime.js's trackBusIds / MASTER_BUS) is
// never freed or recreated across a project load in this app — the same bus ids are reused
// session-to-session (webdsp has no "free a bus" primitive to begin with). Without this, a
// previous project's leftover effect instances on a reused bus would keep processing audio for
// the *new* project, which never asked for them and has no way to know they're there. Called
// once, right after a project loads (appContext.js's loadProjectFromFile/restoreFromRecovery) —
// every edit from then on (the FX panel's add/remove/param/bypass/move controls) keeps the
// engine in sync incrementally, the same way they always did, so a second call before each
// play() isn't needed.
async function resyncFxChain(target, trackIndex, fxChain, fxBag) {
  const runtime = await initRuntime();
  const busId = await resolveBusId(target, trackIndex);
  const idMap = effectIdMapFor(target, trackIndex);
  idMap.clear();
  for (const info of runtime.getEffectChain(busId)) {
    runtime.removeEffect(busId, info.id);
    fxLfoSent.delete(`${busId}:${info.id}`);
  }
  fxChain.forEach((entry, index) => {
    const effectId = runtime.addEffect(busId, EFFECT_KIND_BY_TYPE[entry.type], { index, enabled: !entry.bypassed });
    idMap.set(entry.id, effectId);
    pushInstanceValues(runtime, busId, effectId, entry.type, fxBag.instances?.[entry.id] ?? {});
    applyFxLfos(runtime, busId, effectId, entry);
  });
}

// appContext.js's one entry point for replaying the *entire* model (every track's fxChain/fx
// plus master's) into a live runtime — see resyncFxChain's own doc comment for why this needs to
// be a full rebuild rather than incremental pushes, and appContext.js for the two moments this
// is called (project load, and just before each play()).
export async function resyncAllFxChains(trackChannels, masterFxChain, masterFx) {
  await Promise.all(trackChannels.map((channel, trackIndex) => resyncFxChain("track", trackIndex, channel.fxChain, channel.fx)));
  await resyncFxChain("master", undefined, masterFxChain, masterFx);
}

// Is paramId's FX currently bypassed (or simply not present) on the given fxChain, keyed by
// instance id — used by appContext.js's applyTrackFxInstanceParam/applyMasterFxInstanceParam and
// audio/playbackController.js's cell-automation wiring to decide whether a parameter write
// should actually reach the engine, or update the model only.
export function isFxInstanceBypassed(fxChain, instanceId) {
  const entry = fxChain.find((e) => e.id === instanceId);
  return !entry || entry.bypassed;
}
