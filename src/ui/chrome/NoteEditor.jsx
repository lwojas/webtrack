import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getActivePattern } from "../../model/query.js";
import { EFFECT_COMMANDS } from "../../model/effects.js";
import { formatBarBeat } from "../../model/timing.js";
import { noteNumberToName, parseNoteName, toHex } from "../../model/notes.js";

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
    const pattern = getActivePattern(s.song, s.activeBankIndex);
    const selected = pattern?.tracks[trackIndex]?.events[rowIndex];
    if (!selected) return "";
    return [selected.note, selected.instrument, selected.velocity, selected.pan, selected.effectCommand, selected.effectParam, selected.length].join("|");
  });

  const state = store.getState();
  const pattern = getActivePattern(state.song, state.activeBankIndex);
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

  function handleNoteChange(text) {
    setField("note", parseNoteName(text));
  }

  function handleHexFieldChange(field, max) {
    return (text) => {
      if (text.trim() === "") {
        setField(field, null);
        return;
      }
      setField(field, Math.max(0, Math.min(max, Number.parseInt(text, 16) || 0)));
    };
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

  function handleEffectParamChange(text) {
    const value = Math.max(0, Math.min(255, Number.parseInt(text, 16) || 0));
    setField("effectParam", value);
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
        <input
          type="text"
          placeholder="---"
          value={noteNumberToName(event.note)}
          onChange={(e) => handleNoteChange(e.target.value)}
        />
      </label>

      <label className="note-editor__field">
        INSTRUMENT
        <input
          type="text"
          maxLength={2}
          placeholder="--"
          value={toHex(event.instrument, 2)}
          onChange={(e) => handleHexFieldChange("instrument", 255)(e.target.value)}
        />
      </label>

      <label className="note-editor__field">
        VELOCITY
        <input
          type="text"
          maxLength={2}
          placeholder="--"
          value={toHex(event.velocity, 2)}
          onChange={(e) => handleHexFieldChange("velocity", 127)(e.target.value)}
        />
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
        <input
          type="text"
          maxLength={2}
          value={toHex(event.effectParam, 2)}
          onChange={(e) => handleEffectParamChange(e.target.value)}
        />
      </label>
    </div>
  );
}
