// Push "session.tracker" content — the tracker grid's own controller surface.
//
// Axis mapping (this project's own design choice, confirmed/corrected against real hardware
// use — not a ported fact): Push's pad *column* = webtrack track index (column 0, the
// leftmost, is track 0 — this lines up directly with the 8 encoders and the mute/track-select
// button rows above, all of which are column-addressed by nature), and Push's pad *row* = step
// *within the currently visible 8-step window*, flowing top-to-bottom as time advances (row 0,
// the top row, is the earliest step in the window). An earlier version of this file had tracks
// on the row axis and steps on columns — flipped after hands-on use showed it needs to be
// vertical, in line with the encoders, not horizontal.
//
// The track axis needs no paging — 8 Push columns, 8 webtrack tracks, exactly — but a pattern
// can be up to 128 steps (model/timing.js#MAX_BARS), so the step axis genuinely does:
// stepOffset is the one window position this module owns, paged 8 steps at a time by the
// Up/Down arrow buttons (steps flow vertically, so paging is vertical too — Up moves toward
// earlier steps, Down toward later ones, the same direction scrolling up/down a page of text
// would) — see the architecture doc's "Push mapping" section for why this is the one axis of
// windowing midi-core's own full 2D paging system would have been overkill for.
//
// Track selection uses TRACK_SELECT_CC (the row of 8 buttons directly below the LCD, one per
// column — not SELECT_CC, the side column, which doesn't line up with anything once tracks are
// columns rather than rows). The mute strip (MUTE_CC) was already column-addressed by its own
// physical layout, so it needs no change for the rotation. Both reuse store.js's existing
// mutators directly, no new model state.
//
// A pad press toggles a step on/off: empty -> a note at DEFAULT_NOTE/the selected instrument/
// the pad's own velocity; occupied -> cleared. Only the note/instrument/velocity fields are
// touched by a toggle-off, deliberately — never pan/length/fx, so a step a user carefully set
// up from the desktop UI never loses that data just because it got tapped off and back on from
// Push.
import { getSelectedPattern, isAnyTrackSoloed } from "../../model/query.js";
import {
  padNote,
  MUTE_CC,
  TRACK_SELECT_CC,
  CC_ARROW_UP,
  CC_ARROW_DOWN,
  CC_SHIFT,
  CC_DUPLICATE,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
} from "./constants.js";
import { PALETTE, RAW } from "./colors.js";
import * as events from "../../state/events.js";

const TRACK_COUNT = 8;
const STEP_WINDOW = 8;
const DEFAULT_NOTE = 60;
const PLAYHEAD_POLL_MS = 50;

// stepWithinWindow 0 (earliest/top) -> pad row 7 (physical top, since padNote's row is
// bottom-origin); stepWithinWindow 7 (latest/bottom) -> pad row 0 (physical bottom).
function padRowForStep(stepWithinWindow) {
  return STEP_WINDOW - 1 - stepWithinWindow;
}

function stepWithinWindowForPadRow(row) {
  return STEP_WINDOW - 1 - row;
}

