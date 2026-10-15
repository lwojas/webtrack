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
// Routing: every synth instrument instance renders straight to MASTER_BUS, never a track's own
// insert bus. webdsp bakes an instrument's bus in at createInstrument() time and has no way to
// move it afterward (unlike an FX chain instance's moveEffect) — but Event.instrument is a
// plain index, not bound to one track, so a single Kick slot can be triggered from more than
// one track's cells. Picking "whichever track happened to trigger it first" would be an
// arbitrary, order-dependent choice; MASTER_BUS is the one answer that's always correct
// regardless of which track(s) end up using the slot. The cost: a synth instrument doesn't get
// its own track's insert FX chain (filter/delay/reverb/etc.) the way a sample voice does — only
// master FX apply to it, the same limitation a MIDI-output slot already has for a different
// reason (no webdsp voice/bus to route into at all).
import { InstrumentKind, KickParam, MASTER_BUS } from "webdsp";
import { initRuntime } from "./runtime.js";
import { getSynthParams } from "../model/instrumentParams.js";

const ENGINE_KIND_BY_NAME = { kick: InstrumentKind.Kick };

const WEBDSP_ENUM_BY_KIND = { kick: KickParam };

const PARAM_ENUM_CACHE = Object.fromEntries(
  Object.keys(WEBDSP_ENUM_BY_KIND).map((kind) => [
    kind,
    new Map(getSynthParams(kind).map((param) => [param.id, WEBDSP_ENUM_BY_KIND[kind][param.webdspParam]])),
  ]),
);

function resolveInstrumentParam(kind, paramId) {
  return PARAM_ENUM_CACHE[kind]?.get(paramId);
}

function pushParamValues(runtime, engineInstrumentId, kind, values) {
  for (const param of getSynthParams(kind)) {
    const paramEnum = resolveInstrumentParam(kind, param.id);
    if (paramEnum === undefined) continue;
    runtime.setInstrumentParameter(engineInstrumentId, paramEnum, values?.[param.id] ?? param.default);
  }
}

// Creates this slot's live webdsp instrument — tearing down any previous one first (switching
// a slot's output kind, or a project reload re-creating every "instrument"-output slot fresh:
// see resyncSynthInstruments below) — and writes its id onto `instrument.engineInstrumentId`,
// then pushes every one of the kind's own catalog values (instrument.instrumentParams,
// defaulting whatever isn't set) so it sounds like its saved parameters immediately rather
// than webdsp's own engine defaults. A no-op for an unknown kind.
export async function createSynthInstrument(instrument, kind) {
  const engineKind = ENGINE_KIND_BY_NAME[kind];
  if (engineKind === undefined) return;
  const runtime = await initRuntime();
  if (instrument.engineInstrumentId != null) runtime.removeInstrument(instrument.engineInstrumentId);
  instrument.engineInstrumentId = runtime.createInstrument(engineKind, { bus: MASTER_BUS });
  pushParamValues(runtime, instrument.engineInstrumentId, kind, instrument.instrumentParams);
}

// The InstrumentPanel's output toggle, switching a slot away from "instrument" (or removing the
// slot's project entirely) — frees the live webdsp instance so it stops counting against
// MAX_INSTRUMENTS once nothing can trigger it anymore.
export async function removeSynthInstrument(instrument) {
  if (instrument.engineInstrumentId == null) return;
  const runtime = await initRuntime();
  runtime.removeInstrument(instrument.engineInstrumentId);
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
