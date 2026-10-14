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
import { PALETTE, RAW } from "./colors.js";

const GRID_SIZE = 8;

// device is optional (default undefined, every call below guarded with `device?.`) so this
// still constructs and behaves exactly as before for callers/tests that only care about the
// note-input side (test/pushNoteEntryMode.test.js's existing no-arg cases) — appContext.js is
// the one real caller, and always passes the live pushDevice so Note Mode's pads actually light
// up (point 7 of the brief: a deliberate, centrally-configured base/pressed color scheme,
// PALETTE.NOTE_MODE_BASE/NOTE_MODE_PRESSED from colors.js).
export function createPushNoteEntryMode({ device } = {}) {
  const source = createNoteInputSource();
  // Same "only send what changed" diff-cache discipline trackerGridMode.js already established
  // (docs/MIDI.md's "Lessons from real bugs" #3) — a full 64-pad onEnter() repaint and a
  // pressed/released pair both go through this.
  const lastPadColor = new Map(); // note number -> color

  function sendPad(note, color) {
    if (lastPadColor.get(note) === color) return;
    lastPadColor.set(note, color);
    device?.send([0x90, note, color]);
  }

  function onPadOn(row, column, velocity) {
    const note = padNote(row, column);
    sendPad(note, PALETTE.NOTE_MODE_PRESSED);
    source.emitNoteOn({ note, velocity, channel: PUSH_CHANNEL });
  }

  function onPadOff(row, column) {
    const note = padNote(row, column);
    sendPad(note, PALETTE.NOTE_MODE_BASE);
    source.emitNoteOff({ note, channel: PUSH_CHANNEL });
  }

  function paint() {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        sendPad(padNote(row, column), PALETTE.NOTE_MODE_BASE);
      }
    }
  }

  function darkenAll() {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        sendPad(padNote(row, column), RAW.OFF);
      }
    }
  }

  function onEnter() {
    lastPadColor.clear(); // another mode may have painted these same physical LEDs since we last ran
    paint();
  }

  function onExit() {
    darkenAll();
  }

  // Used by modeController.js#refresh() when Note Mode is the active content — same role as
  // trackerGridMode.js's own refresh(): reset the diff cache and repaint, without touching
  // anything subscription-related (there are none here to leak).
  function refresh() {
    lastPadColor.clear();
    paint();
  }

  // No independent connection of its own to attach/detach (modeController.js's pad routing
  // drives it) — attach() is a no-op returning a no-op, only present so this satisfies
  // noteInputSource.js's full contract uniformly with every other noteSources entry in
  // appContext.js (App.jsx calls .attach() on all of them the same way).
  function attach() {
    return () => {};
  }

  return { ...source, onPadOn, onPadOff, onEnter, onExit, paint, refresh, attach };
}
