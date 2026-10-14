import { useEffect, useMemo, useState } from "react";
import TrackerGridHost from "./ui/grid/TrackerGridHost.jsx";
import TransportBar from "./ui/chrome/TransportBar.jsx";
import MixerFxPanel from "./ui/chrome/MixerFxPanel.jsx";
import InstrumentPanel from "./ui/chrome/InstrumentPanel.jsx";
import NoteEditor from "./ui/chrome/NoteEditor.jsx";
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

export default function App() {
  const [activeTab, setActiveTab] = useState("tracker");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  } = useMemo(() => createAppContext(), []);

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

    // Loading the demo kit needs a user gesture (browser autoplay policy) but isn't tied to
    // any one specific control — a note keypress for audition is just as valid a first
    // gesture as pressing Play. ensureDemoInstrumentsLoaded() is idempotent, so firing it
    // from the first gesture of either kind is enough; this listener then removes itself.
    function handleFirstGesture() {
      ensureDemoInstrumentsLoaded();
      window.removeEventListener("pointerdown", handleFirstGesture);
      window.removeEventListener("keydown", handleFirstGesture);
    }
    window.addEventListener("pointerdown", handleFirstGesture);
    window.addEventListener("keydown", handleFirstGesture);

    return () => {
      detachNoteSources.forEach((detach) => detach());
      detachEditController();
      detachPush();
      detachTransportKeys();
      window.removeEventListener("pointerdown", handleFirstGesture);
      window.removeEventListener("keydown", handleFirstGesture);
    };
  }, [store, playbackController, noteSources, editController, attachPush, ensureDemoInstrumentsLoaded, togglePlayback]);

  return (
    <div className="app">
      <TransportBar
        store={store}
        playbackController={playbackController}
        onSaveProject={saveProject}
        onLoadProjectFile={loadProjectFromFile}
        onOpenSettings={() => setSettingsOpen(true)}
      />
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
            <MixerFxPanel store={store} fxController={fxController} />
          </div>
          <div className="app__side">
            <InstrumentPanel store={store} instrumentController={instrumentController} />
            <NoteEditor store={store} />
            <SelectionToolbar store={store} />
          </div>
        </div>
      ) : (
        <div className="app__body">
          <PatternManager store={store} playbackController={playbackController} />
        </div>
      )}
      <PerfPanel renderStats={renderStats} playbackController={playbackController} />
    </div>
  );
}
