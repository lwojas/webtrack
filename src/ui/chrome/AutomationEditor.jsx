import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import { FX_PARAMS, getFxInstanceLabel, formatFxValue } from "../../model/fxParams.js";
import { toHex } from "../../model/notes.js";
import { STEPS_PER_BAR, STEPS_PER_BEAT } from "../../model/timing.js";
import {
  BUS_GAIN_KEY,
  fxKey,
  getAutomationParam,
  getBaseValue,
  getInstrumentAutomationParams,
  instKey,
  parseKey,
  trackKeys,
  trackPoints,
} from "../../model/cellAutomation.js";
import { AUTOMATION_TEMPLATES, applyTemplate, curveVertices, formatLaneLength, fractionToValue, templateById, valueToFraction } from "../../model/automationLane.js";

const HEIGHT = 120;
const MIN_ROW_PX = 10;

// Human label of a lane key, e.g. "Filter #2 — Cutoff" or "00 Kick — Decay".
function laneLabel(key, channel, instruments) {
  const t = parseKey(key);
  const param = getAutomationParam(key, channel, instruments);
  if (!t || !param) return key;
  if (t.kind === "bus") return "Output — Bus Gain";
  if (t.kind === "fx") return `${getFxInstanceLabel(channel.fxChain, t.instanceId)} — ${param.label}`;
  return `${toHex(t.slot)} ${instruments[t.slot]?.name ?? ""} — ${param.label}`.replace("  ", " ");
}

// Every lane a track could automate: its bus gain, each parameter of its FX chain instances that is
// a sensible step-automation target, and the parameters of every instrument slot that makes sound.
function availableLanes(channel, instruments) {
  const keys = [BUS_GAIN_KEY];
  for (const entry of channel?.fxChain ?? []) {
    for (const p of FX_PARAMS) if (p.type === entry.type && p.cellAutomatable !== false) keys.push(fxKey(entry.id, p.id));
  }
  instruments.forEach((instrument, slot) => {
    if (instrument.output?.type !== "instrument" && instrument.sampleId == null) return;
    for (const p of getInstrumentAutomationParams(instrument)) keys.push(instKey(slot, p.id));
  });
  return keys;
}

function formatValue(value, param, key) {
  return parseKey(key)?.kind === "inst" ? `${Number(value).toFixed(param.step >= 1 ? 0 : param.step >= 0.1 ? 1 : 3)}${param.unit ?? ""}` : formatFxValue(value, param);
}

// The automation editor: one lane (one parameter) of the cursor's track, drawn across that track's
// own loop. It is a view over the track's cell FX entries (model/cellAutomation.js), not a second
// data model: a point is the cell at its row, dragging one rewrites cells, and the horizontal axis
// is the track's own length, so polymeter and length changes need no special handling here.
// Opened from the Note Editor's CELL FX ("LANE"), in the same flex column as the grid (like the chop
// editor), so it shrinks the grid instead of overlaying it.
//
// Perf: React-only, never touches the grid/playhead modules; at most one point per row (a track is
// at most 128 rows), drawn as one SVG polyline plus that many small elements; a drag keeps a local
// draft and commits once on release.
export default function AutomationEditor({ store }) {
  const open = useStore(store, events.AUTOMATION_EDITOR_CHANGED, (s) => s.automationEditor.open);
  const key = useStore(store, events.AUTOMATION_EDITOR_CHANGED, (s) => s.automationEditor.key);
  const trackIndex = useStore(store, events.CURSOR_MOVED, (s) => s.cursor.trackIndex);
  if (!open) return null;
  return <Body store={store} trackIndex={trackIndex} laneKey={key} />;
}

