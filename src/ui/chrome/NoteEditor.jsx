import { useRef } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import { FX_PARAMS, getFxInstanceLabel, formatFxValue } from "../../model/fxParams.js";
import {
  BUS_GAIN_KEY,
  fxKey,
  getAutomationParam,
  getBaseValue,
  getInstrumentAutomationParams,
  instKey,
  listCellEntries,
} from "../../model/cellAutomation.js";
import { formatBarBeat } from "../../model/timing.js";
import { parseNoteName, toHex } from "../../model/notes.js";
import { scaleOf } from "../../model/scale.js";
import { buildNoteGraph, fieldValue } from "../../model/noteGraph.js";
import NoteGraph from "./NoteGraph.jsx";
import { SectionHeader, useCollapsed } from "./collapse.jsx";
import { rangeFillStyle } from "../rangeFill.js";
import { chordLabel } from "../../model/chord.js";

// A draft field's `parse` contract (see useDraftField above), applied to model/notes.js's
// existing parseNoteName rather than a second note parser: "" / "---" explicitly clears the
// cell, a syntactically valid name (any parseNoteName understands — same "C4"/"C#4"/"D4"
// representation the grid and the rest of the app use) commits, and anything else (a
// still-incomplete name like "D" on the way to "D#4") is left uncommitted via `undefined`.
export function parseNoteDraft(text) {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "---") return null;
  return parseNoteName(trimmed) ?? undefined;
}

// Parsers for typed note/hex entry (the contract: a value or null to commit, undefined = not parseable yet).
export function parseHexInput(text, max) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^[0-9a-f]+$/i.test(trimmed)) return undefined;
  return Math.max(0, Math.min(max, Number.parseInt(trimmed, 16)));
}

