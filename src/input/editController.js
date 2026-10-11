import { getActivePattern } from "../model/query.js";
import { triggerPreview } from "../audio/preview.js";

// Hex-digit entry (instrument/velocity columns) and cursor navigation. Effect command/param
// aren't part of this MVP's keyboard cursor flow — the fx column still displays and stores
// them (model/effects.js), just not through keyboard hex entry yet; see ECS-156 plan §8/§12.
const HEX_DIGIT_PATTERN = /^[0-9a-f]$/i;
const HEX_FIELDS = new Set(["instrument", "velocity"]);
const FIELD_MAX = { instrument: 255, velocity: 127 };

export function createEditController({ store, noteSource }) {
  // A 2-digit hex entry buffer, scoped to whichever (track, row, field) it was last typed
  // into — resets whenever the cursor moves, matching the tracker convention of live preview
  // as each digit lands ("7" shows 07, then "F" completes it to 7F) rather than needing a
  // confirm keystroke.
  let digitBuffer = "";
  let digitBufferKey = null;

  function bufferKeyFor(cursor) {
    return `${cursor.trackIndex}.${cursor.rowIndex}.${cursor.field}`;
  }

  function resetDigitBuffer() {
    digitBuffer = "";
    digitBufferKey = null;
  }

  function handleHexDigit(key) {
    const { cursor } = store.getState();
    if (!HEX_FIELDS.has(cursor.field)) return;

    const thisKey = bufferKeyFor(cursor);
    if (digitBufferKey !== thisKey) {
      digitBuffer = "";
      digitBufferKey = thisKey;
    }
    digitBuffer = (digitBuffer + key).slice(-2);

    const value = Math.min(Number.parseInt(digitBuffer, 16), FIELD_MAX[cursor.field] ?? 255);
    store.setCell(cursor.trackIndex, cursor.rowIndex, cursor.field, value);

    if (digitBuffer.length >= 2) resetDigitBuffer();
  }

  function handleKeyDown(e) {
    const { editMode, cursor } = store.getState();

    if (e.key === "ArrowUp") {
      e.preventDefault();
      store.moveCursor({ row: -1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      store.moveCursor({ row: 1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      store.moveCursor({ field: -1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      store.moveCursor({ field: 1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      store.clearCell(cursor.trackIndex, cursor.rowIndex);
      resetDigitBuffer();
      return;
    }

    if (!editMode) return;
    if (!HEX_FIELDS.has(cursor.field)) return;
    if (!HEX_DIGIT_PATTERN.test(e.key)) return;
    e.preventDefault();
    handleHexDigit(e.key.toLowerCase());
  }

  // Audition always plays, regardless of edit mode or which column the cursor is on —
  // writing into the model only happens when editing is on and the cursor is on the NOTE
  // column (ECS-156 plan §8).
  function handleNoteOn({ note, velocity }) {
    const { song, cursor, editMode, activeBankIndex, selectedInstrumentIndex, instruments } = store.getState();
    const trackChannel = song.trackChannels[cursor.trackIndex];
    const previewEvent = {
      note,
      velocity,
      instrument: selectedInstrumentIndex,
      pan: null,
      effectCommand: null,
      effectParam: null,
    };
    // Fire-and-forget: audition is a nice-to-have, not something a note entry should ever
    // block on or throw over. Pressing a note key before the engine has been started (no
    // play() yet, and loading samples/triggering previews is otherwise behind a gesture too)
    // is a legitimate no-op, not an error — getRuntime() rejects in that case, and this swallows
    // it rather than leaving an unhandled rejection.
    if (trackChannel) triggerPreview(previewEvent, trackChannel, instruments).catch(() => {});

    if (!editMode || cursor.field !== "note") return;

    // Guard against a pattern this cursor position no longer belongs to (e.g. the bank
    // changed between the keydown and this async-free handler running) before writing.
    const pattern = getActivePattern(song, activeBankIndex);
    if (!pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex]) return;

    store.setCell(cursor.trackIndex, cursor.rowIndex, "note", note);
    store.setCell(cursor.trackIndex, cursor.rowIndex, "instrument", selectedInstrumentIndex);
    store.setCell(cursor.trackIndex, cursor.rowIndex, "velocity", velocity);

    const { editStep } = store.getState();
    if (editStep > 0) store.moveCursor({ row: editStep });
  }

  function attach(target = window) {
    target.addEventListener("keydown", handleKeyDown);
    const unsubscribeNoteOn = noteSource.onNoteOn(handleNoteOn);
    return () => {
      target.removeEventListener("keydown", handleKeyDown);
      unsubscribeNoteOn();
    };
  }

  return { attach };
}
