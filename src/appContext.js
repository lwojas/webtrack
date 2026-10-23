// The composition root: audio/ never imports state/ and state/ never imports audio/ (ECS-156
// plan §6/§9's layering rule), so this app-level module is what wires a store instance's
// getters/callbacks into a playbackController instance, the input layer's note
// source/edit controller into that same store, and the loop-boundary-deferred pattern-switch
// handshake between the two. Nothing under model/, audio/, ui/, or state/ imports this file —
// it's the one place that knows about all of them.
import { createStore } from "./state/store.js";
import { createPlaybackController } from "./audio/playbackController.js";
import { initRuntime, peekRuntime } from "./audio/runtime.js";
import { createMidiRouteSync } from "./audio/midiRoute.js";
import { createHostSync } from "./audio/hostSync.js";
import { getHostState, hasEmbeddedHost } from "webdsp";
import { fromHostSnapshot, publishRecord } from "./persistence/hostState.js";
import {
  setTrackFxParam,
  setMasterFxParam,
  setTrackFxInstanceParam,
  setMasterFxInstanceParam,
  addTrackFxInstance,
  addMasterFxInstance,
  removeTrackFxInstance,
  removeMasterFxInstance,
  setTrackFxInstanceEnabled,
  setMasterFxInstanceEnabled,
  moveTrackFxInstance,
  moveMasterFxInstance,
  setTrackPan,
  setMasterPan,
  resyncAllFxChains,
  syncFxInstanceLfos,
  isFxInstanceBypassed,
} from "./audio/fx.js";
import { loadSample } from "./audio/instrumentLoader.js";
import { setInstrumentGain } from "./audio/instrumentGain.js";
import { setInstrumentEnvelope } from "./audio/instrumentEnvelope.js";
import { auditionSlice } from "./audio/preview.js";
import { setInstrumentRegions } from "./audio/instrumentRegions.js";
import { createSynthInstrument, removeSynthInstrument, setSynthInstrumentParam, resyncSynthInstruments, syncSynthInstrumentLfos } from "./audio/instrument.js";
import { createDemoSong, createDemoInstruments } from "./demo/demoSong.js";
import { getSelectedPattern } from "./model/query.js";
import { createKeyboardNoteSource } from "./input/keyboardNoteMap.js";
import { createMidiNoteSource } from "./input/midiInputSource.js";
import { createEditController } from "./input/editController.js";
import { createPushDevice } from "./midi/push/pushDevice.js";
import { createPushModeController } from "./midi/push/modeController.js";
import { createPushNoteEntryMode } from "./midi/push/noteEntryMode.js";
import { createPushTrackerGridMode } from "./midi/push/trackerGridMode.js";
import { createPatternGridModeStub } from "./midi/push/patternGridModeStub.js";
import { createPushEncoderController } from "./midi/push/encoderController.js";
import { createPushTransportController } from "./midi/push/transportController.js";
import { createPushWriteMode } from "./midi/push/writeMode.js";
import { midiDeviceManager } from "./midi/deviceManager.js";
import { createRenderStats } from "./debug/renderStats.js";
import { createControlRegistry } from "./control/registry.js";
import { serializeProject, deserializeProject } from "./persistence/projectFile.js";
import { downloadProjectFile, readProjectFile } from "./persistence/projectIO.js";
import { createRecoveryScheduler, restoreRecoveryState } from "./persistence/recovery.js";
import * as localAssetStore from "./persistence/localAssetStore.js";
import { encodeWav } from "./audio/wav.js";
import * as events from "./state/events.js";

// Song-shape-changing events worth triggering a debounced local-recovery write for (see
// persistence/recovery.js) — deliberately excludes session-only state (CURSOR_MOVED,
// CLIPBOARD_CHANGED) and the playback-transient PATTERN_SWITCH_PENDING flag, none of which
// serializeProject() even reads.
const RECOVERY_TRACKED_EVENTS = [
  events.CELL_CHANGED,
  events.PATTERN_SELECTED,
  events.PATTERN_QUEUE_CHANGED,
  events.PATTERN_LENGTH_CHANGED,
  events.TRACK_LENGTH_CHANGED,
  events.TRANSPORT_CHANGED,
  events.TRACK_CHANNEL_CHANGED,
  events.TRACK_FX_CHANGED,
  events.MASTER_FX_CHANGED,
  events.PROJECT_NAME_CHANGED,
  events.INSTRUMENTS_CHANGED,
];

