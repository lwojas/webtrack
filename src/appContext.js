// The composition root: audio/ never imports state/ and state/ never imports audio/ (ECS-156
// plan §6/§9's layering rule), so this app-level module is what wires a store instance's
// getters/callbacks into a playbackController instance, the input layer's note
// source/edit controller into that same store, and the loop-boundary-deferred pattern-switch
// handshake between the two. Nothing under model/, audio/, ui/, or state/ imports this file —
// it's the one place that knows about all of them.
import { createStore } from "./state/store.js";
import { createPlaybackController } from "./audio/playbackController.js";
import { initRuntime } from "./audio/runtime.js";
import { setTrackFxParam, setMasterFxParam } from "./audio/fx.js";
import { loadSample } from "./audio/instrumentLoader.js";
import { createDemoSong, createDemoInstruments } from "./demo/demoSong.js";
import { getSelectedPattern } from "./model/query.js";
import { createKeyboardNoteSource } from "./input/keyboardNoteMap.js";
import { createEditController } from "./input/editController.js";
import { createRenderStats } from "./debug/renderStats.js";
import { createControlRegistry } from "./control/registry.js";
import { serializeProject, deserializeProject } from "./persistence/projectFile.js";
import { downloadProjectFile, readProjectFile } from "./persistence/projectIO.js";
import * as events from "./state/events.js";

export function createAppContext() {
  const song = createDemoSong();
  const instruments = createDemoInstruments();
  const store = createStore({ song, instruments });
  const renderStats = createRenderStats();

  // Keeps the model (trackChannel.fx/song.masterFx, so the FX panel reflects it live) in sync
  // with whichever of its two callers actually changed a parameter: the FX panel's own sliders
  // call these directly; playbackController's onTrackFxChange (cell automation during
  // playback) calls the track variant via the same wiring TRACK_CHANGED/pattern-selection
  // already uses below. Either way, the real engine call (audio/fx.js) and the model update
  // happen together, never one without the other.
  function applyTrackFxParam(trackIndex, paramId, value) {
    store.setTrackFxParam(trackIndex, paramId, value);
    setTrackFxParam(trackIndex, paramId, value);
  }

  function applyMasterFxParam(paramId, value) {
    store.setMasterFxParam(paramId, value);
    setMasterFxParam(paramId, value);
  }

  const playbackController = createPlaybackController({
    getSong: () => store.getState().song,
    getTrackChannels: () => store.getState().song.trackChannels,
    getInstruments: () => store.getState().instruments,
    getBpm: () => store.getState().song.bpm,
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

  const noteSource = createKeyboardNoteSource({ getOctave: () => store.getState().octave });
  const editController = createEditController({ store, noteSource });

  // Fetches one bundled demo WAV (public/samples/) and loads it into an instrument slot,
  // matching demoSong.js's references, while also keeping a copy of the raw bytes
  // (sampleAsset) so the demo kit is just as save/load-able as a user-loaded sample, not a
  // special case — see persistence/projectFile.js.
  async function loadDemoInstrument(index, url, name) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const storedBuffer = arrayBuffer.slice(0);
    const sample = await loadSample(arrayBuffer, name);
    store.setInstrumentSample(index, sample.id, name, {
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
  }

  async function loadProjectFromFile(file) {
    if (playbackController.isPlaying()) playbackController.stop();
    await initRuntime();
    const parsed = await readProjectFile(file);
    const { song, instruments, ui } = await deserializeProject(parsed, {
      loadSampleBytes: async (buffer, name) => (await loadSample(buffer, name)).id,
    });
    store.loadProject({ song, instruments, ui });
  }

  // Not consumed by anything in this app yet — no midi-core dependency is added for MVP (see
  // ECS-156 plan §12). It exists now so the seam has a real, internally-consistent, buildable
  // shape from day one, rather than being invented later under pressure from a real device
  // integration — the mistake that let webseq's equivalent grow unspecified (§9).
  const controlRegistry = createControlRegistry({ store, playbackController });

  // The FX panel's one entry point for actually changing a parameter (ui/chrome/FxPanel.jsx) —
  // bundles the model update and the real engine call the same way applyTrackFxParam/
  // applyMasterFxParam already do for cell automation above, so the panel never has to touch
  // audio/fx.js or state/store.js's two FX methods separately.
  const fxController = {
    setTrackFxParam: applyTrackFxParam,
    setMasterFxParam: applyMasterFxParam,
  };

  return {
    store,
    playbackController,
    noteSource,
    editController,
    ensureDemoInstrumentsLoaded,
    renderStats,
    controlRegistry,
    fxController,
    saveProject,
    loadProjectFromFile,
  };
}
