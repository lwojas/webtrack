import { getSelectedPattern } from "../model/query.js";
import { cloneEvent } from "../model/event.js";
import { triggerPreview } from "../audio/preview.js";
import { isTypingTarget } from "./isTypingTarget.js";

// Hex-digit entry (instrument/velocity columns) and cursor navigation. Effect command/param
// aren't part of this MVP's keyboard cursor flow — the fx column still displays and stores
// them (model/effects.js), just not through keyboard hex entry yet; see ECS-156 plan §8/§12.
const HEX_DIGIT_PATTERN = /^[0-9a-f]$/i;
const HEX_FIELDS = new Set(["instrument", "velocity"]);
const FIELD_MAX = { instrument: 255, velocity: 127 };

// Copy/paste operates on a whole event (same granularity as Backspace/Delete's clearCell),
// not a single field — "duplicate this note around the pattern" is the use case, not
// "duplicate just this velocity." Only fires when focus isn't in a text input/select (so the
// BPM field, project name, and the note editor's own inputs keep ordinary OS copy/paste), and
// only for the plain Ctrl/Cmd+C / Ctrl/Cmd+V chord.
export function createEditController({ store, noteSource }) {
  // A 2-digit hex entry buffer, scoped to whichever (track, row, field) it was last typed
  // into — resets whenever the cursor moves, matching the tracker convention of live preview
  // as each digit lands ("7" shows 07, then "F" completes it to 7F) rather than needing a
  // confirm keystroke.
  let digitBuffer = "";
  let digitBufferKey = null;

  // Holds a clone of the last-copied event, independent of whatever's currently in that
  // source cell — see model/mutations.js#pasteEvent, which clones it again on every paste so
  // pasting the same clipboard into several cells never lets an edit to one leak into another.
  let clipboardEvent = null;

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

  function handleCopy() {
    const { song, cursor } = store.getState();
    const pattern = getSelectedPattern(song);
    const event = pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex];
    if (!event) return;
    clipboardEvent = cloneEvent(event);
  }

  function handlePaste() {
    if (!clipboardEvent) return;
    const { cursor } = store.getState();
    store.pasteCell(cursor.trackIndex, cursor.rowIndex, clipboardEvent);
  }

  function handleKeyDown(e) {
    // Every shortcut below (cursor navigation, clear, hex digit entry, copy/paste) targets
    // the grid, never the focused control — skip all of it while the project name, BPM, or
    // any other form field has focus, so normal text editing (including Backspace/arrows)
    // behaves normally instead of also moving the grid cursor or clearing the selected cell.
    if (isTypingTarget(e)) return;

    const { editMode, cursor } = store.getState();

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "c") {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (key === "v") {
        e.preventDefault();
        handlePaste();
        return;
      }
    }

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
    const { song, cursor, editMode, selectedInstrumentIndex, instruments } = store.getState();
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

    // Guard against a pattern this cursor position no longer belongs to (e.g. the selected
    // pattern changed between the keydown and this async-free handler running) before writing.
    const pattern = getSelectedPattern(song);
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