// The complete editing surface for the event under the grid's cursor — every field
// model/event.js defines (note, instrument, velocity, length, pan, effect command/param) is
// readable and writable here, reading from and writing to the exact same event the grid cell
// renders (via store.setCell), not a second copy of it. The grid keeps its own fast
// keyboard+mouse path for note/instrument/velocity (src/input/editController.js) — this panel
// is the mouse-driven, low-frequency complement to that, not a replacement for it. It always
// reflects whichever cell the grid's cursor currently points at, mouse- or keyboard-selected
// alike, since both write the same store.cursor shape.
export default function NoteEditor({ store }) {
  const noteWindowRef = useRef(null);
  const [collapsed, toggleCollapsed] = useCollapsed("note-editor");
  const cursor = useStore(store, events.CURSOR_MOVED, (s) => s.cursor);
  // CELL_CHANGED covers edits landing on the selected cell from elsewhere (e.g. typing a new
  // note), so the panel can't show stale length/pan/fx values for a cell that just got a note.
  // Selecting a primitive "fingerprint" of the selected event (not the event object itself,
  // and not the whole state `s`) matters here — see ARCHITECTURE.md's in-place-mutation
  // gotcha: a selector that returns the same mutable object/reference every time means
  // useSyncExternalStore's Object.is check never sees a change and silently skips re-render.
  useStore(store, events.CELL_CHANGED, (s) => {
    const { trackIndex, rowIndex } = s.cursor;
    const pattern = getSelectedPattern(s.song);
    const selected = pattern?.tracks[trackIndex]?.events[rowIndex];
    if (!selected) return "";
    return [
      selected.note,
      selected.instrument,
      selected.velocity,
      selected.pan,
      selected.effectCommand,
      selected.effectParam,
      selected.length,
      selected.lfo,
      selected.ratchet,
      selected.tie,
      selected.chopTranspose,
      JSON.stringify(selected.chord),
      JSON.stringify(selected.fx),
    ].join("|");
  });

  // Keeps CELL FX's "+ ADD FX" list in sync if the current track's enabled FX change (the FX
  // panel) while this cell is open, not just on a cursor/cell-content change.
  useStore(store, events.TRACK_FX_CHANGED, (s) => JSON.stringify(s.song.trackChannels[cursor.trackIndex]?.fxChain ?? []));
  // ...and the project key, which decides which notes the NOTE bar offers.
  useStore(store, events.SCALE_CHANGED, (s) => `${s.song.scale?.root}|${s.song.scale?.scale}`);
  // ...and the instrument list (names, kinds, which slots make sound) feeds the instrument entries.
  const chordEditorOpen = useStore(store, events.CHORD_EDITOR_CHANGED, (s) => s.chordEditorOpen);
  useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments.map((i) => `${i.name}|${i.output?.type}|${i.output?.kind}|${i.sampleId != null}|${i.sampleMode}|${i.rootNote}|${i.cues?.length}`).join(";"));

  const state = store.getState();
  const pattern = getSelectedPattern(state.song);
  const event = pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex];

  if (!event) {
    return (
      <div className="note-editor">
        <SectionHeader className="note-editor__header" collapsed={collapsed} onToggle={toggleCollapsed}>
          NOTE EDITOR
        </SectionHeader>
        {!collapsed && <div className="note-editor__empty">No cell selected</div>}
      </div>
    );
  }

  // The graph's bars follow the cell's context (chop slices, the project key, existing instruments).
  // The NOTE bar's window is locked for the length of a drag so it does not slide under the pointer.
  const bars = buildNoteGraph(event, {
    instruments: state.instruments,
    scale: scaleOf(state.song),
    octave: state.octave,
    rowCount: pattern.rowCount,
    defaultInstrument: state.selectedInstrumentIndex,
    noteWindowStart: noteWindowRef.current,
  });

  function setBar(bar, value) {
    // A note typed into an instrument-less cell gets the selected instrument, as grid entry does.
    if (bar.id === "note" && value !== null && event.instrument === null) store.setCell(cursor.trackIndex, cursor.rowIndex, "instrument", state.selectedInstrumentIndex);
    store.setCell(cursor.trackIndex, cursor.rowIndex, bar.field, fieldValue(bar, value));
  }

  // Cell automation (model/event.js#fx, read uniformly by model/cellAutomation.js): the sparse
  // parameter values this cell sets, whatever they target — the track bus's output gain, one
  // stacked FX instance's parameter ("Filter #2 — Cutoff"), or one instrument slot's parameter
  // ("00 Bass — Cutoff"; instruments are global, so the slot is named explicitly). Parameters
  // render from the same catalogs as the FX and instrument panels, so a parameter edits with the
  // exact same range/step/formatting wherever it shows up. A cell can only automate something that
  // exists (model/mutations.js#setCellAutomation refuses the rest); entries whose target has since
  // gone are simply not listed.
  const channel = state.song.trackChannels[cursor.trackIndex];
  const trackFxChain = channel?.fxChain ?? [];
  const instruments = state.instruments;
  const cellInstrument = instruments[event.instrument ?? state.selectedInstrumentIndex];
  const cellEntries = listCellEntries(event)
    .map((entry) => ({ ...entry, param: getAutomationParam(entry.key, channel, instruments) }))
    .filter((entry) => entry.param);

  // "+ ADD" offers the bus gain, each parameter of each FX instance in this track's chain, and the
  // parameters of every instrument slot that makes sound, skipping what this cell already sets.
  const taken = new Set(cellEntries.map((e) => e.key));
  const availableOptions = [
    { key: BUS_GAIN_KEY, label: "Output — Bus Gain" },
    ...trackFxChain.flatMap((entry) =>
      FX_PARAMS.filter((param) => param.type === entry.type && param.cellAutomatable !== false).map((param) => ({
        key: fxKey(entry.id, param.id),
        label: `${getFxInstanceLabel(trackFxChain, entry.id)} — ${param.label}`,
      })),
    ),
    ...instruments.flatMap((instrument, slot) =>
      instrument.output?.type !== "instrument" && instrument.sampleId == null
        ? []
        : getInstrumentAutomationParams(instrument).map((param) => ({
            key: instKey(slot, param.id),
            label: `${toHex(slot)} ${instrument.name} — ${param.label}`,
          })),
    ),
  ].filter((option) => !taken.has(option.key));

  function entryLabel(entry) {
    if (entry.kind === "bus") return entry.param.label;
    if (entry.kind === "fx") return `${getFxInstanceLabel(trackFxChain, entry.instanceId)} — ${entry.param.label}`;
    return `${toHex(entry.slot)} ${instruments[entry.slot]?.name ?? ""} — ${entry.param.label}`;
  }

  function formatEntryValue(entry) {
    return entry.kind === "inst" ? `${Number(entry.value).toFixed(entry.param.step >= 1 ? 0 : entry.param.step >= 0.1 ? 1 : 3)}${entry.param.unit ?? ""}` : formatFxValue(entry.value, entry.param);
  }

  function handleAddCellAutomation(optionKey) {
    if (!optionKey) return;
    // Seeds at the parameter's current base value (not its catalog default): adding an entry is a
    // no-op continuation of what is already playing, not a jump the moment this row plays.
    const base = getBaseValue(optionKey, channel, instruments);
    if (base !== null) store.setCellAutomation(cursor.trackIndex, cursor.rowIndex, optionKey, base);
  }

  return (
    <div className="note-editor">
      <SectionHeader className="note-editor__header" collapsed={collapsed} onToggle={toggleCollapsed}>
        NOTE EDITOR
      </SectionHeader>
      {!collapsed && (
        <>
      <div className="note-editor__context">
        <span>TRK {cursor.trackIndex + 1}</span>
        <span>{formatBarBeat(cursor.rowIndex)}</span>
      </div>

      <label className="note-editor__field">
        INSTRUMENT
        <select
          className="note-editor__instrument"
          value={event.instrument ?? ""}
          onChange={(e) => setBar({ field: "instrument" }, e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">(none)</option>
          {state.instruments.map((instrument, slot) => (
            <option key={slot} value={slot}>
              {toHex(slot)} {instrument.name}
            </option>
          ))}
          {event.instrument !== null && !state.instruments[event.instrument] && <option value={event.instrument}>{toHex(event.instrument)} (missing)</option>}
        </select>
      </label>

      <NoteGraph bars={bars} onSet={setBar} onDrag={(bar, on) => { noteWindowRef.current = on && bar.id === "note" ? (bar.window ?? null) : null; }} />

      {/* A chord is a modifier on this note (model/chord.js): the note is its root. Hidden for chop slots, which play slices. */}
      {!(cellInstrument?.output?.type === "sample" && cellInstrument.sampleMode === "chop") && (
        <div className="note-editor__field">
          CHORD
          <button
            type="button"
            className={`fx-panel__target-btn${chordEditorOpen ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => store.setChordEditorOpen(!chordEditorOpen)}
            title="Open the chord editor under the grid: type, inversion, spread and the tones on a keyboard"
          >
            {event.chord ? chordLabel(event.chord).toUpperCase() : "OFF"} …
          </button>
        </div>
      )}

      <div className="note-editor__section">CELL AUTOMATION</div>

      {cellEntries.map((entry) => (
        <div className="note-editor__field note-editor__field--fx" key={entry.key}>
          <label className="note-editor__fx-label">
            {entryLabel(entry)}
            <input
              type="range"
              min={entry.param.min}
              max={entry.param.max}
              step={entry.param.step}
              value={entry.value}
              onChange={(e) => store.setCellAutomation(cursor.trackIndex, cursor.rowIndex, entry.key, Number(e.target.value))}
              style={rangeFillStyle(entry.value, entry.param.min, entry.param.max)}
            />
          </label>
          <span className="note-editor__fx-value">{formatEntryValue(entry)}</span>
          {entry.kind !== "bus" && (
            <button
              type="button"
              className={`note-editor__fx-remove${entry.glide ? " note-editor__fx-remove--on" : ""}`}
              onClick={() => store.setCellAutomation(cursor.trackIndex, cursor.rowIndex, entry.key, entry.value, { glide: !entry.glide })}
              title={entry.glide ? "Ramps to the next value of this parameter on this track (click for a step)" : "Steps (click to ramp to the next value of this parameter on this track)"}
              aria-pressed={entry.glide}
            >
              ~
            </button>
          )}
          <button type="button" className="note-editor__fx-remove" onClick={() => store.setAutomationEditor(true, entry.key)} title="Open this lane in the automation editor">
            ▤
          </button>
          <button type="button" className="note-editor__fx-remove" onClick={() => store.setCellAutomation(cursor.trackIndex, cursor.rowIndex, entry.key, null)} title="Remove">
            ×
          </button>
        </div>
      ))}

      <label className="note-editor__field">
        + ADD
        <select value="" onChange={(e) => handleAddCellAutomation(e.target.value)}>
          <option value="">(select)</option>
          {availableOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {availableOptions.length + cellEntries.length > 0 && (
        <button type="button" className="fx-panel__target-btn" onClick={() => store.setAutomationEditor(true, cellEntries[0]?.key ?? null)} title="Draw this track's automation across its loop">
          AUTOMATION EDITOR
        </button>
      )}
        </>
      )}
    </div>
  );
}