function Body({ store, trackIndex, laneKey }) {
  // Fingerprints, not objects (docs/ARCHITECTURE.md's in-place-mutation gotcha).
  useStore(store, events.CELL_CHANGED, (s) => JSON.stringify(trackPoints(getSelectedPattern(s.song)?.tracks[trackIndex] ?? { events: [] }, laneKey ?? "")));
  useStore(store, events.TRACK_LENGTH_CHANGED, (s) => getSelectedPattern(s.song)?.tracks[trackIndex]?.length);
  useStore(store, events.PATTERN_SELECTED, (s) => s.song.selectedPatternId);
  useStore(store, events.TRACK_FX_CHANGED, (s) => JSON.stringify(s.song.trackChannels[trackIndex]?.fxChain ?? []));
  useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments.map((i) => `${i.name}|${i.output?.type}|${i.output?.kind}|${i.sampleId != null}`).join(";"));

  const state = store.getState();
  const track = getSelectedPattern(state.song)?.tracks[trackIndex];
  const channel = state.song.trackChannels[trackIndex];
  const instruments = state.instruments;
  const param = laneKey ? getAutomationParam(laneKey, channel, instruments) : null;
  const length = track ? Math.min(track.length || track.events.length, track.events.length) : 0;
  const bars = length / STEPS_PER_BAR;

  const [selectedRow, setSelectedRow] = useState(null);
  const [draft, setDraft] = useState(null); // { row, value } while a point is being dragged
  const [newGlide, setNewGlide] = useState(true); // points drawn on the canvas ramp by default
  const [range, setRange] = useState("all");
  const [width, setWidth] = useState(0);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const measure = () => setWidth(wrap.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [param]);
  useEffect(() => setSelectedRow(null), [laneKey, trackIndex]);

  if (!track || !channel) return null;

  const close = () => store.setAutomationEditor(false);
  const pickLane = (key) => store.setAutomationEditor(true, key || null);

  const active = trackKeys(track);
  const all = availableLanes(channel, instruments);
  const unused = all.filter((k) => !active.includes(k));
  const validActive = active.filter((k) => getAutomationParam(k, channel, instruments));

  const header = (
    <div className="automation-editor__bar">
      <span className="automation-editor__title">AUTOMATION — TRK {trackIndex + 1}</span>
      <select className="automation-editor__lane" value={laneKey ?? ""} onChange={(e) => pickLane(e.target.value)} aria-label="Lane">
        <option value="">(pick a lane)</option>
        {validActive.length > 0 && (
          <optgroup label="With points">
            {validActive.map((k) => (
              <option key={k} value={k}>
                {laneLabel(k, channel, instruments)}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Add a lane">
          {unused.map((k) => (
            <option key={k} value={k}>
              {laneLabel(k, channel, instruments)}
            </option>
          ))}
        </optgroup>
      </select>
      <span className="automation-editor__length" title="The lane spans this track's own loop length">
        {formatLaneLength(length)}
      </span>
      <button type="button" className="fx-panel__target-btn automation-editor__close" onClick={close}>
        CLOSE
      </button>
    </div>
  );

  if (!laneKey || !param) {
    return (
      <div className="automation-editor">
        {header}
        <div className="automation-editor__hint">Pick a lane to draw automation across this track: click the lane to add points, drag to move them.</div>
      </div>
    );
  }

  const points = trackPoints(track, laneKey);
  const shown = draft ? [...points.filter((p) => p.row !== draft.origin && p.row !== draft.row), { row: draft.row, value: draft.value, glide: draft.glide }].sort((a, b) => a.row - b.row) : points;
  const rowPx = Math.max(MIN_ROW_PX, width / Math.max(1, length));
  const innerWidth = rowPx * length;
  const canTemplate = !param.kind;
  const x = (row) => (row + 0.5) * rowPx;
  const y = (value) => HEIGHT - valueToFraction(param, value) * HEIGHT;
  const polyline = curveVertices(shown, length)
    .map(([row, value]) => `${x(row)},${y(value)}`)
    .join(" ");

  const rowAt = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return Math.min(length - 1, Math.max(0, Math.floor((clientX - rect.left + wrapRef.current.scrollLeft) / rowPx)));
  };
  const valueAt = (clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return fractionToValue(param, 1 - (clientY - rect.top) / HEIGHT);
  };
  const isRamp = parseKey(laneKey)?.kind !== "bus";
  const set = (row, value, glide) => store.setCellAutomation(trackIndex, row, laneKey, value, { glide });

  const onLanePointerDown = (e) => {
    const row = rowAt(e.clientX);
    set(row, valueAt(e.clientY), isRamp ? newGlide : false);
    setSelectedRow(row);
  };

  const onPointPointerDown = (point) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { origin: point.row, glide: point.glide, moved: false };
    setSelectedRow(point.row);
  };
  const onPointPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    setDraft({ origin: drag.origin, row: rowAt(e.clientX), value: valueAt(e.clientY), glide: drag.glide });
  };
  const onPointPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved && draft) {
      if (draft.row !== drag.origin) set(drag.origin, null);
      set(draft.row, draft.value, draft.glide);
      setSelectedRow(draft.row);
    }
    setDraft(null);
  };
  const selectedPoint = points.find((p) => p.row === selectedRow) ?? null;
  const removeSelected = () => {
    if (!selectedPoint) return;
    set(selectedPoint.row, null);
    setSelectedRow(null);
  };
  const toggleGlide = () => selectedPoint && isRamp && set(selectedPoint.row, selectedPoint.value, !selectedPoint.glide);
  const onPointKeyDown = (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      toggleGlide();
    }
  };

  const applyShape = (id) => {
    const template = templateById(id);
    if (!template) return;
    const { from, to, points: shape } = applyTemplate(template, bars > 1 ? range : "all", param, length);
    store.replaceAutomationRange(trackIndex, laneKey, from, to, isRamp ? shape : shape.map((p) => ({ ...p, glide: false })));
  };
  const clearLane = () => store.replaceAutomationRange(trackIndex, laneKey, 0, track.events.length - 1, []);
  const base = getBaseValue(laneKey, channel, instruments);

  return (
    <div className="automation-editor">
      {header}
      <div className="automation-editor__bar">
        {canTemplate && (
          <select
            className="automation-editor__lane"
            value=""
            onChange={(e) => e.target.value && applyShape(e.target.value)}
            aria-label="Apply a shape"
          >
            <option value="">Apply shape…</option>
            {AUTOMATION_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        {canTemplate && bars > 1 && (
          <span className="fx-panel__target" role="group" aria-label="Where on the track">
            {[["all", "ALL"], ["start", "BAR 1"], ["end", "LAST BAR"]].map(([r, text]) => (
              <button key={r} type="button" className={`fx-panel__target-btn${range === r ? " fx-panel__target-btn--active" : ""}`} onClick={() => setRange(r)}>
                {text}
              </button>
            ))}
          </span>
        )}
        {isRamp && (
          <span className="fx-panel__target" role="group" aria-label="New points">
            <span className="automation-editor__label">NEW</span>
            <button type="button" className={`fx-panel__target-btn${newGlide ? " fx-panel__target-btn--active" : ""}`} onClick={() => setNewGlide(true)} title="New points ramp to the next point">
              RAMP
            </button>
            <button type="button" className={`fx-panel__target-btn${newGlide ? "" : " fx-panel__target-btn--active"}`} onClick={() => setNewGlide(false)} title="New points hold their value until the next point">
              STEP
            </button>
          </span>
        )}
        <button
          type="button"
          className={`fx-panel__target-btn${selectedPoint?.glide ? " fx-panel__target-btn--active" : ""}`}
          disabled={!selectedPoint || !isRamp}
          onClick={toggleGlide}
          aria-pressed={Boolean(selectedPoint?.glide)}
          title="The selected point ramps to the next point (lit) or holds until it (G)"
        >
          POINT RAMPS
        </button>
        <button type="button" className="fx-panel__target-btn" disabled={!selectedPoint} onClick={removeSelected} title="Remove the selected point (Delete)">
          REMOVE POINT
        </button>
        <button type="button" className="fx-panel__target-btn" disabled={points.length === 0} onClick={clearLane}>
          CLEAR
        </button>
        <span className="automation-editor__readout">
          {selectedPoint ? `ROW ${selectedPoint.row + 1} · ${formatValue(selectedPoint.value, param, laneKey)}` : `BASE ${formatValue(base, param, laneKey)}`}
        </span>
      </div>
      <div ref={wrapRef} className="automation-editor__scroll">
        <div className="automation-editor__lane-canvas" style={{ width: innerWidth, height: HEIGHT }} onPointerDown={onLanePointerDown}>
          {Array.from({ length: Math.ceil(length / STEPS_PER_BEAT) }, (_, beat) => (
            <div
              key={beat}
              className={`automation-editor__tick${beat % (STEPS_PER_BAR / STEPS_PER_BEAT) === 0 ? " automation-editor__tick--bar" : ""}`}
              style={{ left: beat * STEPS_PER_BEAT * rowPx }}
            >
              {beat % (STEPS_PER_BAR / STEPS_PER_BEAT) === 0 && <span>{beat / (STEPS_PER_BAR / STEPS_PER_BEAT) + 1}</span>}
            </div>
          ))}
          {shown.length > 0 && (
            <svg className="automation-editor__curve" width={innerWidth} height={HEIGHT} aria-hidden="true">
              <polyline points={polyline} fill="none" />
            </svg>
          )}
          {shown.map((p) => (
            <div
              key={p.row}
              className={`automation-editor__point${p.row === selectedRow ? " automation-editor__point--selected" : ""}${p.glide ? " automation-editor__point--ramp" : ""}`}
              style={{ left: x(p.row), top: y(p.value) }}
              role="slider"
              tabIndex={0}
              aria-label={`Row ${p.row + 1}`}
              aria-valuemin={param.min}
              aria-valuemax={param.max}
              aria-valuenow={p.value}
              title={`row ${p.row + 1}: ${formatValue(p.value, param, laneKey)}${p.glide ? " (ramps to next)" : ""}`}
              onPointerDown={onPointPointerDown(p)}
              onPointerMove={onPointPointerMove}
              onPointerUp={onPointPointerUp}
              onPointerCancel={onPointPointerUp}
              onKeyDown={onPointKeyDown}
              onFocus={() => setSelectedRow(p.row)}
            />
          ))}
        </div>
      </div>
      <div className="automation-editor__hint">
        Each point is the cell on that row of this track. A ramp point glides to the next point; a step point holds until it. Before the first point the parameter stays at its base value
        (set in its FX or instrument panel); stopping playback restores the base.
      </div>
    </div>
  );
}
