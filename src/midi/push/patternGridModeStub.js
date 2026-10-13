// Placeholder content for "session.pattern" (the CC113 "Clip" button) — Pattern view itself
// isn't designed yet (see the architecture doc). This exists only so the mode state machine
// has somewhere real to switch to, rather than leaving a dangling reference: all 64 pads go
// dark, every pad press is a no-op, nothing else happens. Replacing this file's contents is
// the entire job of actually building Pattern view later.
import { padNote } from "./constants.js";
import { RAW } from "./colors.js";

export function createPatternGridModeStub({ device }) {
  function onEnter() {
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        device.send([0x90, padNote(row, column), RAW.OFF]);
      }
    }
  }

  return { onEnter, onPadOn() {}, onPadOff() {} };
}
