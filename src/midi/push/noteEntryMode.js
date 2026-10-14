// Push "Note Mode" (CC50) content — confirmed against real hardware (not guessed): Push's pads
// already send standard Note On/Off in their resting state, exactly the same shape any MIDI
// keyboard sends, with no special handshake needed to get there (see the architecture doc's
// "Push Note Mode" section, which flagged this as the one open question — now resolved).
//
// So this mode is a thin adapter: modeController.js already decodes a pad message into
// (row, column, velocity) for every content handler uniformly; this one converts that straight
// back to the note the hardware itself assigned that pad (padNote — the inverse of
// modeController.js's own padCoordinates) and feeds it through the exact same
// input/noteInputSource.js contract keyboardNoteMap.js and input/midiInputSource.js already
// implement. editController.js never needs to know a note came from Push instead of a
// keyboard — this is the whole point of that contract.
import { createNoteInputSource } from "../../input/noteInputSource.js";
import {
  padNote,
  PUSH_CHANNEL,
  CC_ARROW_LEFT,
  CC_ARROW_RIGHT,
  CC_ARROW_UP,
  CC_ARROW_DOWN,
  CC_SELECT,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
} from "./constants.js";
import { PALETTE, RAW } from "./colors.js";
import { getSelectedPattern } from "../../model/query.js";
import * as events from "../../state/events.js";
import { copyCurrentCellToClipboard, pasteClipboardIntoCell } from "./selectCopyPaste.js";

const GRID_SIZE = 8;

function wrap(value, length) {
  return ((value % length) + length) % length;
}

