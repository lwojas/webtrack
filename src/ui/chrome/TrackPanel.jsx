import { LFO_DIVISIONS } from "webdsp";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import {
  EVENT_LFO_RATE_STEPS,
  EVENT_LFO_WAVEFORMS,
  EVENT_LFO_WAVEFORM_LABELS,
  eventLfoOf,
  formatEventLfoRate,
  rateToSlider,
  sliderToRate,
} from "../../model/eventLfo.js";
import { rangeFillStyle } from "../rangeFill.js";

// Track-level properties for the selected track (the grid cursor's track, as in FxPanel): the
// contextual home for what belongs to the track rather than to a step or the mixer. Length and
// polyphony stay in the grid's header rows above the columns — this tab is for the deeper controls.
// Today it holds the Track LFO (model/eventLfo.js, docs/TRACK_LFO.md): an LFO that changes the
// velocity of the steps that opt in (the TRACK LFO slider in the Note Editor, or All steps below).
// It acts when a step is scheduled, not inside the synth. Edits go straight to the store: the
// config is read live by the playback compile step, so there is no engine push.
export default function TrackPanel({ store }) {
  const trackIndex = useStore(store, events.CURSOR_MOVED, (s) => s.cursor.trackIndex);
  const trackName = store.getState().song.trackChannels[trackIndex]?.name ?? `TRK ${trackIndex + 1}`;
  // Fingerprints, not the mutable objects (ARCHITECTURE.md's in-place-mutation gotcha).
  const lfoJson = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => JSON.stringify(eventLfoOf(s.song.trackChannels[s.cursor.trackIndex])));
  const stepsKey = useStore(store, events.CELL_CHANGED, (s) => stepCounts(s, s.cursor.trackIndex).join("/"));
  // The bulk buttons repaint through PATTERN_LENGTH_CHANGED; listen to it too so the counts follow.
  useStore(store, events.PATTERN_LENGTH_CHANGED, (s) => stepCounts(s, s.cursor.trackIndex).join("/"));
  const lfo = JSON.parse(lfoJson);
  const [participating, notes] = stepsKey.split("/").map(Number);
  const set = (patch) => store.setTrackChannelEventLfo(trackIndex, patch);

  return (
    <div className="fx-panel">
      <div className="fx-panel__header">
        <span className="fx-panel__label">{`TRK ${trackIndex + 1} — ${trackName}`}</span>
      </div>
      <div className="fx-panel__modules">
        <div className="fx-module">
          <div className="fx-module__header">
            <span className="fx-module__title">Track LFO</span>
            <span title="What the LFO changes">Velocity</span>
          </div>
          <label className="fx-module__field">
            <span className="fx-module__field-label">Enabled</span>
            <button type="button" className={`fx-module__toggle${lfo.enabled ? " fx-module__toggle--on" : ""}`} onClick={() => set({ enabled: !lfo.enabled })}>
              {lfo.enabled ? "ON" : "OFF"}
            </button>
          </label>
          <label className="fx-module__field">
            <span className="fx-module__field-label">Waveform</span>
            <select value={lfo.waveform} onChange={(e) => set({ waveform: e.target.value })}>
              {EVENT_LFO_WAVEFORMS.map((w) => (
                <option key={w} value={w}>
                  {EVENT_LFO_WAVEFORM_LABELS[w]}
                </option>
              ))}
            </select>
            <span className="fx-module__value" />
          </label>
          <label className="fx-module__field">
            <span className="fx-module__field-label">Mode</span>
            <button type="button" className={`fx-module__toggle${lfo.sync ? " fx-module__toggle--on" : ""}`} onClick={() => set({ sync: !lfo.sync })}>
              {lfo.sync ? "SYNC" : "FREE"}
            </button>
          </label>
          {lfo.sync ? (
            <label className="fx-module__field">
              <span className="fx-module__field-label">Rate</span>
              <select value={lfo.division} onChange={(e) => set({ division: e.target.value })}>
                {LFO_DIVISIONS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="fx-module__value" />
            </label>
          ) : (
            <label className="fx-module__field">
              <span className="fx-module__field-label">Rate</span>
              <input
                type="range"
                min={0}
                max={EVENT_LFO_RATE_STEPS}
                step={1}
                value={rateToSlider(lfo.rateHz)}
                onChange={(e) => set({ rateHz: sliderToRate(Number(e.target.value)) })}
                style={rangeFillStyle(rateToSlider(lfo.rateHz), 0, EVENT_LFO_RATE_STEPS)}
              />
              <span className="fx-module__value">{formatEventLfoRate(lfo.rateHz)}</span>
            </label>
          )}
          <label className="fx-module__field">
            <span className="fx-module__field-label">Depth</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(lfo.depth * 100)}
              onChange={(e) => set({ depth: Number(e.target.value) / 100 })}
              style={rangeFillStyle(Math.round(lfo.depth * 100), 0, 100)}
            />
            <span className="fx-module__value">{Math.round(lfo.depth * 100)}%</span>
          </label>
        </div>

        <div className="fx-module">
          <div className="fx-module__header">
            <span className="fx-module__title">Steps</span>
            <span>{`${participating}/${notes}`}</span>
          </div>
          <button type="button" className="fx-panel__target-btn" disabled={notes === 0} onClick={() => store.setTrackStepsLfo(trackIndex, 1)} title="Every note on this track follows the LFO (this pattern)">
            ALL STEPS
          </button>
          <button type="button" className="fx-panel__target-btn" disabled={participating === 0} onClick={() => store.setTrackStepsLfo(trackIndex, 0)} title="No note on this track follows the LFO (this pattern)">
            NONE
          </button>
          <span className="fx-panel__empty">Per step: Note Editor, TRACK LFO</span>
        </div>
      </div>
    </div>
  );
}

// [steps taking part, steps with a note] for one track of the selected pattern.
function stepCounts(state, trackIndex) {
  const track = getSelectedPattern(state.song)?.tracks[trackIndex];
  if (!track) return [0, 0];
  let participating = 0;
  let notes = 0;
  for (const event of track.events) {
    if (event.note === null) continue;
    notes += 1;
    if ((event.lfo ?? 0) > 0) participating += 1;
  }
  return [participating, notes];
}
