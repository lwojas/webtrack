import { useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import ScaleControl from "./ScaleControl.jsx";
import { barsForRowCount, MAX_BARS, RESAMPLE_STEP_OPTIONS } from "../../model/timing.js";

// Ordinary stateful forms-and-buttons UI with no rendering-performance requirement — exactly
// where React earns its keep (ECS-156 plan §3). Reads the same store the vanilla grid modules
// mutate; nothing here touches grid DOM directly. Pattern selection/creation lives in the
// Pattern Manager tab (ui/chrome/PatternManager.jsx) — this bar only shows which pattern is
// currently selected and lets its length be changed.
export default function TransportBar({ store, playbackController, onSaveProject, onLoadProjectFile, onOpenSettings, onResample }) {
  const playing = useStore(store, events.TRANSPORT_CHANGED, (s) => s.playing);
  const songBpm = useStore(store, events.TRANSPORT_CHANGED, (s) => s.song.bpm);
  // The host tempo while following an external clock (audio/hostSync.js); the tempo then belongs to the host.
  const hostBpm = useStore(store, events.TRANSPORT_CHANGED, (s) => s.hostBpm);
  const bpm = hostBpm ?? songBpm;
  const swing = useStore(store, events.TRANSPORT_CHANGED, (s) => s.song.swing);
  const switchPending = useStore(store, events.PATTERN_SWITCH_PENDING, (s) => s.patternSwitchPending);
  const selectedPatternName = useStore(store, events.PATTERN_SELECTED, (s) => getSelectedPattern(s.song).name);
  const sequenceBars = useStore(store, events.PATTERN_LENGTH_CHANGED, (s) =>
    barsForRowCount(getSelectedPattern(s.song).rowCount),
  );
  const projectName = useStore(store, events.PROJECT_NAME_CHANGED, (s) => s.song.name ?? "");
  const resampleStatus = useStore(store, events.RESAMPLE_STATUS_CHANGED, (s) => s.resampleStatus);
  const resampleError = useStore(store, events.RESAMPLE_STATUS_CHANGED, (s) => s.resampleError);
  const [resampleSteps, setResampleSteps] = useState(16);
  const resampleBusy = resampleStatus === "armed" || resampleStatus === "processing";

  function togglePlay() {
    if (playing) playbackController.stop();
    else playbackController.play();
  }

  function handleLoadFileChange(e) {
    const file = e.target.files?.[0];
    if (file) onLoadProjectFile?.(file);
    e.target.value = "";
  }

  return (
    <div className="transport-bar">
      <button
        className={`transport-bar__play${playing ? " transport-bar__play--active" : ""}`}
        onClick={togglePlay}
      >
        {playing ? "■ STOP" : "▶ PLAY"}
      </button>

      {switchPending && <span className="transport-bar__pending">SWITCH QUEUED</span>}

      <label className="transport-bar__bpm">
        {hostBpm !== null ? "BPM · HOST" : "BPM"}
        <input
          type="number"
          min={40}
          max={300}
          value={bpm}
          disabled={hostBpm !== null}
          onChange={(e) => store.setBpm(Number(e.target.value))}
        />
      </label>

      <label className="transport-bar__bpm">
        SWING
        <input
          type="number"
          min={0}
          max={100}
          value={swing}
          onChange={(e) => store.setSwing(Number(e.target.value))}
        />
      </label>

      <ScaleControl store={store} />

      <span className="transport-bar__pattern-name" title="Selected pattern — change this from the Patterns tab">
        PATTERN: {selectedPatternName}
      </span>

      <label className="transport-bar__bpm">
        LEN
        <select value={sequenceBars} onChange={(e) => store.setSequenceLength(Number(e.target.value))}>
          {Array.from({ length: MAX_BARS }, (_, i) => i + 1).map((bars) => (
            <option key={bars} value={bars}>
              {bars} {bars === 1 ? "BAR" : "BARS"}
            </option>
          ))}
        </select>
      </label>

      <div className="transport-bar__group transport-bar__resample">
        <button
          className={`transport-bar__chip${resampleBusy ? " transport-bar__chip--active" : ""}`}
          onClick={() => onResample?.(resampleSteps)}
          disabled={!playing || resampleBusy}
          title={playing ? "Capture the next steps of what's currently playing as a new instrument" : "Play something first"}
        >
          RESAMPLE
        </button>
        <select value={resampleSteps} onChange={(e) => setResampleSteps(Number(e.target.value))} disabled={resampleBusy}>
          {RESAMPLE_STEP_OPTIONS.map((steps) => (
            <option key={steps} value={steps}>
              {steps} STEPS
            </option>
          ))}
        </select>
        {resampleStatus === "armed" && <span className="transport-bar__pending">ARMED</span>}
        {resampleStatus === "processing" && <span className="transport-bar__pending">PROCESSING</span>}
        {resampleStatus === "complete" && <span className="transport-bar__pending transport-bar__pending--ok">DONE</span>}
        {resampleStatus === "error" && (
          <span className="transport-bar__pending transport-bar__pending--error" title={resampleError ?? undefined}>
            ERROR
          </span>
        )}
      </div>

      <div className="transport-bar__project">
        <input
          className="transport-bar__project-name"
          type="text"
          value={projectName}
          placeholder="Untitled Project"
          title={projectName}
          onChange={(e) => store.setProjectName(e.target.value)}
        />
        <div className="transport-bar__group">
          <button className="transport-bar__chip" onClick={onSaveProject}>
            SAVE
          </button>
          <label className="transport-bar__chip transport-bar__load">
            LOAD
            <input type="file" accept="application/json" hidden onChange={handleLoadFileChange} />
          </label>
          <button className="transport-bar__chip transport-bar__settings" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            ⚙
          </button>
        </div>
      </div>
    </div>
  );
}
