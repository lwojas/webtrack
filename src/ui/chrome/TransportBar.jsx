import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getActivePattern } from "../../model/query.js";
import { barsForRowCount, MAX_BARS } from "../../model/timing.js";

// Ordinary stateful forms-and-buttons UI with no rendering-performance requirement — exactly
// where React earns its keep (ECS-156 plan §3). Reads the same store the vanilla grid modules
// mutate; nothing here touches grid DOM directly.
export default function TransportBar({ store, playbackController, onSaveProject, onLoadProjectFile }) {
  const playing = useStore(store, events.TRANSPORT_CHANGED, (s) => s.playing);
  const bpm = useStore(store, events.TRANSPORT_CHANGED, (s) => s.song.bpm);
  const switchPending = useStore(store, events.PATTERN_SWITCH_PENDING, (s) => s.patternSwitchPending);
  const activeBankIndex = useStore(store, events.BANK_SELECTED, (s) => s.activeBankIndex);
  const activePatternIndex = useStore(
    store,
    events.PATTERN_SELECTED,
    (s) => s.song.banks[s.activeBankIndex].activePatternIndex,
  );
  const sequenceBars = useStore(store, events.PATTERN_LENGTH_CHANGED, (s) =>
    barsForRowCount(getActivePattern(s.song, s.activeBankIndex).rowCount),
  );
  const projectName = useStore(store, events.PROJECT_NAME_CHANGED, (s) => s.song.name ?? "");

  const { song } = store.getState();
  const bankCount = song.banks.length;
  const patternCount = song.banks[activeBankIndex].patterns.length;

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
        BPM
        <input
          type="number"
          min={40}
          max={300}
          value={bpm}
          onChange={(e) => store.setBpm(Number(e.target.value))}
        />
      </label>

      <div className="transport-bar__group" role="group" aria-label="Bank">
        {Array.from({ length: bankCount }, (_, i) => (
          <button
            key={i}
            className={`transport-bar__chip${i === activeBankIndex ? " transport-bar__chip--active" : ""}`}
            onClick={() => store.selectBank(i)}
          >
            {String.fromCharCode(65 + i)}
          </button>
        ))}
      </div>

      <div className="transport-bar__group" role="group" aria-label="Pattern">
        {Array.from({ length: patternCount }, (_, i) => (
          <button
            key={i}
            className={`transport-bar__chip${i === activePatternIndex ? " transport-bar__chip--active" : ""}`}
            onClick={() => store.selectPattern(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>

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
        </div>
      </div>
    </div>
  );
}
