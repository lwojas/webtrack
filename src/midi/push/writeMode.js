// Push "write mode" (CC86, the Record button) — a cross-cutting toggle, independent of
// modeController.js's pushMode/sessionView state machine, that turns Push into a hardware
// editor for the tracker's currently selected cell (state/store.js's own cursor — the exact
// same "selected cell" concept the grid/NoteEditor.jsx already share; this never introduces a
// second one). Attached independently of modeController's grid-mode dispatch — its own
// device.onMessage subscription, the same shape transportController.js/encoderController.js
// already use — since Record is meaningful regardless of which grid content Push currently shows,
// and must stay active across a Note <-> Session/Grid switch (see docs/MIDI.md).
//
// Record is a monochrome dim/full/blink button (constants.js's FEEDBACK_* family, not a
// RAW/PALETTE color — see colors.js's own doc comment on the bug that comes from mixing the two
// up): dim while write mode is off, full+blink while on. The hardware blinks on its own once
// sent FEEDBACK_FULL_BLINK — no JS timer needed here, unlike a software-driven blink.
//
// This module only owns the boolean and the button's own feedback. It never reaches into
// noteEntryMode.js/trackerGridMode.js (which just pull isActive() themselves, lazily, from
// inside their own pad/CC handlers) or encoderController.js/modeController.js directly — the
// onChange subscription below is how appContext.js wires "write mode just toggled" to "the
// encoder/LCD surface should switch to representing the selected cell, and the active grid
// content should repaint its cursor highlight," the same onConnectionChange-style composition-
// root wiring pushDevice.js already established for Push reconnects.
import { CC_RECORD, PUSH_CHANNEL, FEEDBACK_DIM, FEEDBACK_FULL_BLINK } from "./constants.js";

const STATUS_CC = 0xb0 | PUSH_CHANNEL;

export function createPushWriteMode({ device }) {
  let active = false;
  let lastFeedback = null;
  const listeners = new Set();

  function sendFeedback() {
    const value = active ? FEEDBACK_FULL_BLINK : FEEDBACK_DIM;
    if (lastFeedback === value) return;
    lastFeedback = value;
    device.send([STATUS_CC, CC_RECORD, value]);
  }

  function isActive() {
    return active;
  }

  function setActive(next) {
    if (active === next) return;
    active = next;
    sendFeedback();
    listeners.forEach((fn) => fn(active));
  }

  // appContext.js's one subscriber: flips encoderController's cellEdit display and forces the
  // currently active grid content to repaint (so a cursor highlight/dehighlight in Session/Grid
  // view shows up the instant Record is pressed, not on the next unrelated cursor move).
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function handleMessage(bytes) {
    const [status, data1, data2] = bytes;
    if ((status & 0xf0) !== STATUS_CC || data1 !== CC_RECORD || data2 === 0) return;
    setActive(!active);
  }

  function attach() {
    const unsubscribe = device.onMessage(handleMessage);
    lastFeedback = null;
    sendFeedback();
    return () => {
      unsubscribe();
      device.send([STATUS_CC, CC_RECORD, FEEDBACK_DIM]);
    };
  }

  // Used by appContext.js's refreshPushState() (a Push reconnect, or the Settings modal's
  // manual refresh button) — resets the feedback diff cache and repaints from the current
  // active flag, without re-notifying onChange listeners (nothing about write mode's own state
  // changed, just the LED needs resending).
  function refresh() {
    lastFeedback = null;
    sendFeedback();
  }

  return { attach, isActive, onChange, refresh };
}
