import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import { EFFECT_COMMANDS } from "../../model/effects.js";
import { FX_PARAMS, getFxParam, formatFxValue } from "../../model/fxParams.js";
import { formatBarBeat } from "../../model/timing.js";
import { noteNumberToName, parseNoteName, toHex } from "../../model/notes.js";

// Mirrors the local-draft-state + commit-on-blur/Enter, revert-on-Escape pattern
// ui/chrome/PatternManager.jsx's pattern-rename field already uses: typing updates only this
// local state, so the field never fights the user by snapping back to a reformatted value
// (noteNumberToName's "---"/toHex's zero-padding) mid-keystroke the way a fully store-value
// -controlled input did. `parse` returns:
//   - a value (including null, for "clear this field") to commit, or
//   - `undefined` to mean "not parseable yet" — left uncommitted so a still-incomplete edit
//     (e.g. "D" on the way to "D#4") never overwrites the model, and gets reverted on blur.
// Returns spreadable <input> props rather than JSX so NoteField/HexField below only need to
// supply their field-specific format/parse and tag on the right `type`/`maxLength`.
function useDraftField({ value, format, parse, onCommit }) {
  const [draft, setDraft] = useState(() => format(value));
  const focusedRef = useRef(false);
  // Enter/Escape both call the DOM input's .blur() to leave the field once they've already
  // decided what the draft should be — but blur() dispatches its event synchronously, before
  // React has flushed the setDraft() call just above it, so the resulting onBlur would
  // otherwise read the *pre-revert* `draft` from its still-stale closure and re-commit it,
  // undoing the Escape. This flag tells that blur to no-op instead, since Enter/Escape already
  // did the one commit-or-revert this blur would have done.
  const suppressBlurRef = useRef(false);

  // Keeps the field in sync with cursor moves and with edits landing on this same cell from
  // elsewhere (the grid's own keyboard entry) — but only while this input isn't the thing the
  // user is actively typing into, so an in-progress edit is never clobbered by its own commit
  // echoing back through `value`, or by an unrelated external change.
  useEffect(() => {
    if (!focusedRef.current) setDraft(format(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- format/parse are stable per field

  function commit(text) {
    const parsed = parse(text);
    if (parsed === undefined) return false;
    onCommit(parsed);
    setDraft(format(parsed));
    return true;
  }

  return {
    value: draft,
    onChange: (e) => setDraft(e.target.value),
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      if (suppressBlurRef.current) {
        suppressBlurRef.current = false;
        return;
      }
      if (!commit(draft)) setDraft(format(value));
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!commit(draft)) setDraft(format(value));
        suppressBlurRef.current = true;
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDraft(format(value));
        suppressBlurRef.current = true;
        e.currentTarget.blur();
      }
    },
  };
}

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

function NoteField({ value, onCommit }) {
  const inputProps = useDraftField({ value, format: noteNumberToName, parse: parseNoteDraft, onCommit });
  return <input type="text" placeholder="---" {...inputProps} />;
}

// Shared by every hex-typed field (instrument/velocity/FX param) — same draft/commit mechanics
// as NoteField, just with toHex's formatting and a clamped hex parse instead of note parsing.
export function parseHexInput(text, max) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^[0-9a-f]+$/i.test(trimmed)) return undefined;
  return Math.max(0, Math.min(max, Number.parseInt(trimmed, 16)));
}

