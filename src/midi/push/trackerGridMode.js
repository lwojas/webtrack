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
import { padNote, MUTE_CC, TRACK_SELECT_CC, CC_ARROW_UP, CC_ARROW_DOWN } from "./constants.js";
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

export function createPushTrackerGridMode({ device, store, playbackController }) {
  let stepOffset = 0;
  let unsubscribes = [];
  let playheadInterval = null;
  const lastPaintedPlayheadStep = new Array(TRACK_COUNT).fill(-1);

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

  function cellColor(trackIndex, stepIndex, isPlayhead) {
    const pattern = getSelectedPattern(store.getState().song);
    const event = pattern.tracks[trackIndex]?.events[stepIndex];
    const hasNote = event?.note != null;
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
    if (value === 0) return; // ignore releases, same convention modeController.js uses

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
    darkenAll();
  }

  // Used by modeController.js#refresh() (a Push reconnect, or the Settings modal's manual
  // refresh button) when this is the active content — resets the diff caches (so a stale cache
  // from before a reconnect can't suppress a send the device actually needs) and repaints, but
  // deliberately doesn't touch the store subscriptions onEnter() owns.
  function refresh() {
    resetPaintCache();
    paint();
  }

  return { onEnter, onExit, onPadOn, onCC, paint, refresh };
}
