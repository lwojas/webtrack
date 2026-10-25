// Bridges model/instrument.js's output.type === "instrument" slots to webdsp's synthesized-
// instrument API (AudioRuntime.createInstrument/removeInstrument/instrumentNoteOn/
// setInstrumentParameter — node_modules/webdsp's docs/instruments.md) — the audio/ counterpart
// to audio/fx.js's FX bridging and audio/instrumentGain.js's sample-gain bridging. webtrack
// never reimplements the Kick's (or any future synthesized instrument's) DSP — this file only
// ever creates/addresses an opaque webdsp InstrumentId.
//
// webdsp's InstrumentId, like a sample's sampleId, only means anything for the current
// AudioRuntime session — never persisted (see model/instrument.js#engineInstrumentId's own doc
// comment). This module is the one place that creates/destroys/addresses one, writing the
// result straight onto the owning Instrument model object's `engineInstrumentId` field so
// audio/compile.js can read it the same inert way it already reads `sampleId`.
//
// Routing: a synth instrument instance renders to MASTER_BUS by default, or — if the slot's
// output.track (model/instrument.js's own doc comment) names one — into that track's own insert
// bus instead, exactly like a sample voice can (audio/compile.js's `bus` param). webdsp bakes an
// instrument's bus in at createInstrument() time and has no way to move it afterward (unlike an
// FX chain instance's moveEffect), so a track-routing change (same as a kind change) means
// tearing down and recreating the live instance — createSynthInstrument below already does an
// unconditional teardown-then-create every call, so this falls out for free. `output.track` is a
// single either/or choice, not a chain: webdsp has no bus-of-a-bus summing (every bus sums
// straight into MASTER_BUS, never into another non-master bus), and Event.instrument is a plain
// index, not bound to one track, so routing is the slot's own explicit choice (model/
// instrument.js) rather than inferred from whichever track happens to trigger it — that would be
// an arbitrary, order-dependent pick if more than one track's cells ever addressed the slot.
import { InstrumentCommonParam, InstrumentKind, KickParam, SnareParam, ClapParam, TomParam, HiHatParam, BassParam, PulseParam, PadParam, FmParam, HypersawParam, PwmBeastParam, DmThumpParam, DmMetalParam, DmToneParam, DmCrackParam, DmChaosParam, PercSynthParam, EdgeParam, MASTER_BUS } from "webdsp";
import { initRuntime, ensureTrackBuses } from "./runtime.js";
import { getSynthParams } from "../model/instrumentParams.js";
import { planLfoUpdates } from "./instrumentLfo.js";

const ENGINE_KIND_BY_NAME = {
  kick: InstrumentKind.Kick,
  snare: InstrumentKind.Snare,
  clap: InstrumentKind.Clap,
  tom: InstrumentKind.Tom,
  hihat: InstrumentKind.HiHat,
  bass: InstrumentKind.Bass,
  pulse: InstrumentKind.Pulse,
  pad: InstrumentKind.Pad,
  fm: InstrumentKind.Fm,
  hypersaw: InstrumentKind.Hypersaw,
  pwmbeast: InstrumentKind.PwmBeast,
  dm_thump: InstrumentKind.DmThump,
  dm_metal: InstrumentKind.DmMetal,
  dm_tone: InstrumentKind.DmTone,
  dm_crack: InstrumentKind.DmCrack,
  dm_chaos: InstrumentKind.DmChaos,
  percsynth: InstrumentKind.PercSynth,
  edge: InstrumentKind.Edge,
};

const WEBDSP_ENUM_BY_KIND = {
  kick: KickParam,
  snare: SnareParam,
  clap: ClapParam,
  tom: TomParam,
  hihat: HiHatParam,
  bass: BassParam,
  pulse: PulseParam,
  pad: PadParam,
  fm: FmParam,
  hypersaw: HypersawParam,
  pwmbeast: PwmBeastParam,
  dm_thump: DmThumpParam,
  dm_metal: DmMetalParam,
  dm_tone: DmToneParam,
  dm_crack: DmCrackParam,
  dm_chaos: DmChaosParam,
  percsynth: PercSynthParam,
  edge: EdgeParam,
};

const PARAM_ENUM_CACHE = Object.fromEntries(
  Object.keys(WEBDSP_ENUM_BY_KIND).map((kind) => [
    kind,
    new Map(
      getSynthParams(kind).map((param) => [
        param.id,
        // A kind's own control, else one every kind shares (the source gain).
        WEBDSP_ENUM_BY_KIND[kind][param.webdspParam] ?? InstrumentCommonParam[param.webdspParam],
      ]),
    ),
  ]),
);

export function resolveInstrumentParam(kind, paramId) {
  return PARAM_ENUM_CACHE[kind]?.get(paramId);
}

function pushParamValues(runtime, engineInstrumentId, kind, values) {
  for (const param of getSynthParams(kind)) {
    const paramEnum = resolveInstrumentParam(kind, param.id);
    if (paramEnum === undefined) continue;
    runtime.setInstrumentParameter(engineInstrumentId, paramEnum, values?.[param.id] ?? param.default);
  }
}

