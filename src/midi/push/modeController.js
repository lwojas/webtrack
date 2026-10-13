// Push mode state machine — CC50/CC51 (Note/Session) and CC112/CC113 (Track/Clip). This
// project's own assignment of these four physical buttons (see the architecture doc's "Push
// mode state machine" section), not ported behavior.
//
// Two independent pieces of state: pushMode ("note" | "session" — what the 8x8 grid currently
// shows) and sessionView ("tracker" | "pattern" — which content "session" shows). Pressing
// Track or Clip sets sessionView *and* switches into session mode directly, so you land on the
// grid immediately rather than needing a separate Session press afterward.
//
// gridContent is a small dispatch table, keyed "note" or "session.<view>" — each entry is
// { onEnter, onExit, onPadOn(row, column, velocity), onPadOff(row, column), onCC(cc, value),
// paint } (all optional, called only if present). Deliberately this small and flat rather than
// a generic device-mode framework: there are exactly three content providers this project has
// any use for (tracker grid, a pattern-view stub, note entry) — see docs/ARCHITECTURE.md's own
// precedent (Gotcha #5) for why speculative generality isn't worth it here either. onCC is the
// catch-all for any control this file doesn't itself claim (mute strip, select buttons,
// arrows, encoders) — only trackerGridMode currently uses it.
import {
  CC_MODE_NOTE,
  CC_MODE_SESSION,
  CC_MODE_TRACK,
  CC_MODE_CLIP,
  PUSH_CHANNEL,
  padCoordinates,
  FEEDBACK_OFF,
  FEEDBACK_FULL,
} from "./constants.js";

const STATUS_CC = 0xb0 | PUSH_CHANNEL;
const STATUS_NOTE_ON = 0x90 | PUSH_CHANNEL;
const STATUS_NOTE_OFF = 0x80 | PUSH_CHANNEL;

function messageType(status) {
  return status & 0xf0;
}

export function createPushModeController({ device, gridContent = {} }) {
  let pushMode = "session"; // "note" | "session"
  let sessionView = "tracker"; // "tracker" | "pattern"
  // Same "only send what changed" discipline trackerGridMode.js uses for its own (much larger)
  // repaints — smaller stakes here (4 messages, not 64-80) but a redundant repaint still
  // happens on every switchTo() call, including a same-key one (e.g. pressing Track while
  // already in session.tracker), which this now correctly skips entirely.
  let lastPaintedModeState = null;

  function activeKey() {
    return pushMode === "note" ? "note" : `session.${sessionView}`;
  }

  function activeContent() {
    return gridContent[activeKey()];
  }

  function sendCC(cc, value) {
    device.send([STATUS_CC, cc, value]);
  }

  // Note/Session light up mutually exclusively per pushMode; Track/Clip light up mutually
  // exclusively per sessionView regardless of whether pushMode is currently "note" — so the
  // device always shows what you'll land on next time you press Session (see the architecture
  // doc). These four are monochrome dim/full-feedback buttons, not velocity-color-led (see
  // colors.js's own doc comment on the bug that came from mixing the two up) — FEEDBACK_FULL/
  // FEEDBACK_OFF from constants.js, never a RAW/PALETTE color.
  function paintModeButtons() {
    if (lastPaintedModeState?.pushMode === pushMode && lastPaintedModeState?.sessionView === sessionView) return;
    lastPaintedModeState = { pushMode, sessionView };
    sendCC(CC_MODE_NOTE, pushMode === "note" ? FEEDBACK_FULL : FEEDBACK_OFF);
    sendCC(CC_MODE_SESSION, pushMode === "session" ? FEEDBACK_FULL : FEEDBACK_OFF);
    sendCC(CC_MODE_TRACK, sessionView === "tracker" ? FEEDBACK_FULL : FEEDBACK_OFF);
    sendCC(CC_MODE_CLIP, sessionView === "pattern" ? FEEDBACK_FULL : FEEDBACK_OFF);
  }

  function switchTo(nextMode, nextSessionView) {
    const previousKey = activeKey();
    pushMode = nextMode;
    if (nextSessionView) sessionView = nextSessionView;
    const nextKey = activeKey();

    if (nextKey !== previousKey) {
      gridContent[previousKey]?.onExit?.();
      gridContent[nextKey]?.onEnter?.();
      gridContent[nextKey]?.paint?.();
    }
    paintModeButtons();
  }

  function handlePadMessage(status, note, velocity) {
    const coords = padCoordinates(note);
    if (!coords) return;
    if (messageType(status) === STATUS_NOTE_ON && velocity > 0) {
      activeContent()?.onPadOn?.(coords.row, coords.column, velocity);
    } else if (messageType(status) === STATUS_NOTE_OFF || (messageType(status) === STATUS_NOTE_ON && velocity === 0)) {
      activeContent()?.onPadOff?.(coords.row, coords.column);
    }
  }

  function handleMessage(bytes) {
    const [status, data1, data2] = bytes;

    if (messageType(status) === STATUS_CC && data2 > 0) {
      if (data1 === CC_MODE_NOTE) return switchTo("note");
      if (data1 === CC_MODE_SESSION) return switchTo("session");
      if (data1 === CC_MODE_TRACK) return switchTo("session", "tracker");
      if (data1 === CC_MODE_CLIP) return switchTo("session", "pattern");
      activeContent()?.onCC?.(data1, data2);
      return;
    }

    if (messageType(status) === STATUS_NOTE_ON || messageType(status) === STATUS_NOTE_OFF) {
      handlePadMessage(status, data1, data2);
    }
  }

  // The returned cleanup must undo everything attach() just did, not just the device message
  // subscription — React's StrictMode double-invokes effects once in dev (mount, cleanup,
  // mount again; see docs/ARCHITECTURE.md's Gotcha #6), so an incomplete cleanup here doesn't
  // just leak harmlessly: the first mount's onEnter() (e.g. trackerGridMode.js's
  // setInterval-driven playhead sync) keeps running forever, orphaned, because the second
  // mount's onEnter() overwrites the only reference that could have canceled it. Calling
  // onExit() here is what actually stops it.
  function attach() {
    const unsubscribe = device.onMessage(handleMessage);
    paintModeButtons();
    gridContent[activeKey()]?.onEnter?.();
    gridContent[activeKey()]?.paint?.();
    return () => {
      unsubscribe();
      gridContent[activeKey()]?.onExit?.();
    };
  }

  function getState() {
    return { pushMode, sessionView };
  }

  return { attach, getState };
}
