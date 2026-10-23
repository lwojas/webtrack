import { getSelectedPattern } from "../model/query.js";
import { triggerPreview } from "../audio/preview.js";
import { isTypingTarget } from "./isTypingTarget.js";
import { scaleOf, snapEnteredNote } from "../model/scale.js";

// Hex-digit entry (instrument/velocity columns) and cursor navigation. Effect command/param
// aren't part of this MVP's keyboard cursor flow — the fx column still displays and stores
// them (model/effects.js), just not through keyboard hex entry yet; see ECS-156 plan §8/§12.
const HEX_DIGIT_PATTERN = /^[0-9a-f]$/i;
const HEX_FIELDS = new Set(["instrument", "velocity"]);
const FIELD_MAX = { instrument: 255, velocity: 127 };

// Copy/paste/clear operate on the current selection (state/store.js's getSelectionRect/
// copySelection/pasteSelection/clearSelection — same whole-event granularity as before, just
// generalized from a single cell to a rect), not a single field — "duplicate this block
// around the pattern" is the use case, not "duplicate just this velocity." Copy/paste only
// fires when focus isn't in a text input/select (so the BPM field, project name, and the note
// editor's own inputs keep ordinary OS copy/paste), and only for the plain Ctrl/Cmd+C /
// Ctrl/Cmd+V chord. The clipboard itself lives on the store (not in here) so the selection
// toolbar's Copy/Paste/Repeat/Fill buttons (ui/chrome/SelectionToolbar.jsx) share the exact
// same clipboard these shortcuts do, rather than keeping two independent copies of it.
export function createEditController({ store, noteSources }) {
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
        store.copySelection();
        return;
      }
      if (key === "v") {
        e.preventDefault();
        store.pasteSelection();
        return;
      }
    }

    // Shift+Arrow grows/shrinks the selection (store.js#extendSelection) instead of moving the
    // cursor outright — plain Arrow keeps its existing behavior (including ArrowLeft/Right's
    // field-cycling/track-wrap), since Shift+Arrow had no behavior of its own before this.
    // Selection only ever spans whole (track, row) cells, never fields, so the shift-held path
    // never touches/cycles field the way plain ArrowLeft/Right does.
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (e.shiftKey) store.extendSelection({ row: -1 });
      else store.moveCursor({ row: -1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (e.shiftKey) store.extendSelection({ row: 1 });
      else store.moveCursor({ row: 1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (e.shiftKey) store.extendSelection({ track: -1 });
      else store.moveCursor({ field: -1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (e.shiftKey) store.extendSelection({ track: 1 });
      else store.moveCursor({ field: 1 });
      resetDigitBuffer();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      store.clearSelection();
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
  function handleNoteOn({ note: playedNote, velocity, chromatic, routed }) {
    const { song, cursor, editMode, selectedInstrumentIndex, instruments } = store.getState();
    // With the project's Snap on, a played note lands on the nearest scale note (heard and
    // written alike); a source can ask for a chromatic one (Shift on the computer keyboard).
    const note = snapEnteredNote(scaleOf(song), playedNote, { chromatic });
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
    // `routed`: the host is already playing this note itself (a MIDI key, audio/midiRoute.js): entering it below still happens, hearing it twice must not.
    if (trackChannel && !routed) triggerPreview(previewEvent, trackChannel, instruments).catch(() => {});

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

  // Every source in noteSources (the computer keyboard, and now any attached MIDI device —
  // see midiInputSource.js) feeds the same handleNoteOn, so a note entered from either writes
  // into the model identically; the keydown handler above is wired exactly once regardless of
  // how many note sources there are, which is also why this takes an array rather than one
  // source per createEditController instance (docs/EXTENDING.md's other suggested option would
  // attach a second "keydown" listener on the same target and double every cursor move/hex
  // digit/copy-paste shortcut).
  function attach(target = window) {
    target.addEventListener("keydown", handleKeyDown);
    const unsubscribes = noteSources.map((noteSource) => noteSource.onNoteOn(handleNoteOn));
    return () => {
      target.removeEventListener("keydown", handleKeyDown);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }

  return { attach };
}