// Resolves output.track (null/undefined — the default, and every project saved before this
// field existed — means MASTER_BUS) to a real webdsp BusId, mirroring audio/fx.js's own
// resolveBusId exactly (ensureTrackBuses grows the shared track-bus array as far as whatever's
// actually been asked for so far, same "trackIndex + 1, not some fixed song-wide count" reason).
async function resolveSynthBus(output) {
  if (output?.track === null || output?.track === undefined) return MASTER_BUS;
  const busIds = await ensureTrackBuses(output.track + 1);
  return busIds[output.track];
}

// Creates this slot's live webdsp instrument — tearing down any previous one first (switching a
// slot's output kind or track routing, or a project reload re-creating every "instrument"-output
// slot fresh: see resyncSynthInstruments below) — and writes its id onto
// `instrument.engineInstrumentId`, then pushes every one of the kind's own catalog values
// (instrument.instrumentParams, defaulting whatever isn't set) so it sounds like its saved
// parameters immediately rather than webdsp's own engine defaults. A no-op for an unknown kind.
export async function createSynthInstrument(instrument, kind) {
  const engineKind = ENGINE_KIND_BY_NAME[kind];
  if (engineKind === undefined) return;
  const runtime = await initRuntime();
  if (instrument.engineInstrumentId != null) {
    runtime.removeInstrument(instrument.engineInstrumentId);
    lfoSent.delete(instrument.engineInstrumentId);
  }
  const bus = await resolveSynthBus(instrument.output);
  instrument.engineInstrumentId = runtime.createInstrument(engineKind, { bus });
  pushParamValues(runtime, instrument.engineInstrumentId, kind, instrument.instrumentParams);
  lfoSent.set(instrument.engineInstrumentId, []);
  applyLfos(runtime, instrument, kind);
}

// --- LFO modulation (webdsp docs/lfo-modulation.md) ---
// Last signature pushed per live engine instrument and LFO slot, so an unchanged slot is never
// resent (the engine keeps an LFO's phase running across edits; resending is harmless but noisy).
const lfoSent = new Map();

// What the engine offers for `kind` (the modulation slot UI's option lists): the shared waveform
// and division names, the LFO count, and the synth's own modulation targets by control name.
export function modulationOptions(runtime, kind) {
  const engineKind = ENGINE_KIND_BY_NAME[kind];
  if (engineKind === undefined || !runtime.getModulationInfo) return null;
  const info = runtime.getModulationInfo();
  return {
    maxLfos: info.maxLfos,
    waveforms: info.waveforms,
    divisions: info.divisions.map((d) => d.name),
    targets: runtime.getModulationTargets(engineKind).map((p) => p.name),
  };
}

export async function getModulationOptions(kind) {
  return modulationOptions(await initRuntime(), kind);
}

function applyLfos(runtime, instrument, kind) {
  const options = modulationOptions(runtime, kind);
  if (!options || instrument.engineInstrumentId == null) return;
  let sent = lfoSent.get(instrument.engineInstrumentId);
  if (!sent) lfoSent.set(instrument.engineInstrumentId, (sent = []));
  const ops = planLfoUpdates(instrument.instrumentLfos, options, (name) => resolveInstrumentParam(kind, name), sent);
  for (const op of ops) {
    if (op.clear) runtime.clearInstrumentLfo(instrument.engineInstrumentId, op.slot);
    else runtime.setInstrumentLfo(instrument.engineInstrumentId, op.slot, op.settings);
  }
}

// appContext.js's instrumentController, after any LFO edit in the model: pushes the slot's LFOs.
export async function syncSynthInstrumentLfos(instrument, kind) {
  if (instrument.engineInstrumentId == null) return;
  applyLfos(await initRuntime(), instrument, kind);
}

// The InstrumentPanel's output toggle, switching a slot away from "instrument" (or removing the
// slot's project entirely) — frees the live webdsp instance so it stops counting against
// MAX_INSTRUMENTS once nothing can trigger it anymore.
export async function removeSynthInstrument(instrument) {
  if (instrument.engineInstrumentId == null) return;
  const runtime = await initRuntime();
  runtime.removeInstrument(instrument.engineInstrumentId);
  lfoSent.delete(instrument.engineInstrumentId);
  instrument.engineInstrumentId = null;
}

// ui/chrome/InstrumentPanel.jsx's editor, one control at a time — mirrors audio/fx.js's
// setTrackFxInstanceParam shape: resolve the real engine param id, no-op if this slot has no
// live engine instrument yet (e.g. the kind was just selected and createSynthInstrument's own
// initRuntime() await hasn't resolved).
export async function setSynthInstrumentParam(instrument, kind, paramId, value) {
  const paramEnum = resolveInstrumentParam(kind, paramId);
  if (paramEnum === undefined || instrument.engineInstrumentId == null) return;
  const runtime = await initRuntime();
  runtime.setInstrumentParameter(instrument.engineInstrumentId, paramEnum, value);
}

// appContext.js's one entry point for recreating every "instrument"-output slot's live webdsp
// instrument after a project load (loadProjectFromFile/restoreFromRecovery) — the engine has
// no persistence of its own, and unlike a sample's sampleId (re-obtained by re-loading its
// bytes), a synth slot has no bytes to reload: it needs a fresh createInstrument() call plus
// its saved instrumentParams pushed back, the same "every load path needs one explicit push"
// reasoning appContext.js already applies to instrument gain/envelope.
export async function resyncSynthInstruments(instruments) {
  for (const instrument of instruments) {
    if (instrument.output?.type === "instrument" && instrument.output.kind) {
      await createSynthInstrument(instrument, instrument.output.kind);
    }
  }
}