function HexField({ value, max, onCommit }) {
  const inputProps = useDraftField({
    value,
    format: (v) => toHex(v, 2),
    parse: (text) => parseHexInput(text, max),
    onCommit,
  });
  return <input type="text" maxLength={2} placeholder="--" {...inputProps} />;
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
      JSON.stringify(selected.fx),
    ].join("|");
  });

  // Keeps CELL FX's "+ ADD FX" list in sync if the current track's enabled FX change (the FX
  // panel) while this cell is open, not just on a cursor/cell-content change.
  useStore(store, events.TRACK_FX_CHANGED, (s) => JSON.stringify(s.song.trackChannels[cursor.trackIndex]?.fxChain ?? []));

  const state = store.getState();
  const pattern = getSelectedPattern(state.song);
  const event = pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex];

  if (!event) {
    return (
      <div className="note-editor">
        <div className="note-editor__header">NOTE EDITOR</div>
        <div className="note-editor__empty">No cell selected</div>
      </div>
    );
  }

  function setField(field, value) {
    store.setCell(cursor.trackIndex, cursor.rowIndex, field, value);
  }

  function handleLengthChange(text) {
    if (text.trim() === "") {
      setField("length", null);
      return;
    }
    const value = Math.max(1, Math.min(pattern.rowCount, Number.parseInt(text, 10) || 1));
    setField("length", value);
  }

  function handlePanChange(text) {
    setField("pan", Number(text));
  }

  function handleEffectCommandChange(id) {
    setField("effectCommand", id === "" ? null : id);
  }

  // Cell FX automation (model/event.js#fx) — a sparse subset of FX_PARAMS, shared with
  // ui/chrome/FxPanel.jsx so a given parameter edits with the exact same range/step/formatting
  // wherever it shows up, not two independently-maintained descriptions of "delay.mix". Only
  // ever shows params belonging to an FX this track actually has enabled
  // (model/trackChannel.js#fxChain) and marked cellAutomatable (model/fxParams.js) — never the
  // complete FX_PARAMS catalog. bus.gain (type null) is exempt: it's always on, not part of any
  // chain. model/mutations.js#setCellFxParam enforces the same rule at the write layer, so the
  // cellFxEntries filter below is only ever a no-op defensive guard in steady state (it'd only
  // matter for data from a track whose FX was since removed without going through that path).
  const trackFxChain = state.song.trackChannels[cursor.trackIndex]?.fxChain ?? [];
  const isFxTypeActive = (type) => type === null || trackFxChain.some((entry) => entry.type === type);

  const cellFxEntries = (event.fx ? Object.entries(event.fx) : []).filter(([paramId]) => isFxTypeActive(getFxParam(paramId)?.type));
  const availableFxParams = FX_PARAMS.filter(
    (param) =>
      isFxTypeActive(param.type) &&
      param.cellAutomatable !== false &&
      !cellFxEntries.some(([id]) => id === param.id),
  );

  function handleCellFxChange(paramId, value) {
    store.setCellFx(cursor.trackIndex, cursor.rowIndex, paramId, value);
  }

  function handleCellFxRemove(paramId) {
    store.setCellFx(cursor.trackIndex, cursor.rowIndex, paramId, null);
  }

  function handleAddCellFx(paramId) {
    if (!paramId) return;
    const param = getFxParam(paramId);
    const trackFx = state.song.trackChannels[cursor.trackIndex]?.fx ?? {};
    // Seeds at the track's current value for this param, not the catalog default — this FX is
    // already enabled and (very likely) already parked somewhere other than its neutral value,
    // so a freshly-added cell entry should start as a no-op continuation of that, not a jump
    // back to default the moment this row plays.
    store.setCellFx(cursor.trackIndex, cursor.rowIndex, paramId, trackFx[paramId] ?? param?.default ?? 0);
  }

  return (
    <div className="note-editor">
      <div className="note-editor__header">NOTE EDITOR</div>

      <div className="note-editor__context">
        <span>TRK {cursor.trackIndex + 1}</span>
        <span>{formatBarBeat(cursor.rowIndex)}</span>
      </div>

      <label className="note-editor__field">
        NOTE
        <NoteField value={event.note} onCommit={(value) => setField("note", value)} />
      </label>

      <label className="note-editor__field">
        INSTRUMENT
        <HexField value={event.instrument} max={255} onCommit={(value) => setField("instrument", value)} />
      </label>

      <label className="note-editor__field">
        VELOCITY
        <HexField value={event.velocity} max={127} onCommit={(value) => setField("velocity", value)} />
      </label>

      <label className="note-editor__field">
        LENGTH
        <input
          type="number"
          min={1}
          max={pattern.rowCount}
          placeholder="auto"
          value={event.length ?? ""}
          onChange={(e) => handleLengthChange(e.target.value)}
        />
      </label>

      <label className="note-editor__field">
        PAN
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={event.pan ?? 0}
          onChange={(e) => handlePanChange(e.target.value)}
        />
      </label>

      <label className="note-editor__field">
        FX
        <select value={event.effectCommand ?? ""} onChange={(e) => handleEffectCommandChange(e.target.value)}>
          <option value="">(none)</option>
          {EFFECT_COMMANDS.map((command) => (
            <option key={command.id} value={command.id}>
              {command.code} — {command.label}
            </option>
          ))}
        </select>
      </label>

      <label className="note-editor__field">
        FX PARAM
        <HexField value={event.effectParam} max={255} onCommit={(value) => setField("effectParam", value)} />
      </label>

      <div className="note-editor__section">CELL FX</div>

      {cellFxEntries.map(([paramId, value]) => {
        const param = getFxParam(paramId);
        if (!param) return null;
        return (
          <label className="note-editor__field note-editor__field--fx" key={paramId}>
            {param.label}
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={value}
              onChange={(e) => handleCellFxChange(paramId, Number(e.target.value))}
            />
            <span className="note-editor__fx-value">{formatFxValue(value, param)}</span>
            <button type="button" className="note-editor__fx-remove" onClick={() => handleCellFxRemove(paramId)} title="Remove">
              ×
            </button>
          </label>
        );
      })}

      {availableFxParams.length > 0 && (
        <label className="note-editor__field">
          + ADD FX
          <select value="" onChange={(e) => handleAddCellFx(e.target.value)}>
            <option value="">(select)</option>
            {availableFxParams.map((param) => (
              <option key={param.id} value={param.id}>
                {param.group} — {param.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
