import { useRef } from "react";
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
import {
  ARP_MODES,
  ARP_PATTERNS,
  ARP_RATES,
  ARP_VELOCITY_PRESETS,
  MAX_ARP_OCTAVES,
  MAX_ARP_VELOCITY_STEPS,
  MIN_ARP_GATE,
  MIN_ARP_VELOCITY_STEPS,
  arpOf,
} from "../../model/arp.js";

// Track-level properties for the selected track (the grid cursor's track, as in FxPanel): the
// contextual home for what belongs to the track rather than to a step or the mixer. Length and
// polyphony stay in the grid's header rows above the columns — this tab is for the deeper controls.
// Today it holds the Track LFO (model/eventLfo.js, docs/TRACK_LFO.md): an LFO that changes the
// velocity of the steps that opt in (the TRACK LFO slider in the Note Editor, or All steps below).
// It acts when a step is scheduled, not inside the synth. The Arp module (model/arp.js) is the same
// kind of thing: it generates this track's notes from its steps at playback, never editing them. Edits go straight to the store: the
// config is read live by the playback compile step, so there is no engine push.
export default function TrackPanel({ store }) {
  const trackIndex = useStore(store, events.CURSOR_MOVED, (s) => s.cursor.trackIndex);
  const trackName = store.getState().song.trackChannels[trackIndex]?.name ?? `TRK ${trackIndex + 1}`;
  // Fingerprints, not the mutable objects (ARCHITECTURE.md's in-place-mutation gotcha).
  const lfoJson = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => JSON.stringify(eventLfoOf(s.song.trackChannels[s.cursor.trackIndex])));
  const stepsKey = useStore(store, events.CELL_CHANGED, (s) => stepCounts(s, s.cursor.trackIndex).join("/"));
  // The bulk buttons repaint through PATTERN_LENGTH_CHANGED; listen to it too so the counts follow.
  useStore(store, events.PATTERN_LENGTH_CHANGED, (s) => stepCounts(s, s.cursor.trackIndex).join("/"));
  const arpJson = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => JSON.stringify(arpOf(s.song.trackChannels[s.cursor.trackIndex])));
  const arp = JSON.parse(arpJson);
  const lfo = JSON.parse(lfoJson);
  const [participating, notes] = stepsKey.split("/").map(Number);
  const set = (patch) => store.setTrackChannelEventLfo(trackIndex, patch);

  return (
    <div className="fx-panel">
      <div className="fx-panel__header">
        <span className="fx-panel__label">{`TRK ${trackIndex + 1} — ${trackName}`}</span>
      </div>
      <div className="fx-panel__modules">
        <ArpModule arp={arp} notes={notes} onChange={(patch) => store.setTrackChannelArp(trackIndex, patch)} />

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

const VELOCITY_MODES = [
  { id: "source", label: "SRC", title: "Generated notes keep the velocity of the step they play inside" },
  { id: "pattern", label: "PAT", title: "Generated notes follow the step levels below" },
  { id: "accent", label: "ACC", title: "The step levels only ever turn the step's velocity down" },
];

// One bar per velocity step; press and drag across them to draw a pattern. Levels are 0..1 in the
// model and read 0-127 here, like the VEL column.
function ArpVelocitySteps({ steps, disabled, onChange }) {
  const ref = useRef(null);
  function paint(e) {
    const el = ref.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const index = Math.min(steps.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * steps.length)));
    const level = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)) * 100) / 100;
    if (steps[index] !== level) onChange(steps.map((v, i) => (i === index ? level : v)));
  }
  return (
    <div
      className="arp-steps"
      ref={ref}
      role="group"
      aria-label="Arp velocity steps"
      title={steps.map((v) => Math.round(v * 127)).join(" ")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        paint(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && paint(e)}
    >
      {steps.map((level, i) => (
        <div key={i} className="arp-steps__bar">
          <div className="arp-steps__fill" style={{ height: `${level * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

// The arp reads this track's steps bar by bar (their notes are the chord, their lengths the windows
// it plays in) and plays generated notes in their place; the steps themselves are never changed.
function ArpModule({ arp, notes, onChange }) {
  const v = arp.velocity;
  const setSteps = (steps) => onChange({ velocity: { steps } });
  function lengthDelta(d) {
    const n = Math.min(MAX_ARP_VELOCITY_STEPS, Math.max(MIN_ARP_VELOCITY_STEPS, v.steps.length + d));
    if (n === v.steps.length) return;
    setSteps(n < v.steps.length ? v.steps.slice(0, n) : [...v.steps, ...Array.from({ length: n - v.steps.length }, (_, i) => v.steps[i % v.steps.length])]);
  }
  return (
    <div className="fx-module fx-module--arp">
      <div className="fx-module__header">
        <span className="fx-module__title">Arp</span>
        <span title={arp.enabled ? "Plays this track's steps, bar by bar" : "Off: steps play as written"}>{arp.enabled && notes === 0 ? "NO STEPS" : arp.enabled ? "ON" : "OFF"}</span>
      </div>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Enabled</span>
        <button type="button" className={`fx-module__toggle${arp.enabled ? " fx-module__toggle--on" : ""}`} onClick={() => onChange({ enabled: !arp.enabled })}>
          {arp.enabled ? "ON" : "OFF"}
        </button>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Order</span>
        <select value={arp.mode} onChange={(e) => onChange({ mode: e.target.value })}>
          {ARP_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
      {arp.mode === "pattern" && (
        <label className="fx-module__field" title="Index into the chord, low to high. · is a rest.">
          <span className="fx-module__field-label">Pattern</span>
          <select value={arp.pattern} onChange={(e) => onChange({ pattern: e.target.value })}>
            {ARP_PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="fx-module__value" />
        </label>
      )}
      <label className="fx-module__field">
        <span className="fx-module__field-label">Rate</span>
        <select value={arp.rate} onChange={(e) => onChange({ rate: e.target.value })}>
          {ARP_RATES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Octaves</span>
        <input
          type="range"
          min={1}
          max={MAX_ARP_OCTAVES}
          step={1}
          value={arp.octaves}
          onChange={(e) => onChange({ octaves: Number(e.target.value) })}
          style={rangeFillStyle(arp.octaves, 1, MAX_ARP_OCTAVES)}
        />
        <span className="fx-module__value">{arp.octaves}</span>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Gate</span>
        <input
          type="range"
          min={Math.round(MIN_ARP_GATE * 100)}
          max={100}
          step={5}
          value={Math.round(arp.gate * 100)}
          onChange={(e) => onChange({ gate: Number(e.target.value) / 100 })}
          style={rangeFillStyle(Math.round(arp.gate * 100), Math.round(MIN_ARP_GATE * 100), 100)}
        />
        <span className="fx-module__value">{Math.round(arp.gate * 100)}%</span>
      </label>
      <div className="fx-module__field">
        <span className="fx-module__field-label">Velocity</span>
        <span className="arp-vel-modes">
          {VELOCITY_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.title}
              className={`fx-module__toggle arp-vel-modes__btn${v.mode === m.id ? " fx-module__toggle--on" : ""}`}
              onClick={() => onChange({ velocity: { mode: m.id } })}
            >
              {m.label}
            </button>
          ))}
        </span>
      </div>
      {v.mode !== "source" && (
        <>
          <label className="fx-module__field">
            <span className="fx-module__field-label">Amount</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(v.amount * 100)}
              onChange={(e) => onChange({ velocity: { amount: Number(e.target.value) / 100 } })}
              style={rangeFillStyle(Math.round(v.amount * 100), 0, 100)}
            />
            <span className="fx-module__value">{Math.round(v.amount * 100)}%</span>
          </label>
          <ArpVelocitySteps steps={v.steps} disabled={!arp.enabled} onChange={setSteps} />
          <div className="arp-steps-tools">
            <button type="button" className="fx-panel__target-btn" disabled={v.steps.length <= MIN_ARP_VELOCITY_STEPS} onClick={() => lengthDelta(-1)} aria-label="Fewer velocity steps">
              −
            </button>
            <span className="arp-steps-tools__count">{v.steps.length}</span>
            <button type="button" className="fx-panel__target-btn" disabled={v.steps.length >= MAX_ARP_VELOCITY_STEPS} onClick={() => lengthDelta(1)} aria-label="More velocity steps">
              +
            </button>
            <select
              value=""
              aria-label="Velocity step preset"
              onChange={(e) => {
                const preset = ARP_VELOCITY_PRESETS.find((p) => p.id === e.target.value);
                if (preset) setSteps([...preset.steps]);
              }}
            >
              <option value="">PRESET…</option>
              {ARP_VELOCITY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
