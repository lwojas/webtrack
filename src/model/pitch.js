// Equal-temperament pitch maths, independent of webdsp. Note numbers are the model's MIDI-style
// numbers (model/notes.js — 60 = C-4, 69 = A-4 = 440 Hz); note *names* live in notes.js
// (noteNumberToName) and are not duplicated here. The UI/application layer works in note
// numbers and semitones; webdsp's synth params stay in Hz, so this is the one conversion point.
export const A4_NOTE = 69;
export const A4_HZ = 440;

export function noteToFrequency(note) {
  return A4_HZ * 2 ** ((note - A4_NOTE) / 12);
}

// Fractional result: 55 Hz -> 33, 185 Hz -> ~54.6. Callers round for display.
export function frequencyToNote(hz) {
  return A4_NOTE + 12 * Math.log2(hz / A4_HZ);
}

export function semitonesToRatio(semitones) {
  return 2 ** (semitones / 12);
}
