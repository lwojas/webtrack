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
import { padNote, PUSH_CHANNEL } from "./constants.js";

export function createPushNoteEntryMode() {
  const source = createNoteInputSource();

  function onPadOn(row, column, velocity) {
    source.emitNoteOn({ note: padNote(row, column), velocity, channel: PUSH_CHANNEL });
  }

  function onPadOff(row, column) {
    source.emitNoteOff({ note: padNote(row, column), channel: PUSH_CHANNEL });
  }

  // No independent connection of its own to attach/detach (modeController.js's pad routing
  // drives it) — attach() is a no-op returning a no-op, only present so this satisfies
  // noteInputSource.js's full contract uniformly with every other noteSources entry in
  // appContext.js (App.jsx calls .attach() on all of them the same way).
  function attach() {
    return () => {};
  }

  return { ...source, onPadOn, onPadOff, attach };
}
