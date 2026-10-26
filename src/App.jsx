import { useCallback, useEffect, useMemo, useState } from "react";
import { hasEmbeddedHost } from "webdsp";
import TrackerGridHost from "./ui/grid/TrackerGridHost.jsx";
import TransportBar from "./ui/chrome/TransportBar.jsx";
import MixerFxPanel from "./ui/chrome/MixerFxPanel.jsx";
import ChopEditor from "./ui/chrome/ChopEditor.jsx";
import AutomationEditor from "./ui/chrome/AutomationEditor.jsx";
import InstrumentPanel from "./ui/chrome/InstrumentPanel.jsx";
import NoteEditor from "./ui/chrome/NoteEditor.jsx";
import { InstrumentEditorPanel } from "./ui/chrome/InstrumentPanel.jsx";
import SelectionToolbar from "./ui/chrome/SelectionToolbar.jsx";
import PatternManager from "./ui/chrome/PatternManager.jsx";
import SettingsModal from "./ui/chrome/SettingsModal.jsx";
import PerfPanel from "./ui/debug/PerfPanel.jsx";
import { createAppContext } from "./appContext.js";
import { attachTransportKeys } from "./input/transportKeys.js";

const TABS = [
  { id: "tracker", label: "TRACKER" },
  { id: "patterns", label: "PATTERNS" },
];