// device/store/writeMode are all optional (every call below guarded) so this still constructs
// and behaves exactly as before for callers/tests that only care about the plain note-input
// side (test/pushNoteEntryMode.test.js's existing no-arg cases) — appContext.js is the one real
// caller, and always passes the live pushDevice/store/writeMode so Note Mode's pads actually
// light up (point 7 of the brief: a deliberate, centrally-configured base/pressed color scheme,
// PALETTE.NOTE_MODE_BASE/NOTE_MODE_PRESSED from colors.js) and write mode works.
export function createPushNoteEntryMode({ device, store, writeMode } = {}) {
  const source = createNoteInputSource();
  // Same "only send what changed" diff-cache discipline trackerGridMode.js already established
  // (docs/MIDI.md's "Lessons from real bugs" #3) — a full 64-pad onEnter() repaint and a
  // pressed/released pair both go through this.
  const lastPadColor = new Map(); // note number -> color
  // Notes currently physically held down — guards the write-mode cursor overlay's repaint
  // (below) from clobbering a pad's PRESSED color while the user is still holding it (see
  // restColorForPad's own doc comment).
  const pressedNotes = new Set();
  // Notes whose onPadOn was redirected into a Select-held paste pick (below) rather than note
  // entry — their matching onPadOff must be swallowed without emitting a noteOff (no noteOn was
  // ever emitted for them), but every *other* onPadOff keeps its original, pressedNotes-
  // independent behavior (test/pushNoteEntryMode.test.js's existing onPadOff-without-a-prior-
  // onPadOn cases rely on that).
  const pasteInterceptedNotes = new Set();
  // Select (CC48) copy/paste (docs/MIDI.md, "Extend Push Write Mode: Cell Copy and Paste") — a
  // momentary modifier, tracked the same way trackerGridMode.js's own shiftHeld is: selectHeld
  // is the button's raw physical state; pasteReady is only true once a press has actually
  // copied a valid cell (copyCurrentCellToClipboard's own return value), so a pad press while
  // held but without a valid source cell can't fall through to an unrelated stale clipboard
  // entry.
  let selectHeld = false;
  let pasteReady = false;
  let lastSelectFeedback = null;

  function sendPad(note, color) {
    if (lastPadColor.get(note) === color) return;
    lastPadColor.set(note, color);
    device?.send([0x90, note, color]);
  }

  function sendSelectFeedback(value) {
    if (lastSelectFeedback === value) return;
    lastSelectFeedback = value;
    device?.send([0xb0, CC_SELECT, value]);
  }

  // Select (CC48): lit while physically held, dim otherwise — same dim/full convention
  // trackerGridMode.js's own Shift/Duplicate/Select buttons already use. Gated on writeMode
  // being present at all (not just inactive): Select is purely a write-mode feature, and the
  // no-writeMode construction (test/pushNoteEntryMode.test.js's plain note-input contract
  // cases) should never see this button touched, exactly as it never did before this feature.
  function paintSelect() {
    if (!writeMode) return;
    sendSelectFeedback(selectHeld ? FEEDBACK_FULL : FEEDBACK_DIM);
  }

  // Note Mode's pad grid has no (track, row)-to-pad mapping other than cursorOverlayPad's own
  // (track=column, row=step-within-window mod 8, no window offset) — reused here, in reverse,
  // to turn a pad press during Select-held into a destination cell: same column -> track,
  // same wrap-mod-8 row convention, but keeping the cursor's current "block" of 8 rows (there's
  // no window/page position in Note Mode to otherwise decide which of the pattern's many
  // possible rows sharing that mod-8 remainder is meant) so the result moves predictably with
  // the pad actually pressed, the same way the cursor overlay itself already does.
  function destinationRowForPadRow(row, currentRowIndex, rowCount) {
    const stepWithinWindow = padRowForStep(row); // self-inverse formula
    const blockStart = Math.floor(currentRowIndex / GRID_SIZE) * GRID_SIZE;
    return wrap(blockStart + stepWithinWindow, rowCount);
  }

  // Mirrors trackerGridMode.js's own track=column, row=step-within-window convention exactly
  // (see that file's doc comment on the axis rotation) — the write-mode cursor must land on the
  // same physical pad position regardless of which Push view is currently showing it, so this
  // reuses that mapping rather than inventing a second one (the earlier version of this file
  // highlighted whichever pad matched the *note* already in the selected cell instead — wrong:
  // it didn't move predictably with CC44-47, since two cells rarely hold adjacent note values).
  // Note Mode has no paging/window offset of its own (the piano layout never scrolls the way
  // trackerGridMode.js's stepOffset does), so rowIndex wraps onto the 8-row grid every 8 rows
  // via a plain modulo instead of a tracked window position.
  function padRowForStep(stepWithinWindow) {
    return GRID_SIZE - 1 - stepWithinWindow;
  }

  // Returns null when write mode is off or there's no store to read a cursor from.
  function cursorOverlayPad() {
    if (!writeMode?.isActive() || !store) return null;
    const { cursor } = store.getState();
    return { row: padRowForStep(wrap(cursor.rowIndex, GRID_SIZE)), column: cursor.trackIndex };
  }

  // The color a pad should show when nothing is pressing it — PALETTE.SELECTED_CELL_CURSOR for
  // the one pad at cursorOverlayPad()'s position, NOTE_MODE_BASE for every other.
  function restColorForPad(note) {
    const overlay = cursorOverlayPad();
    return overlay && padNote(overlay.row, overlay.column) === note ? PALETTE.SELECTED_CELL_CURSOR : PALETTE.NOTE_MODE_BASE;
  }

  // Repaints every pad's *rest* color (skipping any pad currently held down, so a store event
  // firing mid-press — e.g. writePressedNote's own store.setCell calls below — can't overwrite
  // the PRESSED feedback the user is still looking at). Used by onEnter/refresh (nothing is held
  // at either of those points) and by the CURSOR_MOVED subscription below (the cursor overlay's
  // whole reason for existing — the selected cell just moved).
  function repaintRestColors() {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        const note = padNote(row, column);
        if (pressedNotes.has(note)) continue;
        sendPad(note, restColorForPad(note));
      }
    }
  }

  // Write mode's "writing a note" (docs/MIDI.md): the pad still maps to the exact note the
  // hardware itself assigned it (padNote — no separate note-writing data model, no scale
  // feature to apply, same as plain Note Mode above), it's just also committed straight into
  // the currently selected cell via store.setCell — the same mutator trackerGridMode.js's own
  // pad toggle and ui/chrome/NoteEditor.jsx already write through. Mirrors
  // input/editController.js#handleNoteOn's own note/instrument/velocity write + editStep
  // auto-advance, so a note entered from Push lands exactly where one typed from the keyboard
  // while editing would, keeping Push "consistent with the UI" per the brief.
  function writePressedNote(note, velocity) {
    if (!writeMode?.isActive() || !store) return;
    const { cursor, song, selectedInstrumentIndex, editStep } = store.getState();
    const pattern = getSelectedPattern(song);
    if (!pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex]) return;
    store.setCell(cursor.trackIndex, cursor.rowIndex, "note", note);
    store.setCell(cursor.trackIndex, cursor.rowIndex, "instrument", selectedInstrumentIndex);
    store.setCell(cursor.trackIndex, cursor.rowIndex, "velocity", velocity);
    if (editStep > 0) store.moveCursor({ row: editStep });
  }

  // Select held (docs/MIDI.md, "Cell Copy and Paste"): a pad press becomes a paste destination
  // pick instead of note entry — the exact same (track=column, row=wrap-mod-8) mapping the
  // cursor overlay above already paints, reused rather than a second convention, per the
  // brief. Never falls through to note entry below, even if pasteReady is false (no valid
  // source cell was under the cursor when Select was pressed): while held, the grid is
  // dedicated to this interaction only.
  function onPadOn(row, column, velocity) {
    const note = padNote(row, column);

    if (writeMode?.isActive() && selectHeld) {
      pasteInterceptedNotes.add(note);
      if (pasteReady) {
        const { cursor, song } = store.getState();
        const pattern = getSelectedPattern(song);
        if (pattern) {
          const destRow = destinationRowForPadRow(row, cursor.rowIndex, pattern.rowCount);
          pasteClipboardIntoCell(store, column, destRow, cursor.field);
        }
      }
      return;
    }

    pressedNotes.add(note);
    sendPad(note, PALETTE.NOTE_MODE_PRESSED);
    source.emitNoteOn({ note, velocity, channel: PUSH_CHANNEL });
    writePressedNote(note, velocity);
  }

  function onPadOff(row, column) {
    const note = padNote(row, column);
    if (pasteInterceptedNotes.delete(note)) return; // no matching noteOn was ever emitted for this pad
    pressedNotes.delete(note);
    // restColorForPad, not a hardcoded NOTE_MODE_BASE — releasing the exact pad the write-mode
    // cursor overlay is currently pointing at must land back on SELECTED_CELL_CURSOR, not amber.
    sendPad(note, restColorForPad(note));
    source.emitNoteOff({ note, channel: PUSH_CHANNEL });
  }

  // Write mode's own cursor navigation in Note Mode (docs/MIDI.md): CC44-47 move the selected
  // cell through the actual tracker coordinates (wrapping each axis independently), not just the
  // currently visible window — there is no "visible window" concept in Note Mode's pad grid at
  // all (it's a piano-style note layout, not a tracker grid view). Routed through
  // store.selectCell, the exact mutator mouse/TRACK_SELECT_CC selection already uses, rather
  // than store.moveCursor's delta.field (which also cycles field/wraps into neighboring tracks
  // as a side effect — not what a dedicated track axis move wants here). A no-op while write
  // mode is off, same as before this feature existed (CC44-47 were already unclaimed in Note
  // Mode — see constants.js's own doc comment on CC_ARROW_LEFT/RIGHT's dual use).
  // Select (CC48) needs its own release too, same reason trackerGridMode.js's Shift does — the
  // momentary copy/paste interaction (docs/MIDI.md) must end the instant the button is
  // physically released, not behave like a one-shot toggle. Handled before the blanket
  // value-0/write-mode guard below for exactly that reason.
  function onCC(cc, value) {
    if (cc === CC_SELECT) {
      if (!writeMode?.isActive() || !store) {
        selectHeld = false;
        pasteReady = false;
        return;
      }
      selectHeld = value > 0;
      pasteReady = selectHeld ? copyCurrentCellToClipboard(store) : false;
      paintSelect();
      return;
    }

    if (value === 0 || !writeMode?.isActive() || !store) return;
    const { cursor, song } = store.getState();

    if (cc === CC_ARROW_LEFT) return store.selectCell(wrap(cursor.trackIndex - 1, song.trackCount), cursor.rowIndex, cursor.field);
    if (cc === CC_ARROW_RIGHT) return store.selectCell(wrap(cursor.trackIndex + 1, song.trackCount), cursor.rowIndex, cursor.field);

    if (cc === CC_ARROW_UP || cc === CC_ARROW_DOWN) {
      const pattern = getSelectedPattern(song);
      if (!pattern) return;
      const direction = cc === CC_ARROW_UP ? -1 : 1;
      store.selectCell(cursor.trackIndex, wrap(cursor.rowIndex + direction, pattern.rowCount), cursor.field);
    }
  }

  // paint() is repaintRestColors() under another name — kept as its own exported function (the
  // rest of this file, and the tests, call it as "the full repaint") but there is only one
  // repaint path now, not two, so the write-mode cursor overlay is never a separate pass that
  // could drift out of sync with it.
  const paint = repaintRestColors;

  function darkenAll() {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        sendPad(padNote(row, column), RAW.OFF);
      }
    }
  }

  let unsubscribes = [];

  function onEnter() {
    lastPadColor.clear(); // another mode may have painted these same physical LEDs since we last ran
    selectHeld = false; // physical Select state is unknown at this point — assume not held, never carry a stale paste-ready state across a view switch
    pasteReady = false;
    lastSelectFeedback = null;
    paintSelect();
    paint();
    // The write-mode cursor overlay (restColorForPad above) is purely positional — it needs
    // repainting whenever the selected cell moves, same as trackerGridMode.js's own
    // CURSOR_MOVED subscription for its SELECTED_CELL_CURSOR highlight. A no-op list while
    // store isn't passed (the existing no-arg construction).
    if (store) {
      unsubscribes = [store.subscribe(events.CURSOR_MOVED, paint)];
    }
  }

  function onExit() {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribes = [];
    pressedNotes.clear();
    pasteInterceptedNotes.clear();
    selectHeld = false;
    pasteReady = false;
    paintSelect();
    darkenAll();
  }

  // Used by modeController.js#refresh() when Note Mode is the active content — same role as
  // trackerGridMode.js's own refresh(): reset the diff cache and repaint, without touching
  // anything subscription-related (onEnter() already owns those; refresh() never re-subscribes,
  // same "StrictMode-leak-safe" discipline documented in docs/MIDI.md's "Lessons from real
  // bugs" #2). This is also what runs the moment write mode toggles (appContext.js wires
  // pushWriteMode.onChange to pushModeController.refresh()), so the cursor overlay appears/
  // disappears immediately rather than waiting for the next cursor move.
  function refresh() {
    lastPadColor.clear();
    lastSelectFeedback = null;
    paintSelect();
    paint();
  }

  // No independent connection of its own to attach/detach (modeController.js's pad routing
  // drives it) — attach() is a no-op returning a no-op, only present so this satisfies
  // noteInputSource.js's full contract uniformly with every other noteSources entry in
  // appContext.js (App.jsx calls .attach() on all of them the same way).
  function attach() {
    return () => {};
  }

  return { ...source, onPadOn, onPadOff, onCC, onEnter, onExit, paint, refresh, attach };
}
