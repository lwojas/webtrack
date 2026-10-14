// The composition root: audio/ never imports state/ and state/ never imports audio/ (ECS-156
// plan §6/§9's layering rule), so this app-level module is what wires a store instance's
// getters/callbacks into a playbackController instance, the input layer's note
// source/edit controller into that same store, and the loop-boundary-deferred pattern-switch
// handshake between the two. Nothing under model/, audio/, ui/, or state/ imports this file —
// it's the one place that knows about all of them.
import { createStore } from "./state/store.js";
import { createPlaybackController } from "./audio/playbackController.js";
import { initRuntime } from "./audio/runtime.js";
import { setTrackFxParam, setMasterFxParam, setTrackFxTypeState, setMasterFxTypeState, isFxBypassed } from "./audio/fx.js";
import { loadSample } from "./audio/instrumentLoader.js";
import { setInstrumentGain } from "./audio/instrumentGain.js";
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
  // with whichever of its two callers actually changed a parameter: the FX panel's own sliders
  // call these directly; playbackController's onTrackFxChange (cell automation during
  // playback) calls the track variant via the same wiring TRACK_CHANGED/pattern-selection
  // already uses below. The real engine call only happens when this parameter's FX is actually
  // active and not bypassed (audio/fx.js#isFxBypassed) — while bypassed, the model still keeps
  // the "intended" value (so un-bypassing restores it via applyTrackFxBypass below), but the
  // engine itself stays at that FX's neutral/bypass values until then.
  function applyTrackFxParam(trackIndex, paramId, value) {
    store.setTrackFxParam(trackIndex, paramId, value);
    const fxChain = store.getState().song.trackChannels[trackIndex]?.fxChain ?? [];
    if (!isFxBypassed(fxChain, paramId)) setTrackFxParam(trackIndex, paramId, value);
  }

  function applyMasterFxParam(paramId, value) {
    store.setMasterFxParam(paramId, value);
    if (!isFxBypassed(store.getState().song.masterFxChain, paramId)) setMasterFxParam(paramId, value);
  }

  // The FX panel's "+ ADD FX"/remove/bypass controls (ui/chrome/FxPanel.jsx) — each bundles the
  // model mutation (model/mutations.js) with the matching engine push
  // (audio/fx.js#setTrackFxTypeState), the same pairing applyTrackFxParam/applyMasterFxParam
  // already do per-parameter above. The model mutation runs first so the engine push's
  // `fxBag` read (trackChannel.fx/song.masterFx) sees this type's just-seeded default values
  // on first enable.
  function applyTrackFx(trackIndex, type, active) {
    if (active) store.addTrackFx(trackIndex, type);
    else store.removeTrackFx(trackIndex, type);
    setTrackFxTypeState(trackIndex, type, active, store.getState().song.trackChannels[trackIndex].fx);
  }

  function applyTrackFxBypass(trackIndex, type, bypassed) {
    store.setTrackFxBypass(trackIndex, type, bypassed);
    setTrackFxTypeState(trackIndex, type, !bypassed, store.getState().song.trackChannels[trackIndex].fx);
  }

  function applyMasterFx(type, active) {
    if (active) store.addMasterFx(type);
    else store.removeMasterFx(type);
    setMasterFxTypeState(type, active, store.getState().song.masterFx);
  }

  function applyMasterFxBypass(type, bypassed) {
    store.setMasterFxBypass(type, bypassed);
    setMasterFxTypeState(type, !bypassed, store.getState().song.masterFx);
  }

  // The FX panel's (ui/chrome/FxPanel.jsx) one entry point for every FX change — parameter
  // edits, enabling/disabling an FX, and bypass — so the panel never has to touch audio/fx.js
  // or state/store.js's FX methods separately. Defined up here (rather than alongside
  // instrumentController near the bottom) because midi/push/encoderController.js's own FX-mode
  // encoders need this same object, constructed below, before any of its other dependents.
  const fxController = {
    setTrackFxParam: applyTrackFxParam,
    setMasterFxParam: applyMasterFxParam,
    addTrackFx: (trackIndex, type) => applyTrackFx(trackIndex, type, true),
    removeTrackFx: (trackIndex, type) => applyTrackFx(trackIndex, type, false),
    setTrackFxBypass: applyTrackFxBypass,
    addMasterFx: (type) => applyMasterFx(type, true),
    removeMasterFx: (type) => applyMasterFx(type, false),
    setMasterFxBypass: applyMasterFxBypass,
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

  // The one place a sample gets assigned into an instrument slot (a file picked in
  // InstrumentPanel.jsx, the bundled demo kit below, or a completed resample — see
  // handleResample) — bundles the model update with pushing that slot's already-set gain to
  // the engine for the *new* sampleId, so a previously-customized instrument gain survives
  // loading a different sample into the same slot instead of silently reverting to the
  // engine's unity default. Also the one place every loaded sample's bytes get a localAssetId
  // and are written to persistence/localAssetStore.js's IndexedDB-backed store — fire-and-
  // forget, off the critical path, so this never blocks on (or fails over) a storage write;
  // see model/instrument.js's origin doc comment for what that id is for.
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
    onTransportChange: ({ playing }) => store.setTransport(playing),
    onPatternSwitchPending: (pending) => store.setPatternSwitchPending(pending),
    // Cell FX automation already calls audio/fx.js's setTrackFxParam itself (see
    // playbackController.js) for the real engine call — this callback only needs to keep the
    // model in sync, not repeat that call.
    onTrackFxChange: (trackIndex, paramId, value) => store.setTrackFxParam(trackIndex, paramId, value),
  });

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
  const recoveryScheduler = createRecoveryScheduler({ writeRecoveryState: localAssetStore.putRecoveryState });
  function scheduleRecoverySnapshot() {
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
  const midiNoteSource = createMidiNoteSource();

  // Push Mk1, wired as a controller surface on top of (not instead of) the generic MIDI
  // keyboard path above — see src/midi/push/modeController.js's own doc comment for the
  // CC50/51/112/113 mode state machine this drives. pushNoteEntryMode is both a gridContent
  // entry (receives decoded pad events while pushMode === "note") and, via the same object,
  // a regular noteSources entry (editController.js never needs to know a note came from a
  // Push pad instead of a keyboard). pushTrackerGridMode needs playbackController (already
  // constructed above) for its live playhead LEDs.
  const pushDevice = createPushDevice();
  const pushNoteEntryMode = createPushNoteEntryMode({ device: pushDevice });
  const pushTrackerGridMode = createPushTrackerGridMode({ device: pushDevice, store, playbackController });
  const pushModeController = createPushModeController({
    device: pushDevice,
    gridContent: {
      note: pushNoteEntryMode,
      "session.tracker": pushTrackerGridMode,
      "session.pattern": createPatternGridModeStub({ device: pushDevice }),
    },
  });
  // Encoders (volume/FX modes + LCD) and the Play button are each a physically separate control
  // group from the 8x8 pad grid, so they're attached independently of pushModeController rather
  // than folded into its gridContent dispatch — pushDevice.js already supports more than one
  // onMessage listener, exactly for this.
  const pushEncoderController = createPushEncoderController({ device: pushDevice, store, fxController });
  const pushTransportController = createPushTransportController({ device: pushDevice, store, togglePlayback });

  // The one entry point for "fully resync whatever's currently on the device" — a Push
  // reconnect (wired below via pushDevice.onConnectionChange) and the Settings modal's manual
  // refresh button both call this, rather than each re-deriving what a full repaint means.
  function refreshPushState() {
    pushModeController.refresh();
    pushEncoderController.refresh();
    pushTransportController.refresh();
  }
  pushDevice.onConnectionChange((connected) => {
    if (connected) refreshPushState();
  });

  function attachPush() {
    const detachDevice = pushDevice.attach();
    const detachController = pushModeController.attach();
    const detachEncoders = pushEncoderController.attach();
    const detachTransport = pushTransportController.attach();
    return () => {
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
        // import.meta.env.BASE_URL (always trailing-slash-terminated) rather than a bare
        // "/samples/..." root path — GitHub Pages serves this app from a /webtrack/ subpath
        // (see vite.config.js's base), and a root-relative fetch would 404 there.
        await Promise.all([
          loadDemoInstrument(0, `${import.meta.env.BASE_URL}samples/kick.wav`, "Kick"),
          loadDemoInstrument(1, `${import.meta.env.BASE_URL}samples/hat.wav`, "Hat"),
        ]);
      })();
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
    downloadProjectFile(project, `webtracker-project-${Date.now()}.json`);
    // An explicit Save just produced a durable, user-owned copy of exactly this state — the
    // local recovery snapshot (which only ever existed to cover the gap *before* this) is now
    // redundant; clearing it avoids an unnecessary "restore unsaved session?" prompt next
    // startup for a session the user already saved and closed normally.
    recoveryScheduler.cancel();
    dismissRecovery();
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
    // runtime's unity default, so a project's saved (possibly non-default) instrument gains
    // need one explicit push each, the same way applyInstrumentSample does for a single slot.
    for (const instrument of instruments) {
      if (instrument.sampleId != null) setInstrumentGain(instrument.sampleId, instrument.gain);
    }
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
    return (await localAssetStore.getRecoveryState()) ?? null;
  }

  // App.jsx's restore action for whatever checkForRecovery() returned — same load shape as
  // loadProjectFromFile (cancel any pending write, adopt an identity, backfill, load, push
  // gains), just sourced from the recovery record instead of a picked File. Keeps the
  // record's own projectId rather than minting a new one: this is a continuation of that
  // session, not a brand-new project.
  async function restoreFromRecovery(record) {
    if (playbackController.isPlaying()) playbackController.stop();
    await initRuntime();
    const { song, instruments, ui } = await restoreRecoveryState(record, {
      loadSampleBytes: async (buffer, name) => (await loadSample(buffer, name)).id,
      getLocalAssetBytes: async (id) => (await localAssetStore.getLocalAsset(id))?.data,
    });
    backfillLocalAssetIds(instruments);
    recoveryScheduler.cancel();
    currentProjectId = record.projectId ?? crypto.randomUUID();
    store.loadProject({ song, instruments, ui });
    for (const instrument of instruments) {
      if (instrument.sampleId != null) setInstrumentGain(instrument.sampleId, instrument.gain);
    }
  }

  // App.jsx's "discard" action on the restore prompt, and saveProject()'s own cleanup after an
  // explicit Save (below) — either way, the stale snapshot shouldn't be offered again next
  // startup. Best-effort: a failed clear just means the same prompt reappears next time, not a
  // thrown error the user sees.
  function dismissRecovery() {
    localAssetStore.clearRecoveryState().catch(() => {});
  }

  // Not consumed by anything in this app yet — no midi-core dependency is added for MVP (see
  // ECS-156 plan §12). It exists now so the seam has a real, internally-consistent, buildable
  // shape from day one, rather than being invented later under pressure from a real device
  // integration — the mistake that let webseq's equivalent grow unspecified (§9).
  const controlRegistry = createControlRegistry({ store, playbackController });

  // InstrumentPanel.jsx's one entry point for instrument edits that need to reach the engine
  // (gain) or need the model+sample bookkeeping bundled together (assigning a sample) — the
  // same role fxController plays for the FX panel.
  const instrumentController = {
    setGain: applyInstrumentGain,
    setSample: applyInstrumentSample,
    setOutput: store.setInstrumentOutput,
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