export function createPushTrackerGridMode({ device, store, playbackController, writeMode }) {
  let stepOffset = 0;
  let unsubscribes = [];
  let playheadInterval = null;
  const lastPaintedPlayheadStep = new Array(TRACK_COUNT).fill(-1);
  // Write mode's grid range selection (docs/MIDI.md, "Extend Push Write Mode: Grid Selection
  // and Duplicate" brief). Both pieces of state here are Push-surface-local interpretation —
  // never a second selection representation (the brief's own explicit constraint): the
  // selection itself is always store.getSelectionRect(), the exact same rect the desktop UI's
  // shift+click/drag already produces.
  //   - shiftHeld: CC49's real, live press/release state — read at the moment a pad is pressed
  //     to decide whether this press should extend-select or plain-select, the same way a
  //     native keydown's e.shiftKey is read elsewhere in this app (input/editController.js).
  //   - pushOwnsSelection: true only while the *active* selection rect was created by a Push
  //     Shift+pad gesture (not, say, a desktop mouse drag) — a provenance flag, not a second
  //     copy of *what* is selected, used solely to decide whether leaving this view/write mode
  //     should collapse the rect (a Push-made selection) or leave it alone (the user's own
  //     independent desktop selection, which Push has no business clobbering).
  let shiftHeld = false;
  let pushOwnsSelection = false;
  let lastShiftFeedback = null;
  let lastDuplicateFeedback = null;

  // A paint pass (especially a full-window repaint from paging, or darkening everything on
  // exit) sends up to 64 pad + 16 control messages in one synchronous burst — real hardware
  // testing showed that volume isn't reliably delivered intact, leaving some LEDs stuck
  // showing stale state (both during paging and, worse, after leaving this mode entirely). The
  // fix is the same "write only on change" discipline syncPlayheadLeds already used for the
  // playhead: these three caches (null = "unknown, must send") track what was last actually
  // sent to each physical LED, and every send in this file goes through sendPad/sendMute/
  // sendTrackSelect below instead of calling device.send directly, so a repaint that doesn't
  // change anything sends nothing at all, and a real change always gets exactly one message.
  const lastPadColor = new Map(); // note number -> color
  const lastMuteColor = new Array(TRACK_COUNT).fill(null);
  const lastSelectColor = new Array(TRACK_COUNT).fill(null);

  function resetPaintCache() {
    lastPadColor.clear();
    lastMuteColor.fill(null);
    lastSelectColor.fill(null);
    lastShiftFeedback = null;
    lastDuplicateFeedback = null;
  }

  function sendPad(row, column, color) {
    const note = padNote(row, column);
    if (lastPadColor.get(note) === color) return;
    lastPadColor.set(note, color);
    device.send([0x90, note, color]);
  }

  function sendMute(trackIndex, color) {
    if (lastMuteColor[trackIndex] === color) return;
    lastMuteColor[trackIndex] = color;
    device.send([0xb0, MUTE_CC[trackIndex], color]);
  }

  function sendTrackSelect(trackIndex, color) {
    if (lastSelectColor[trackIndex] === color) return;
    lastSelectColor[trackIndex] = color;
    device.send([0xb0, TRACK_SELECT_CC[trackIndex], color]);
  }

  function sendShiftFeedback(value) {
    if (lastShiftFeedback === value) return;
    lastShiftFeedback = value;
    device.send([0xb0, CC_SHIFT, value]);
  }

  function sendDuplicateFeedback(value) {
    if (lastDuplicateFeedback === value) return;
    lastDuplicateFeedback = value;
    device.send([0xb0, CC_DUPLICATE, value]);
  }

  // True exactly when store.getSelectionRect() currently spans more than one cell — the same
  // "has a real range, not just the 1x1 cursor" check ui/chrome/SelectionToolbar.jsx's own
  // spansMultipleCells already makes, read fresh off the store rather than tracked separately.
  function hasRangeSelection() {
    const rect = store.getSelectionRect();
    return rect.trackEnd > rect.trackStart || rect.rowEnd > rect.rowStart;
  }

  // Shift (CC49): dim while not held, full while physically held — driven by the button's own
  // live press/release state (modeController.js now forwards CC releases to onCC for exactly
  // this), never a persistent toggle. Only meaningful while write mode is on; "normal
  // behaviour" (nothing lit) otherwise — see onCC's own guard.
  function paintShift() {
    sendShiftFeedback(shiftHeld ? FEEDBACK_FULL : FEEDBACK_DIM);
  }

  // Duplicate (CC88): lit while a valid (multi-cell) selection exists, dim otherwise — same
  // dim/full convention every other monochrome Push button here already uses.
  function paintDuplicate() {
    sendDuplicateFeedback(hasRangeSelection() ? FEEDBACK_FULL : FEEDBACK_DIM);
  }

  // Priority order (highest first): write mode's grid range selection, then its single-cell
  // cursor, then the playhead, then has-note/empty. A multi-cell range and the 1x1 cursor are
  // deliberately two distinct visual states (the brief's own explicit distinction) — every cell
  // within an active range shows PALETTE.GRID_SELECTION uniformly, and the single-cell cursor
  // color only applies once the rect has collapsed back to one cell. The cursor (and now the
  // range) wins over the playhead deliberately (docs/MIDI.md's own doc comment on
  // colors.js#PALETTE.SELECTED_CELL_CURSOR): while actively editing, knowing exactly which
  // cell(s) Push is about to act on matters more than briefly seeing the playhead pass through.
  function cellColor(trackIndex, stepIndex, isPlayhead) {
    const pattern = getSelectedPattern(store.getState().song);
    const event = pattern.tracks[trackIndex]?.events[stepIndex];
    const hasNote = event?.note != null;
    if (writeMode?.isActive()) {
      const rect = store.getSelectionRect();
      if (rect.trackEnd > rect.trackStart || rect.rowEnd > rect.rowStart) {
        if (trackIndex >= rect.trackStart && trackIndex <= rect.trackEnd && stepIndex >= rect.rowStart && stepIndex <= rect.rowEnd) {
          return PALETTE.GRID_SELECTION;
        }
      } else {
        const { cursor } = store.getState();
        if (cursor.trackIndex === trackIndex && cursor.rowIndex === stepIndex) return PALETTE.SELECTED_CELL_CURSOR;
      }
    }
    if (isPlayhead) return hasNote ? PALETTE.CELL_PLAYHEAD_HAS_NOTE : PALETTE.CELL_PLAYHEAD;
    return hasNote ? PALETTE.CELL_HAS_NOTE : PALETTE.CELL_EMPTY;
  }

  function paintCell(trackIndex, stepIndex) {
    const stepWithinWindow = stepIndex - stepOffset;
    if (stepWithinWindow < 0 || stepWithinWindow >= STEP_WINDOW) return; // outside the visible window
    const isPlayhead = playbackController.getTrackPlayheadRow(trackIndex) === stepIndex;
    sendPad(padRowForStep(stepWithinWindow), trackIndex, cellColor(trackIndex, stepIndex, isPlayhead));
  }

  function paintMuteStrip() {
    const { trackChannels } = store.getState().song;
    const soloActive = isAnyTrackSoloed(store.getState().song);
    trackChannels.forEach((channel, trackIndex) => {
      const audible = !channel.muted && (!soloActive || channel.solo);
      sendMute(trackIndex, audible ? PALETTE.TRACK_AUDIBLE : PALETTE.TRACK_MUTED);
    });
  }

  function paintTrackSelectButtons() {
    const { trackIndex } = store.getState().cursor;
    for (let i = 0; i < TRACK_COUNT; i++) {
      sendTrackSelect(i, i === trackIndex ? PALETTE.TRACK_SELECTED : PALETTE.TRACK_UNSELECTED);
    }
  }

  // Full repaint — grid pads for the current window, plus both control rows. Logically a full
  // pass (unlike the DOM grid's own surgically-patched patchCell — see ui/grid/gridView.js),
  // but every actual device.send() above is gated by the diff caches, so in practice this only
  // ever transmits what's actually different from what the device was last told.
  function paint() {
    const pattern = getSelectedPattern(store.getState().song);
    for (let trackIndex = 0; trackIndex < TRACK_COUNT; trackIndex++) {
      for (let stepWithinWindow = 0; stepWithinWindow < STEP_WINDOW; stepWithinWindow++) {
        const stepIndex = stepOffset + stepWithinWindow;
        if (stepIndex >= pattern.rowCount) {
          sendPad(padRowForStep(stepWithinWindow), trackIndex, RAW.OFF);
        } else {
          paintCell(trackIndex, stepIndex);
        }
      }
      lastPaintedPlayheadStep[trackIndex] = playbackController.getTrackPlayheadRow(trackIndex);
    }
    paintMuteStrip();
    paintTrackSelectButtons();
    // Shift/Duplicate are only ever meaningful while write mode is on (onCC's own guards already
    // ignore both buttons otherwise) — dim them here rather than reflecting live state, so a
    // repaint while write mode is off can't light Duplicate just because some leftover selection
    // rect happens to still span more than one cell.
    if (writeMode?.isActive()) {
      paintShift();
      paintDuplicate();
    } else {
      sendShiftFeedback(FEEDBACK_DIM);
      sendDuplicateFeedback(FEEDBACK_DIM);
    }
  }

  // The playhead is the one thing that moves without any store event firing for it (same
  // reason ui/grid/playheadLayer.js polls via rAF rather than subscribing to anything) — polled
  // on a plain interval here instead, since there's no per-frame LED redraw budget to protect
  // the way there is for DOM.
  function syncPlayheadLeds() {
    for (let trackIndex = 0; trackIndex < TRACK_COUNT; trackIndex++) {
      const row = playbackController.getTrackPlayheadRow(trackIndex);
      if (row === lastPaintedPlayheadStep[trackIndex]) continue;
      const previousRow = lastPaintedPlayheadStep[trackIndex];
      lastPaintedPlayheadStep[trackIndex] = row;
      paintCell(trackIndex, previousRow);
      paintCell(trackIndex, row);
    }
  }

  function darkenAll() {
    for (let trackIndex = 0; trackIndex < TRACK_COUNT; trackIndex++) {
      for (let row = 0; row < STEP_WINDOW; row++) {
        sendPad(row, trackIndex, RAW.OFF);
      }
      sendMute(trackIndex, RAW.OFF);
      sendTrackSelect(trackIndex, RAW.OFF);
    }
    sendShiftFeedback(FEEDBACK_DIM);
    sendDuplicateFeedback(FEEDBACK_DIM);
  }

  // Collapses the selection rect back onto the cursor's own single cell, unconditionally —
  // store.selectCell with its own current cursor position is a deliberate no-op move that
  // still collapses selectionAnchor onto it (state/store.js's own convention), the same effect
  // a plain, non-shift pad press already has in onPadOn below.
  function collapseSelectionToCursor() {
    const { cursor } = store.getState();
    store.selectCell(cursor.trackIndex, cursor.rowIndex, cursor.field);
  }

  // Dismisses the active range selection, but only if *this* module is the one that created it
  // (pushOwnsSelection) — never a selection the desktop UI's own mouse drag made independently
  // of Push. Used when leaving this view or when write mode turns off, where clobbering an
  // unrelated desktop-made selection the user is still relying on would be a real regression.
  function dismissPushOwnedSelectionIfAny() {
    if (!pushOwnsSelection) return;
    collapseSelectionToCursor();
    pushOwnsSelection = false;
  }

  // Write mode turning off while a Push-made range selection is still active must collapse it
  // immediately (docs/MIDI.md) — not wait for the next unrelated cursor move. Safe to call
  // unconditionally from onEnter()/refresh() (both also fire for unrelated reasons — a Push
  // reconnect, the Settings modal's manual refresh, re-entering this view) since
  // pushOwnsSelection can only be true in the first place if write mode was on when the
  // selection was made, so this is a no-op unless write mode has genuinely since turned off.
  function syncSelectionWithWriteMode() {
    if (!writeMode?.isActive()) dismissPushOwnedSelectionIfAny();
  }

  // Duplicate (CC88): reuses state/store.js#duplicateSelection — the same captureBlock/
  // tileBlockIntoRect primitives copySelection/fillSelection already use — rather than a second
  // copy/paste implementation. Acts on *any* current selection, not only a Push-made one (the
  // button's own LED already reflects whatever store.getSelectionRect() says, regardless of who
  // made it), and always restores the normal single-cell cursor state afterward, per the brief
  // — unlike dismissPushOwnedSelectionIfAny above, this isn't conditional on provenance. A no-op
  // without a real (multi-cell) selection, matching the LED's own dim state (nothing to
  // duplicate).
  function handleDuplicate() {
    if (!hasRangeSelection()) return;
    store.duplicateSelection();
    collapseSelectionToCursor();
    pushOwnsSelection = false;
  }

  function pageSteps(direction) {
    const pattern = getSelectedPattern(store.getState().song);
    const maxOffset = Math.max(0, pattern.rowCount - STEP_WINDOW);
    const nextOffset = Math.min(maxOffset, Math.max(0, stepOffset + direction * STEP_WINDOW));
    if (nextOffset === stepOffset) return;
    stepOffset = nextOffset;
    paint();
  }

  // (row, column) here are already decoded by modeController.js from the pad's own note number
  // — column is the track (the axis mapping above), row needs converting back to a step within
  // the current window (the inverse of paintCell's padRowForStep).
  function onPadOn(row, column, velocity) {
    const trackIndex = column;
    const stepIndex = stepOffset + stepWithinWindowForPadRow(row);
    const pattern = getSelectedPattern(store.getState().song);
    if (stepIndex >= pattern.rowCount) return;

    // Write mode: the 8x8 grid becomes the cell-selection interface (docs/MIDI.md) — a pad
    // press selects that tracker cell (store.selectCell, the same mutator mouse-click/
    // TRACK_SELECT_CC selection already use) instead of toggling a step on/off. Loading the
    // cell's properties onto the displays/encoders and lighting the cursor color both follow
    // automatically from the CURSOR_MOVED this emits — encoderController.js's cellEdit mode and
    // this file's own cellColor() each already subscribe to it, no separate "load into Push"
    // step needed here.
    //
    // Shift held (docs/MIDI.md, "Grid Selection and Duplicate"): instead of selecting a single
    // cell, extend a range from the tracker's own absolute first cell (track 0, row 0) through
    // this pad — store.selectCell(0, 0, ...) then store.extendSelectionTo(trackIndex, stepIndex)
    // is the *exact* rect-building pair the desktop UI's own shift+click/drag already produces
    // (state/store.js's own doc comments), never a second selection representation. Every
    // further Shift+pad press repeats this same pair from scratch — replacing, not extending,
    // the previous range, per the brief.
    if (writeMode?.isActive()) {
      const { field } = store.getState().cursor;
      if (shiftHeld) {
        store.selectCell(0, 0, field);
        store.extendSelectionTo(trackIndex, stepIndex);
        pushOwnsSelection = true;
      } else {
        store.selectCell(trackIndex, stepIndex, field); // collapses any existing range, Push-made or not
        pushOwnsSelection = false;
      }
      return;
    }

    const event = pattern.tracks[trackIndex]?.events[stepIndex];
    if (!event) return;

    if (event.note == null) {
      const { selectedInstrumentIndex } = store.getState();
      store.setCell(trackIndex, stepIndex, "note", DEFAULT_NOTE);
      store.setCell(trackIndex, stepIndex, "instrument", selectedInstrumentIndex);
      store.setCell(trackIndex, stepIndex, "velocity", velocity);
    } else {
      store.setCell(trackIndex, stepIndex, "note", null);
      store.setCell(trackIndex, stepIndex, "instrument", null);
      store.setCell(trackIndex, stepIndex, "velocity", null);
    }
  }

  function onCC(cc, value) {
    // Shift (CC49) needs its own release (value 0), unlike every other CC this function
    // handles, to track the button's real held/not-held state rather than behaving like a
    // one-shot toggle — so this branch runs before the blanket release guard below
    // (modeController.js now forwards CC releases to onCC for exactly this reason). Only
    // meaningful while write mode is on; "normal behaviour" (do nothing) otherwise, per the
    // brief.
    if (cc === CC_SHIFT) {
      if (!writeMode?.isActive()) return;
      shiftHeld = value > 0;
      paintShift();
      return;
    }

    if (value === 0) return; // ignore releases, same convention modeController.js uses

    if (cc === CC_DUPLICATE) {
      if (writeMode?.isActive()) handleDuplicate();
      return;
    }

    const muteIndex = MUTE_CC.indexOf(cc);
    if (muteIndex !== -1) {
      const { muted } = store.getState().song.trackChannels[muteIndex];
      store.setTrackChannelMuted(muteIndex, !muted);
      return;
    }

    const selectIndex = TRACK_SELECT_CC.indexOf(cc);
    if (selectIndex !== -1) {
      const { cursor } = store.getState();
      store.selectCell(selectIndex, cursor.rowIndex, cursor.field);
      return;
    }

    if (cc === CC_ARROW_UP) return pageSteps(-1);
    if (cc === CC_ARROW_DOWN) return pageSteps(1);
  }

  function onEnter() {
    resetPaintCache(); // anything another mode painted onto these same physical LEDs since we last ran is now unknown
    shiftHeld = false; // physical Shift state is unknown at this point — assume not held
    syncSelectionWithWriteMode(); // no stale Push-made selection if write mode is already off (docs/MIDI.md)
    unsubscribes = [
      store.subscribe(events.CELL_CHANGED, paint),
      store.subscribe(events.PATTERN_SELECTED, paint),
      store.subscribe(events.PATTERN_LENGTH_CHANGED, paint),
      store.subscribe(events.TRACK_CHANNEL_CHANGED, paint),
      store.subscribe(events.CURSOR_MOVED, paint),
    ];
    playheadInterval = setInterval(syncPlayheadLeds, PLAYHEAD_POLL_MS);
  }

  function onExit() {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribes = [];
    clearInterval(playheadInterval);
    playheadInterval = null;
    shiftHeld = false;
    // Leaving this view always dismisses a Push-made range selection (docs/MIDI.md) — regardless
    // of write mode's own state at this moment, unlike syncSelectionWithWriteMode's own guard.
    dismissPushOwnedSelectionIfAny();
    darkenAll();
  }

  // Used by modeController.js#refresh() (a Push reconnect, or the Settings modal's manual
  // refresh button, and now also appContext.js's pushWriteMode.onChange wiring — see
  // syncSelectionWithWriteMode's own doc comment) when this is the active content — resets the
  // diff caches (so a stale cache from before a reconnect can't suppress a send the device
  // actually needs) and repaints, but deliberately doesn't touch the store subscriptions
  // onEnter() owns.
  function refresh() {
    syncSelectionWithWriteMode();
    resetPaintCache();
    paint();
  }

  return { onEnter, onExit, onPadOn, onCC, paint, refresh };
}
