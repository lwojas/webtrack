import { createNoteInputSource } from "./noteInputSource.js";
import { isTypingTarget } from "./isTypingTarget.js";

// Standard tracker piano-key layout: two interleaved rows mimicking a piano's black/white
// keys on a QWERTY keyboard (same physical mapping the concepts/ mockup uses). Row 1 (z..) is
// the current octave; row 2 (q..) is one octave up.
const ROW_1 = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11 };
const ROW_2 = { q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23 };
const KEY_TO_SEMITONE_OFFSET = { ...ROW_1, ...ROW_2 };

// Implements noteInputSource.js's contract for the computer keyboard. Always active once
// attached — audition (audio/preview.js) listens regardless of which grid column has focus;
// editController.js is what decides whether a note-on also writes into the model.
export function createKeyboardNoteSource({ getOctave } = {}) {
  const source = createNoteInputSource();
  const activeKeys = new Map(); // physical key -> note number, so keyup releases the right note

  function handleKeyDown(e) {
    if (e.repeat) return;
    // A held Ctrl/Cmd/Alt means the browser or editController.js's own shortcuts (copy/paste,
    // etc.) own this keystroke, not note entry — e.key stays the bare letter either way (e.g.
    // Ctrl+C still reports "c"), so without this guard a copy shortcut would also sound/write
    // a note.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Typing an ordinary word into the project name (or any other field) must stay silent —
    // several of its letters (c, v, z, b, ...) are piano keys (see isTypingTarget.js).
    if (isTypingTarget(e)) return;
    const key = e.key.toLowerCase();
    const offset = KEY_TO_SEMITONE_OFFSET[key];
    if (offset === undefined || activeKeys.has(key)) return;
    const octave = getOctave ? getOctave() : 4;
    const note = (octave + 1) * 12 + offset;
    activeKeys.set(key, note);
    source.emitNoteOn({ note, velocity: 127 });
  }

  function handleKeyUp(e) {
    const key = e.key.toLowerCase();
    const note = activeKeys.get(key);
    if (note === undefined) return;
    activeKeys.delete(key);
    source.emitNoteOff({ note });
  }

  function attach(target = window) {
    target.addEventListener("keydown", handleKeyDown);
    target.addEventListener("keyup", handleKeyUp);
    return () => {
      target.removeEventListener("keydown", handleKeyDown);
      target.removeEventListener("keyup", handleKeyUp);
    };
  }

  return { ...source, attach };
}
