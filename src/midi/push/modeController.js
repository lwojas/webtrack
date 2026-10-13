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
// { onEnter, onExit, onPadOn(row, column, velocity), onPadOff(row, column), paint } (all
// optional, called only if present). Deliberately this small and flat rather than a generic
// device-mode framework: there are exactly three content providers this project has any use
// for (tracker grid, a pattern-view stub, note entry) — see docs/ARCHITECTURE.md's own
// precedent (Gotcha #5) for why speculative generality isn't worth it here either.
import { CC_MODE_NOTE, CC_MODE_SESSION, CC_MODE_TRACK, CC_MODE_CLIP, PUSH_CHANNEL, padCoordinates } from "./constants.js";
import { PALETTE } from "./colors.js";

const STATUS_CC = 0xb0 | PUSH_CHANNEL;
const STATUS_NOTE_ON = 0x90 | PUSH_CHANNEL;
const STATUS_NOTE_OFF = 0x80 | PUSH_CHANNEL;

function messageType(status) {
  return status & 0xf0;
}

export function createPushModeController({ device, gridContent = {} }) {
  let pushMode = "session"; // "note" | "session"
  let sessionView = "tracker"; // "tracker" | "pattern"

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
  // doc).
  function paintModeButtons() {
    sendCC(CC_MODE_NOTE, pushMode === "note" ? PALETTE.MODE_BUTTON_ACTIVE : PALETTE.MODE_BUTTON_INACTIVE);
    sendCC(CC_MODE_SESSION, pushMode === "session" ? PALETTE.MODE_BUTTON_ACTIVE : PALETTE.MODE_BUTTON_INACTIVE);
    sendCC(CC_MODE_TRACK, sessionView === "tracker" ? PALETTE.MODE_BUTTON_ACTIVE : PALETTE.MODE_BUTTON_INACTIVE);
    sendCC(CC_MODE_CLIP, sessionView === "pattern" ? PALETTE.MODE_BUTTON_ACTIVE : PALETTE.MODE_BUTTON_INACTIVE);
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
      return; // some other CC — not this controller's job (encoders, mute strip, ...)
    }

    if (messageType(status) === STATUS_NOTE_ON || messageType(status) === STATUS_NOTE_OFF) {
      handlePadMessage(status, data1, data2);
    }
  }

  function attach() {
    const unsubscribe = device.onMessage(handleMessage);
    paintModeButtons();
    gridContent[activeKey()]?.onEnter?.();
    gridContent[activeKey()]?.paint?.();
    return unsubscribe;
  }

  function getState() {
    return { pushMode, sessionView };
  }

  return { attach, getState };
}