export function createAppContext() {
  const song = createDemoSong();
  const instruments = createDemoInstruments();
  const store = createStore({ song, instruments });
  const renderStats = createRenderStats();

  // Identifies "the project currently open" purely for the recovery record's own metadata
  // (persistence/recovery.js) — fresh on every explicit load/restore so a debounced write
  // still in flight for the *previous* project can't land under the new one (see
  // loadProjectFromFile/restoreFromRecovery below, which both cancel any pending write before
  // reassigning this). Never part of Song itself — it's a local-session concept, not musical
  // project data, so it has no business round-tripping through an explicit JSON save/load.
  let currentProjectId = crypto.randomUUID();

  // Keeps the model (trackChannel.fx/song.masterFx, so the FX panel reflects it live) in sync
  // with whichever of its two callers actually changed the always-on bus.gain parameter: the FX
  // panel's pinned Output module calls this directly; playbackController's onTrackFxChange (cell
  // automation during playback) calls the track variant with instanceId === null for the same
  // reason (see audio/compile.js#compileRowFx's own doc comment). bus.gain isn't part of any
  // chain, so there's no bypass gate here — it always reaches the engine.
  function applyTrackFxParam(trackIndex, paramId, value) {
    store.setTrackFxParam(trackIndex, paramId, value);
    setTrackFxParam(trackIndex, paramId, value);
  }

  function applyMasterFxParam(paramId, value) {
    store.setMasterFxParam(paramId, value);
    setMasterFxParam(paramId, value);
  }

  // Stacking-aware counterpart to applyTrackFxParam/applyMasterFxParam above, for one chain
  // instance's own parameter (ui/chrome/FxPanel.jsx's per-module sliders, and cell automation
  // with a real instanceId). The real engine call only happens when this instance is actually
  // not bypassed (audio/fx.js#isFxInstanceBypassed) — while bypassed, the model still keeps the
  // "intended" value (so un-bypassing needs no extra push — see applyTrackFxBypass below), but
  // the engine itself stays disabled until then.
  function applyTrackFxInstanceParam(trackIndex, instanceId, paramId, value) {
    store.setTrackFxInstanceParam(trackIndex, instanceId, paramId, value);
    const fxChain = store.getState().song.trackChannels[trackIndex]?.fxChain ?? [];
    if (!isFxInstanceBypassed(fxChain, instanceId)) setTrackFxInstanceParam(trackIndex, instanceId, paramId, value);
  }

  function applyMasterFxInstanceParam(instanceId, paramId, value) {
    store.setMasterFxInstanceParam(instanceId, paramId, value);
    if (!isFxInstanceBypassed(store.getState().song.masterFxChain, instanceId)) setMasterFxInstanceParam(instanceId, paramId, value);
  }

  // The FX panel's "+ ADD FX" control (ui/chrome/FxPanel.jsx) — bundles the model mutation
  // (model/mutations.js#addTrackFx, which allocates the new instance's id and seeds its param
  // bag to catalog defaults) with creating the matching engine-side instance
  // (audio/fx.js#addTrackFxInstance) for that same id, passing along the freshly-seeded values so
  // the new instance sounds like its defaults immediately rather than webdsp's own silent
  // "inert until parameterized" state. Unlike before FX chains existed, this is never a toggle —
  // every call adds one more independent instance, same type or not.
  function applyAddTrackFx(trackIndex, type) {
    const instanceId = store.addTrackFx(trackIndex, type);
    if (instanceId === undefined) return;
    const paramValues = store.getState().song.trackChannels[trackIndex].fx.instances[instanceId];
    addTrackFxInstance(trackIndex, instanceId, type, paramValues);
  }

  // The FX panel's remove button on one module — removes that one instance only (siblings of
  // the same type are untouched), both model-side (purging cell automation too — model/
  // mutations.js#removeTrackFx) and engine-side.
  function applyRemoveTrackFx(trackIndex, instanceId) {
    store.removeTrackFx(trackIndex, instanceId);
    removeTrackFxInstance(trackIndex, instanceId);
  }

  function applyTrackFxBypass(trackIndex, instanceId, bypassed) {
    store.setTrackFxBypass(trackIndex, instanceId, bypassed);
    setTrackFxInstanceEnabled(trackIndex, instanceId, !bypassed);
  }

  // The FX panel's move up/down buttons on one module (ui/chrome/FxPanel.jsx) — reorders the
  // model's own fxChain array (which *is* chain order — model/trackChannel.js's doc comment),
  // then mirrors the instance's new position into webdsp's own moveEffect().
  function applyMoveTrackFx(trackIndex, instanceId, direction) {
    store.moveTrackFx(trackIndex, instanceId, direction);
    const chain = store.getState().song.trackChannels[trackIndex].fxChain;
    const newIndex = chain.findIndex((entry) => entry.id === instanceId);
    if (newIndex !== -1) moveTrackFxInstance(trackIndex, instanceId, newIndex);
  }

  // Master-bus equivalents of applyAddTrackFx/applyRemoveTrackFx/applyMoveTrackFx above
  // (model/song.js's masterFx/masterFxChain).
  function applyAddMasterFx(type) {
    const instanceId = store.addMasterFx(type);
    if (instanceId === undefined) return;
    const paramValues = store.getState().song.masterFx.instances[instanceId];
    addMasterFxInstance(instanceId, type, paramValues);
  }

  function applyRemoveMasterFx(instanceId) {
    store.removeMasterFx(instanceId);
    removeMasterFxInstance(instanceId);
  }

  function applyMasterFxBypass(instanceId, bypassed) {
    store.setMasterFxBypass(instanceId, bypassed);
    setMasterFxInstanceEnabled(instanceId, !bypassed);
  }

  function applyMoveMasterFx(instanceId, direction) {
    store.moveMasterFx(instanceId, direction);
    const newIndex = store.getState().song.masterFxChain.findIndex((entry) => entry.id === instanceId);
    if (newIndex !== -1) moveMasterFxInstance(instanceId, newIndex);
  }

  // FX LFOs (the MODULATION section of an FX module in ui/chrome/FxPanel.jsx): update the chain
  // entry in the model, then push that instance's LFO slots to the live engine effect.
  // `trackIndex` null = the master chain.
  function applyFxLfoChange(trackIndex, instanceId, change) {
    change();
    const chain = trackIndex === null ? store.getState().song.masterFxChain : store.getState().song.trackChannels[trackIndex]?.fxChain;
    const entry = chain?.find((e) => e.id === instanceId);
    if (entry) syncFxInstanceLfos(trackIndex, entry);
  }

  // Track/master bus pan (ui/chrome/Mixer.jsx's ChannelStrip for a track; the FX panel's pinned
  // Output module, right alongside bus.gain, for the master — model/trackChannel.js#pan's own
  // doc comment explains why MASTER_BUS's pan lives there instead of a dedicated mixer strip).
  // Always reaches the engine immediately, same as bus.gain — NodeParam.BusPan isn't part of any
  // chain, so there's no bypass gate.
  function applyTrackPan(trackIndex, pan) {
    store.setTrackChannelPan(trackIndex, pan);
    setTrackPan(trackIndex, pan);
  }

  function applyMasterPan(pan) {
    store.setMasterPan(pan);
    setMasterPan(pan);
  }

  // The FX panel's (ui/chrome/FxPanel.jsx) and Mixer's (ui/chrome/Mixer.jsx) one entry point for
  // every bus-level change — parameter edits (both bus.gain and one chain instance's own
  // params), adding/removing/reordering/bypassing an instance, and pan — so neither ever has to
  // touch audio/fx.js or state/store.js's FX/pan methods separately. Defined up here (rather
  // than alongside instrumentController near the bottom) because midi/push/
  // encoderController.js's own FX-mode encoders need this same object, constructed below, before
  // any of its other dependents.
  const fxController = {
    setTrackFxParam: applyTrackFxParam,
    setMasterFxParam: applyMasterFxParam,
    setTrackFxInstanceParam: applyTrackFxInstanceParam,
    setMasterFxInstanceParam: applyMasterFxInstanceParam,
    addTrackFx: applyAddTrackFx,
    removeTrackFx: applyRemoveTrackFx,
    setTrackFxBypass: applyTrackFxBypass,
    moveTrackFx: applyMoveTrackFx,
    addMasterFx: applyAddMasterFx,
    removeMasterFx: applyRemoveMasterFx,
    setMasterFxBypass: applyMasterFxBypass,
    moveMasterFx: applyMoveMasterFx,
    setTrackPan: applyTrackPan,
    setMasterPan: applyMasterPan,
    // trackIndex null = the master chain.
    addFxLfo: (trackIndex, instanceId, paramId) => applyFxLfoChange(trackIndex, instanceId, () => store.addFxLfo(trackIndex, instanceId, paramId)),
    setFxLfo: (trackIndex, instanceId, lfoIndex, patch) => applyFxLfoChange(trackIndex, instanceId, () => store.setFxLfo(trackIndex, instanceId, lfoIndex, patch)),
    removeFxLfo: (trackIndex, instanceId, lfoIndex) => applyFxLfoChange(trackIndex, instanceId, () => store.removeFxLfo(trackIndex, instanceId, lfoIndex)),
  };

  // Instrument gain (ui/chrome/InstrumentPanel.jsx's editor): updates the model, then pushes
  // the live webdsp call — but only if this slot already has a sample loaded (a slot without
  // one has no sampleId to address yet; the value is still saved on the instrument and gets
  // pushed the moment a sample loads, see applyInstrumentSample below).
  function applyInstrumentGain(index, gain) {
    store.setInstrumentGain(index, gain);
    const instrument = store.getState().instruments[index];
    if (instrument?.sampleId != null) setInstrumentGain(instrument.sampleId, gain);
  }

  // Instrument ADSR envelope (ui/chrome/InstrumentPanel.jsx's editor, directly below Gain) — same
  // shape as applyInstrumentGain above: update the model (only the fields actually passed
  // change, same semantics as webdsp's own setSampleEnvelope — model/instrument.js#envelope's doc
  // comment), then push live if this slot already has a sample loaded.
  function applyInstrumentEnvelope(index, envelope) {
    store.setInstrumentEnvelope(index, envelope);
    const instrument = store.getState().instruments[index];
    if (instrument?.sampleId != null) setInstrumentEnvelope(instrument.sampleId, envelope);
  }

  // Chop playback (ui/chrome/InstrumentPanel.jsx's PITCH toggle and ui/chrome/ChopEditor.jsx): the
  // mode is model-only (read at compile time); cue points are model + a live push of the sample's
  // regions to the engine, only if a sample is loaded (otherwise pushed when one loads).
  function applyInstrumentSampleMode(index, mode) {
    store.setInstrumentSampleMode(index, mode);
    if (mode !== "chop") store.setChopEditorOpen(false);
  }

  function applyInstrumentCues(index, cues) {
    store.setInstrumentCues(index, cues);
    const instrument = store.getState().instruments[index];
    if (instrument?.sampleId != null) setInstrumentRegions(instrument.sampleId, instrument.cues, instrument.chopStart);
  }

  function applyInstrumentChopStart(index, start) {
    store.setInstrumentChopStart(index, start);
    const instrument = store.getState().instruments[index];
    if (instrument?.sampleId != null) setInstrumentRegions(instrument.sampleId, instrument.cues, instrument.chopStart);
  }

  // InstrumentPanel.jsx's output toggle (SAMPLE/MIDI/an "instrument" kind like KICK) — bundles
  // the model update (store.setInstrumentOutput, which also seeds instrumentParams defaults
  // the first time a slot switches to "instrument" — see that method's own doc comment) with
  // the matching live engine change: create this slot's webdsp instrument when switching into
  // "instrument" output, or free whatever it had when switching away from it (including to a
  // *different* output, not just back to "sample" — audio/instrument.js#removeSynthInstrument
  // is a no-op if there's nothing to free).
  async function applyInstrumentOutput(index, output) {
    store.setInstrumentOutput(index, output);
    const instrument = store.getState().instruments[index];
    if (output.type === "instrument" && output.kind) {
      await createSynthInstrument(instrument, output.kind);
    } else {
      await removeSynthInstrument(instrument);
    }
  }

  // Synthesized-instrument control (ui/chrome/InstrumentPanel.jsx's Kick sliders etc.) — same
  // split as applyInstrumentGain/applyInstrumentEnvelope: update the model, then push live only
  // if this slot actually has a live engine instrument yet (audio/instrument.js's own "nothing
  // to address" no-op covers the gap between selecting a kind and createSynthInstrument's
  // initRuntime() await resolving).
  function applyInstrumentParam(index, paramId, value) {
    store.setInstrumentParam(index, paramId, value);
    const instrument = store.getState().instruments[index];
    if (instrument?.output?.type === "instrument" && instrument.output.kind) {
      setSynthInstrumentParam(instrument, instrument.output.kind, paramId, value);
    }
  }

  // LFO modulation slots (ui/chrome/InstrumentPanel.jsx's MODULATION section): update the model,
  // then push the slot's LFOs to the live engine instrument if it has one (same split as above).
  function applyInstrumentLfoChange(index, change) {
    change();
    const instrument = store.getState().instruments[index];
    if (instrument?.output?.type === "instrument" && instrument.output.kind) {
      syncSynthInstrumentLfos(instrument, instrument.output.kind);
    }
  }

  // The one place a sample gets assigned into an instrument slot (a file picked in
  // InstrumentPanel.jsx, the bundled demo kit below, or a completed resample — see
  // handleResample) — bundles the model update with pushing that slot's already-set gain and
  // envelope to the engine for the *new* sampleId, so a previously-customized instrument gain/
  // envelope survives loading a different sample into the same slot instead of silently
  // reverting to the engine's defaults. Also the one place every loaded sample's bytes get a
  // localAssetId and are written to persistence/localAssetStore.js's IndexedDB-backed store —
  // fire-and-forget, off the critical path, so this never blocks on (or fails over) a storage
  // write; see model/instrument.js's origin doc comment for what that id is for.
  function applyInstrumentSample(index, sampleId, name, sampleAsset, origin = "import") {
    const localAssetId = sampleAsset ? crypto.randomUUID() : null;
    store.setInstrumentSample(index, sampleId, name, sampleAsset, { origin, localAssetId });
    if (localAssetId) {
      localAssetStore
        .putLocalAsset({ id: localAssetId, mimeType: sampleAsset.mimeType, fileName: sampleAsset.fileName, data: sampleAsset.buffer })
        .catch(() => {});
    }
    const instrument = store.getState().instruments[index];
    setInstrumentGain(sampleId, instrument.gain);
    setInstrumentEnvelope(sampleId, instrument.envelope);
    setInstrumentRegions(sampleId, instrument.cues, instrument.chopStart);
  }

  // Assigns a localAssetId (and writes bytes to localAssetStore) to any just-loaded instrument
  // that doesn't already have one — every project loaded before this feature existed embeds
  // samples as base64 only, with no local reference at all. Without this, editing such a
  // project would produce a local-recovery snapshot (embedSampleBytes: false) with that
  // instrument's sample silently dropped, since there'd be nothing for it to reference (see
  // persistence/projectFile.js#serializeInstrument's fallback). Called once right after a
  // project loads (explicit file or recovery restore), never on every edit.
  function backfillLocalAssetIds(instruments) {
    for (const instrument of instruments) {
      if (!instrument.sampleAsset || instrument.localAssetId) continue;
      instrument.localAssetId = crypto.randomUUID();
      localAssetStore
        .putLocalAsset({
          id: instrument.localAssetId,
          mimeType: instrument.sampleAsset.mimeType,
          fileName: instrument.sampleAsset.fileName,
          data: instrument.sampleAsset.buffer,
        })
        .catch(() => {});
    }
  }

  const playbackController = createPlaybackController({
    getSong: () => store.getState().song,
    getTrackChannels: () => store.getState().song.trackChannels,
    getInstruments: () => store.getState().instruments,
    getBpm: () => store.getState().song.bpm,
    getSwing: () => store.getState().song.swing,
    onTransportChange: ({ playing, hostBpm }) => store.setTransport(playing, hostBpm ?? null),
    onPatternSwitchPending: (pending) => store.setPatternSwitchPending(pending),
    // Cell FX automation already calls audio/fx.js's setTrackFxParam/setTrackFxInstanceParam
    // itself (see playbackController.js) for the real engine call — this callback only needs to
    // keep the model in sync, not repeat that call. instanceId === null is the one flat,
    // non-chain entry (bus.gain — audio/compile.js#compileRowFx's own doc comment).
    onTrackFxChange: (trackIndex, instanceId, paramId, value) => {
      if (instanceId === null) store.setTrackFxParam(trackIndex, paramId, value);
      else store.setTrackFxInstanceParam(trackIndex, instanceId, paramId, value);
    },
  });

  // A runtime hosted by a plugin needs no user gesture, and the host's transport can start before anyone
  // clicks Play: bring the runtime up now and follow the host's transport (audio/hostSync.js). In a
  // browser hasEmbeddedHost() is false and none of this runs.
  if (hasEmbeddedHost()) {
    initRuntime()
      .then((runtime) => {
        createHostSync({ runtime, getTransport: () => playbackController });
        midiRouteSync.sync();
      })
      .catch(() => {});
  }

  // Selecting a pattern always repaints the grid (the edit view) immediately — see
  // state/store.js's selectPattern. Whether that's also what plays next depends on whether
  // playback is running: while stopped, playbackController.switchPattern() is a no-op and the
  // next play() call reads the newly selected pattern fresh anyway; while playing, it requests
  // a switch deferred to the next loop boundary (ECS-156 plan §6/§7).
  function notifyPlaybackOfSelectedPattern() {
    playbackController.switchPattern(getSelectedPattern(store.getState().song));
  }
  store.subscribe(events.PATTERN_SELECTED, notifyPlaybackOfSelectedPattern);

  // Mute/solo need to silence whatever's already sounding the instant they're toggled, not
  // just gate future note triggers (see playbackController.js#syncTrackMuting's own doc
  // comment) — every mute/solo/volume/voiceMode edit fires this same event, so this just
  // recomputes and is a no-op unless mute/solo actually changed what's audible.
  store.subscribe(events.TRACK_CHANNEL_CHANGED, () => playbackController.syncTrackMuting());

  // Local project recovery (persistence/recovery.js) — a debounced, asset-free snapshot after
  // every meaningful edit, so an accidental reload/close can offer to restore the latest local
  // state without the user having to remember to Save. Deliberately not synchronous: the whole
  // point of the debounce is that a burst of CELL_CHANGED events while editing (one per
  // keystroke) collapses into one write, not one per event — see persistence/recovery.js's
  // own doc comment.
  // A host with its own session (a plugin) keeps the project there instead (persistence/hostState.js).
  const hostState = getHostState();
  // Until the host has said what its session holds (a snapshot, or nothing), nothing is published: a publish before the
  // restore arrives could overwrite the saved session. A host publish is also quick (a plugin window can be closed at any
  // moment and the page, with any pending write, goes with it); the local recovery write can afford to be slower.
  let hostAnswered = !hostState;
  const HOST_PUBLISH_DEBOUNCE_MS = 300;
  const recoveryScheduler = createRecoveryScheduler({
    debounceMs: hostState ? HOST_PUBLISH_DEBOUNCE_MS : undefined,
    writeRecoveryState: hostState
      ? async (record) => publishRecord(hostState, record, store.getState().instruments)
      : localAssetStore.putRecoveryState,
  });
  function scheduleRecoverySnapshot() {
    if (!hostAnswered) return;
    const state = store.getState();
    recoveryScheduler.schedule({
      projectId: currentProjectId,
      projectName: state.song.name,
      song: state.song,
      instruments: state.instruments,
      ui: { selectedInstrumentIndex: state.selectedInstrumentIndex, octave: state.octave, editStep: state.editStep, cursor: state.cursor },
    });
  }
  RECOVERY_TRACKED_EVENTS.forEach((event) => store.subscribe(event, scheduleRecoverySnapshot));

  // The one play/stop toggle every transport control actually calls — App.jsx's keyboard
  // shortcut, and now midi/push/transportController.js's Play button. Awaits
  // ensureDemoInstrumentsLoaded() (defined further down, but a hoisted function declaration, so
  // referencing it here is safe) before the first play(), the documented autoplay-gesture +
  // demo-kit-load race (ARCHITECTURE.md's Gotcha #4) — previously only App.jsx's own inline
  // closure did this; centralizing it here means Push's Play button can't bypass that race
  // avoidance by routing straight to playbackController itself.
  async function togglePlayback() {
    if (playbackController.isPlaying()) {
      playbackController.stop();
    } else {
      await ensureDemoInstrumentsLoaded();
      playbackController.play();
    }
  }

  // Live note input: the computer keyboard (always present) and, once a real device is
  // connected, any Web MIDI input (keyboard, controller) — both implement the same
  // noteInputSource.js contract, so editController.js's handleNoteOn treats a note from either
  // identically. See input/editController.js's own doc comment on attach() for why this is one
  // array passed to a single createEditController, not a second controller instance.
  const keyboardNoteSource = createKeyboardNoteSource({ getOctave: () => store.getState().octave });
  // A host that can play incoming MIDI itself (capabilities.midiRouting) is told what a key plays (audio/midiRoute.js: what the audition of
  // the selected instrument on the cursor's track plays) and plays it natively: low latency, with the window closed. The note is still
  // delivered here for note entry, flagged `routed`, so it is not also played by the page. Re-declared whenever any of the things the route
  // depends on changes (selection and cursor move on CURSOR_MOVED), and once the runtime is up.
  const midiRouteSync = createMidiRouteSync({ getRuntime: peekRuntime, getState: () => store.getState() });
  [events.CURSOR_MOVED, events.TRACK_CHANNEL_CHANGED, events.INSTRUMENTS_CHANGED, events.SCALE_CHANGED, events.RESAMPLE_STATUS_CHANGED].forEach((event) =>
    store.subscribe(event, midiRouteSync.sync),
  );
  const midiNoteSource = createMidiNoteSource({ isRouted: midiRouteSync.isRouted });

  // Push Mk1, wired as a controller surface on top of (not instead of) the generic MIDI
  // keyboard path above — see src/midi/push/modeController.js's own doc comment for the
  // CC50/51/112/113 mode state machine this drives. pushNoteEntryMode is both a gridContent
  // entry (receives decoded pad events while pushMode === "note") and, via the same object,
  // a regular noteSources entry (editController.js never needs to know a note came from a
  // Push pad instead of a keyboard). pushTrackerGridMode needs playbackController (already
  // constructed above) for its live playhead LEDs.
  const pushDevice = createPushDevice();
  // Write mode (CC86/Record — docs/MIDI.md) is a cross-cutting toggle independent of
  // modeController.js's own pushMode/sessionView state, so it's constructed up front and handed
  // into noteEntryMode/trackerGridMode as a plain dependency (the same "pull isActive() lazily"
  // shape playbackController is already handed into trackerGridMode as) — neither of those two
  // needs to know write mode toggled; they just check it inside their own pad/CC handlers.
  const pushWriteMode = createPushWriteMode({ device: pushDevice });
  const pushNoteEntryMode = createPushNoteEntryMode({ device: pushDevice, store, writeMode: pushWriteMode });
  const pushTrackerGridMode = createPushTrackerGridMode({ device: pushDevice, store, playbackController, writeMode: pushWriteMode });
  const pushModeController = createPushModeController({
    device: pushDevice,
    gridContent: {
      note: pushNoteEntryMode,
      "session.tracker": pushTrackerGridMode,
      "session.pattern": createPatternGridModeStub({ device: pushDevice }),
    },
  });
  // Encoders (volume/FX/cellEdit modes + LCD) and the Play button are each a physically
  // separate control group from the 8x8 pad grid, so they're attached independently of
  // pushModeController rather than folded into its gridContent dispatch — pushDevice.js already
  // supports more than one onMessage listener, exactly for this.
  const pushEncoderController = createPushEncoderController({ device: pushDevice, store, fxController });
  const pushTransportController = createPushTransportController({ device: pushDevice, store, togglePlayback });

  // Write mode toggling needs to immediately (a) flip the encoder/LCD surface over to
  // representing the selected cell and (b) repaint whichever grid content is currently active
  // (so a Session/Grid cursor highlight appears/disappears the instant Record is pressed, not on
  // the next unrelated cursor move) — the composition root is where that cross-controller
  // wiring belongs (docs/ARCHITECTURE.md's module map), the same way pushDevice's own
  // onConnectionChange is wired to refreshPushState() below.
  pushWriteMode.onChange((active) => {
    pushEncoderController.setCellEditMode(active);
    pushModeController.refresh();
  });

  // The one entry point for "fully resync whatever's currently on the device" — a Push
  // reconnect (wired below via pushDevice.onConnectionChange) and the Settings modal's manual
  // refresh button both call this, rather than each re-deriving what a full repaint means.
  function refreshPushState() {
    pushModeController.refresh();
    pushEncoderController.refresh();
    pushTransportController.refresh();
    pushWriteMode.refresh();
  }
  pushDevice.onConnectionChange((connected) => {
    if (connected) refreshPushState();
  });

  function attachPush() {
    const detachDevice = pushDevice.attach();
    const detachController = pushModeController.attach();
    const detachEncoders = pushEncoderController.attach();
    const detachTransport = pushTransportController.attach();
    const detachWriteMode = pushWriteMode.attach();
    return () => {
      detachWriteMode();
      detachTransport();
      detachEncoders();
      detachController?.();
      detachDevice();
    };
  }

  // ui/chrome/SettingsModal.jsx's one entry point for MIDI device visibility/connection — never
  // duplicates midiDeviceManager.js's or pushDevice.js's own connection logic, just exposes it.
  const midiController = {
    requestAccess: midiDeviceManager.requestAccess,
    subscribeDevices: midiDeviceManager.subscribe,
    getDeviceSnapshot: midiDeviceManager.getSnapshot,
    isPushConnected: pushDevice.isConnected,
    subscribePushConnection: pushDevice.onConnectionChange,
    reconnectPush: pushDevice.ensureConnected,
    refreshPush: refreshPushState,
  };

  const noteSources = [keyboardNoteSource, midiNoteSource, pushNoteEntryMode];
  const editController = createEditController({ store, noteSources });

  // Fetches one bundled demo WAV (public/samples/) and loads it into an instrument slot,
  // matching demoSong.js's references, while also keeping a copy of the raw bytes
  // (sampleAsset) so the demo kit is just as save/load-able as a user-loaded sample, not a
  // special case — see persistence/projectFile.js.
  async function loadDemoInstrument(index, url, name) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const storedBuffer = arrayBuffer.slice(0);
    const sample = await loadSample(arrayBuffer, name);
    applyInstrumentSample(index, sample.id, name, {
      buffer: storedBuffer,
      mimeType: "audio/wav",
      fileName: url.split("/").pop(),
    });
  }

  // Can't run until a user gesture happens (initRuntime()'s resume() requires one — browser
  // autoplay policy), so this is called lazily from App.jsx's first click/keydown, not at
  // module load. Cached so a second call (e.g. Play pressed right after a note key) is a
  // no-op.
  let demoInstrumentsLoaded = null;
  function ensureDemoInstrumentsLoaded() {
    if (!demoInstrumentsLoaded) {
      demoInstrumentsLoaded = (async () => {
        await initRuntime();
        // In a host, the session may hold the project: the demo kit must not be loaded over it. Wait for the
        // host's answer (a snapshot, or "nothing saved"); a host that never answers is treated as empty.
        if (await hostRestored) return;
        // import.meta.env.BASE_URL (always trailing-slash-terminated) rather than a bare
        // "/samples/..." root path — GitHub Pages serves this app from a /webtrack/ subpath
        // (see vite.config.js's base), and a root-relative fetch would 404 there.
        await Promise.all([
          loadDemoInstrument(0, `${import.meta.env.BASE_URL}samples/kick.wav`, "Kick"),
          loadDemoInstrument(1, `${import.meta.env.BASE_URL}samples/hat.wav`, "Hat"),
        ]);
      })().catch((error) => {
        // Don't cache a failure — let the veil's RETRY run it again.
        demoInstrumentsLoaded = null;
        throw error;
      });
    }
    return demoInstrumentsLoaded;
  }

  async function saveProject() {
    const state = store.getState();
    const project = serializeProject({
      song: state.song,
      instruments: state.instruments,
      ui: {
        selectedInstrumentIndex: state.selectedInstrumentIndex,
        octave: state.octave,
        editStep: state.editStep,
        cursor: state.cursor,
      },
    });
    const saved = await downloadProjectFile(project, `webtracker-project-${Date.now()}.json`);
    if (!saved) return; // the user cancelled the host's save dialog: nothing was saved, so nothing to clean up
    // An explicit Save just produced a durable, user-owned copy of exactly this state — the
    // local recovery snapshot (which only ever existed to cover the gap *before* this) is now
    // redundant; clearing it avoids an unnecessary "restore unsaved session?" prompt next
    // startup for a session the user already saved and closed normally. A host's session is
    // not a recovery slot: it keeps tracking the project.
    if (!hostState) {
      recoveryScheduler.cancel();
      dismissRecovery();
    }
  }

  async function loadProjectFromFile(file) {
    if (playbackController.isPlaying()) playbackController.stop();
    await initRuntime();
    const parsed = await readProjectFile(file);
    const { song, instruments, ui } = await deserializeProject(parsed, {
      loadSampleBytes: async (buffer, name) => (await loadSample(buffer, name)).id,
      loadLocalAssetBytes: async (id) => (await localAssetStore.getLocalAsset(id))?.data,
    });
    backfillLocalAssetIds(instruments);
    // Drop any recovery write still pending for the project being replaced, then adopt a fresh
    // identity before the load's own store events (re-emitted by store.loadProject below) can
    // schedule the first write for *this* one — see persistence/recovery.js's module doc
    // comment on why ordering here matters.
    recoveryScheduler.cancel();
    currentProjectId = crypto.randomUUID();
    store.loadProject({ song, instruments, ui });
    // The engine has no persistence of its own — every sample above just loaded fresh at the
    // runtime's unity default/envelope, so a project's saved (possibly non-default) instrument
    // gains/envelopes need one explicit push each, the same way applyInstrumentSample does for a
    // single slot. Track/master FX chains need the equivalent whole-chain replay
    // (audio/fx.js#resyncAllFxChains's own doc comment explains why a full resync, not an
    // incremental push, is required here specifically — a reused bus may carry a previous
    // project's leftover effect instances).
    for (const instrument of instruments) {
      if (instrument.sampleId != null) {
        setInstrumentGain(instrument.sampleId, instrument.gain);
        setInstrumentEnvelope(instrument.sampleId, instrument.envelope);
        setInstrumentRegions(instrument.sampleId, instrument.cues, instrument.chopStart);
      }
    }
    await resyncSynthInstruments(instruments);
    await resyncAllFxChains(song.trackChannels, song.masterFxChain, song.masterFx);
  }

  // ui/chrome/TransportBar.jsx's Resample control — see audio/resampleController.js for the
  // arm/capture flow this drives and model/instrument.js's origin doc comment for what happens
  // to the result. Reported entirely through store.setResampleStatus (RESAMPLE_STATUS_CHANGED)
  // rather than a return value, since the UI needs to show ARMED/CAPTURING while `armed.result`
  // is still pending, not just the final outcome.
  async function handleResample(steps) {
    const armed = playbackController.armResample(steps);
    if (!armed.ok) {
      store.setResampleStatus("error", armed.reason);
      return;
    }
    store.setResampleStatus("armed");
    try {
      const { metadata, channelData } = await armed.result;
      // The engine-side capture itself already finished by the time armed.result resolves —
      // what's left is WAV-encoding and handing the result to applyInstrumentSample below, so
      // this is "processing," distinct from resampleController.js's own internal "capturing"
      // (which covers the engine-side window this promise was waiting on).
      store.setResampleStatus("processing");
      const wavBytes = encodeWav(channelData.map((buf) => new Float32Array(buf)), metadata.sampleRate);
      const resampleCount = store.getState().instruments.filter((instrument) => instrument.origin === "resample").length + 1;
      const name = `Resample ${steps}st-${String(resampleCount).padStart(2, "0")}`;
      store.addInstrumentSlot();
      const index = store.getState().instruments.length - 1;
      // metadata.id is already a live, triggerable sampleId in this session — armCapture()
      // registers the captured audio as a runtime Sample itself (see webdsp's ARCHITECTURE.md,
      // "How armed capture works"), so there's no separate loadSample() round-trip needed here,
      // unlike a freshly-picked file.
      applyInstrumentSample(index, metadata.id, name, { buffer: wavBytes, mimeType: "audio/wav", fileName: `${name}.wav` }, "resample");
      store.selectInstrument(index);
      store.setResampleStatus("complete");
    } catch (err) {
      store.setResampleStatus("error", err instanceof Error ? err.message : String(err));
    }
  }

  // App.jsx's startup check — a non-null result means a local recovery snapshot exists and
  // the UI should offer to restore it (see persistence/recovery.js's module doc comment for
  // what it contains). Read-only; doesn't touch the open project.
  async function checkForRecovery() {
    if (hostState) return null; // the host's session is the truth: no prompt
    return (await localAssetStore.getRecoveryState()) ?? null;
  }

  // App.jsx's restore action for whatever checkForRecovery() returned — same load shape as
  // loadProjectFromFile (cancel any pending write, adopt an identity, backfill, load, push
  // gains), just sourced from the recovery record instead of a picked File. Keeps the
  // record's own projectId rather than minting a new one: this is a continuation of that
  // session, not a brand-new project.
  // `getLocalAssetBytes` overrides where sample bytes come from (a host's snapshot carries its own).
  async function restoreFromRecovery(record, { getLocalAssetBytes = async (id) => (await localAssetStore.getLocalAsset(id))?.data } = {}) {
    if (playbackController.isPlaying()) playbackController.stop();
    await initRuntime();
    const { song, instruments, ui } = await restoreRecoveryState(record, {
      loadSampleBytes: async (buffer, name) => (await loadSample(buffer, name)).id,
      getLocalAssetBytes,
    });
    backfillLocalAssetIds(instruments);
    recoveryScheduler.cancel();
    currentProjectId = record.projectId ?? crypto.randomUUID();
    store.loadProject({ song, instruments, ui });
    for (const instrument of instruments) {
      if (instrument.sampleId != null) {
        setInstrumentGain(instrument.sampleId, instrument.gain);
        setInstrumentEnvelope(instrument.sampleId, instrument.envelope);
        setInstrumentRegions(instrument.sampleId, instrument.cues, instrument.chopStart);
      }
    }
    await resyncSynthInstruments(instruments);
    await resyncAllFxChains(song.trackChannels, song.masterFxChain, song.masterFx);
  }

  // App.jsx's "discard" action on the restore prompt, and saveProject()'s own cleanup after an
  // explicit Save (below) — either way, the stale snapshot shouldn't be offered again next
  // startup. Best-effort: a failed clear just means the same prompt reappears next time, not a
  // thrown error the user sees.
  function dismissRecovery() {
    localAssetStore.clearRecoveryState().catch(() => {});
  }

  // Resolves true once the host's saved project (if it had one) is installed, false if the host had none, sent
  // something unreadable, or did not answer within a few seconds. Always false without a host.
  const HOST_ANSWER_TIMEOUT_MS = 3000;
  const hostRestored = hostState
    ? new Promise((resolve) => {
        const giveUp = setTimeout(() => resolve(false), HOST_ANSWER_TIMEOUT_MS);
        const settle = (restored) => {
          clearTimeout(giveUp);
          resolve(restored);
        };
        hostState.onRestore(async (snapshot) => {
          hostAnswered = true; // from here the session follows the project, whatever the answer was
          const parsed = fromHostSnapshot(snapshot);
          if (!parsed) return settle(false);
          try {
            await restoreFromRecovery(parsed.record, { getLocalAssetBytes: async (id) => parsed.blobs[id] });
            settle(true);
          } catch {
            settle(false); // unreadable state must never wedge startup: carry on with the default project
          }
        });
      })
    : Promise.resolve(false);

  // Not consumed by anything in this app yet — no midi-core dependency is added for MVP (see
  // ECS-156 plan §12). It exists now so the seam has a real, internally-consistent, buildable
  // shape from day one, rather than being invented later under pressure from a real device
  // integration — the mistake that let webseq's equivalent grow unspecified (§9).
  const controlRegistry = createControlRegistry({ store, playbackController });

  // InstrumentPanel.jsx's one entry point for instrument edits that need to reach the engine
  // (gain, envelope) or need the model+sample bookkeeping bundled together (assigning a sample)
  // — the same role fxController plays for the FX panel.
  const instrumentController = {
    setGain: applyInstrumentGain,
    setEnvelope: applyInstrumentEnvelope,
    setSampleMode: applyInstrumentSampleMode,
    setCues: applyInstrumentCues,
    setChopStart: applyInstrumentChopStart,
    setRootNote: (index, note) => store.setInstrumentRootNote(index, note),
    auditionSlice: (index, slice) => {
      const sampleId = store.getState().instruments[index]?.sampleId;
      return auditionSlice(sampleId, slice);
    },
    setChopEditorOpen: (open) => store.setChopEditorOpen(open),
    setSample: applyInstrumentSample,
    setOutput: applyInstrumentOutput,
    setInstrumentParam: applyInstrumentParam,
    addLfo: (index, target) => applyInstrumentLfoChange(index, () => store.addInstrumentLfo(index, target)),
    setLfo: (index, lfoIndex, patch) => applyInstrumentLfoChange(index, () => store.setInstrumentLfo(index, lfoIndex, patch)),
    removeLfo: (index, lfoIndex) => applyInstrumentLfoChange(index, () => store.removeInstrumentLfo(index, lfoIndex)),
  };

  return {
    store,
    playbackController,
    noteSources,
    editController,
    attachPush,
    ensureDemoInstrumentsLoaded,
    togglePlayback,
    renderStats,
    controlRegistry,
    fxController,
    instrumentController,
    midiController,
    saveProject,
    loadProjectFromFile,
    resample: handleResample,
    checkForRecovery,
    restoreFromRecovery,
    dismissRecovery,
  };
}