// Formats a recovery record's savedAt (an ISO string, see persistence/recovery.js) as "a
// moment ago" / "N minutes ago" — just enough precision for a one-line restore prompt, not a
// general-purpose relative-time utility.
function timeAgo(isoString) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("tracker");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null while unchecked/dismissed, the stored record while a restore prompt should show — see
  // persistence/recovery.js for what checkForRecovery()/restoreFromRecovery() do.
  const [recoveryRecord, setRecoveryRecord] = useState(null);
  // "idle" → veil with a Start button; "starting" while the AudioContext/demo kit load;
  // "ready" once audio is running; "error" shows the failure with a retry.
  const [audioState, setAudioState] = useState("idle");
  const [audioError, setAudioError] = useState(null);
  const {
    store,
    playbackController,
    noteSources,
    editController,
    attachPush,
    ensureDemoInstrumentsLoaded,
    togglePlayback,
    renderStats,
    fxController,
    instrumentController,
    midiController,
    saveProject,
    loadProjectFromFile,
    resample,
    checkForRecovery,
    restoreFromRecovery,
    dismissRecovery,
  } = useMemo(() => createAppContext(), []);

  // One-time startup check (src/persistence/recovery.js) — deliberately independent of the
  // user-gesture-gated audio bootstrap below: showing (or not showing) the prompt needs no
  // AudioContext at all, so it shouldn't wait on one.
  useEffect(() => {
    checkForRecovery().then(setRecoveryRecord);
  }, [checkForRecovery]);

  async function handleRestoreRecovery() {
    if (!recoveryRecord) return;
    await restoreFromRecovery(recoveryRecord);
    setRecoveryRecord(null);
  }

  function handleDismissRecovery() {
    dismissRecovery();
    setRecoveryRecord(null);
  }

  // Android Chrome (and mobile browsers generally) don't grant user activation on a touch's
  // `pointerdown` — only on pointerup/touchend/click — so a window-level pointerdown listener
  // calling AudioContext.resume() leaves the context suspended and the resume promise pending
  // forever. The veil's Start button runs this from a real `click` instead.
  const startAudio = useCallback(() => {
    setAudioState("starting");
    setAudioError(null);
    return ensureDemoInstrumentsLoaded().then(
      () => setAudioState("ready"),
      (error) => {
        setAudioError(error?.message ?? String(error));
        setAudioState("error");
      },
    );
  }, [ensureDemoInstrumentsLoaded]);

  // A host-provided runtime needs no gesture: skip the veil and start at once (a browser still waits for the click).
  useEffect(() => {
    if (hasEmbeddedHost()) startAudio();
  }, [startAudio]);

  useEffect(() => {
    const detachNoteSources = noteSources.map((noteSource) => noteSource.attach());
    const detachEditController = editController.attach();
    const detachPush = attachPush();
    // togglePlayback (appContext.js) is the one play/stop entry point every transport control
    // calls — this keyboard shortcut and midi/push/transportController.js's Play button both
    // route through it, rather than each awaiting ensureDemoInstrumentsLoaded() separately.
    const detachTransportKeys = attachTransportKeys({
      onTogglePlay: togglePlayback,
      onToggleEditMode: () => store.toggleEditMode(),
    });

    // Loading the demo kit needs a user gesture (browser autoplay policy). Desktop users can
    // start with any keypress; touch users use the veil's Start button (see startAudio above).
    // startAudio is idempotent via ensureDemoInstrumentsLoaded()'s cache, and this listener
    // removes itself after the first keydown.
    function handleFirstGesture() {
      startAudio();
      window.removeEventListener("keydown", handleFirstGesture);
    }
    window.addEventListener("keydown", handleFirstGesture);

    return () => {
      detachNoteSources.forEach((detach) => detach());
      detachEditController();
      detachPush();
      detachTransportKeys();
      window.removeEventListener("keydown", handleFirstGesture);
    };
  }, [store, playbackController, noteSources, editController, attachPush, startAudio, togglePlayback]);

  return (
    <div className="app">
      <TransportBar
        store={store}
        playbackController={playbackController}
        onSaveProject={saveProject}
        onLoadProjectFile={loadProjectFromFile}
        onOpenSettings={() => setSettingsOpen(true)}
        onResample={resample}
      />
      {recoveryRecord && (
        <div className="recovery-banner" role="alert">
          <span>
            Recovered unsaved work{recoveryRecord.projectName ? ` from "${recoveryRecord.projectName}"` : ""} —{" "}
            {timeAgo(recoveryRecord.savedAt)}.
          </span>
          <div className="recovery-banner__actions">
            <button className="transport-bar__chip" onClick={handleRestoreRecovery}>
              RESTORE
            </button>
            <button className="transport-bar__chip" onClick={handleDismissRecovery}>
              DISCARD
            </button>
          </div>
        </div>
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} midiController={midiController} />
      <div className="app__tabs" role="tablist" aria-label="View">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`app__tab${activeTab === tab.id ? " app__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "tracker" ? (
        <div className="app__body">
          <div className="app__tracker">
            <TrackerGridHost store={store} playbackController={playbackController} renderStats={renderStats} />
            {/* Sits in the same flex column as the grid, so opening it shrinks the grid host
                (which scrolls) instead of overlaying it; renders nothing while closed. */}
            <ChopEditor store={store} instrumentController={instrumentController} />
            <InstrumentEditorPanel store={store} instrumentController={instrumentController} />
            <AutomationEditor store={store} />
            <MixerFxPanel store={store} fxController={fxController} />
          </div>
          <div className="app__side">
            <SelectionToolbar store={store} />
            <InstrumentPanel store={store} instrumentController={instrumentController} />
            <NoteEditor store={store} />
          </div>
        </div>
      ) : (
        <div className="app__body">
          <PatternManager store={store} playbackController={playbackController} />
        </div>
      )}
      <PerfPanel renderStats={renderStats} playbackController={playbackController} />
      {audioState !== "ready" && (
        <div className="gesture-veil" role="dialog" aria-label="Start audio">
          <div className="gesture-veil__card">
            <p>
              {audioState === "error"
                ? `Audio engine failed to start: ${audioError}`
                : "Tap to start the audio engine (browser autoplay policy requires a gesture)."}
            </p>
            <button className="transport-bar__chip gesture-veil__btn" onClick={startAudio} disabled={audioState === "starting"}>
              {audioState === "starting" ? "STARTING…" : audioState === "error" ? "RETRY" : "▶ START"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
