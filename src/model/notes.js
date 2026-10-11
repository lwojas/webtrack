// Numeric MIDI-style note numbers are the model's canonical representation (event.note) —
// see event.js. Converting to/from a display string like "C-4" happens only here, so a
// future midiInputSource.js never needs a translation layer the keyboard source doesn't have.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAME_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Standard MIDI convention: note 60 = C4.
export function noteNumberToName(note) {
  if (note === null || note === undefined) return "---";
  const name = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  // Tracker convention: naturals get a dash filler ("C-4"), sharps don't ("C#4") — keeps
  // every note name exactly 3 characters wide for the monospaced grid.
  return name.length === 1 ? `${name}-${octave}` : `${name}${octave}`;
}

const NOTE_NAME_PATTERN = /^([A-Ga-g])(#?-?)(-?\d+)$/;

export function parseNoteName(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "---") return null;
  const match = NOTE_NAME_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, letter, accidental, octaveText] = match;
  const base = NOTE_NAME_TO_SEMITONE[letter.toUpperCase()];
  if (base === undefined) return null;
  const semitone = accidental.includes("#") ? base + 1 : base;
  const octave = Number.parseInt(octaveText, 10);
  if (Number.isNaN(octave)) return null;
  return (octave + 1) * 12 + semitone;
}

export function toHex(value, digits = 2) {
  if (value === null || value === undefined) return "-".repeat(digits);
  return value.toString(16).toUpperCase().padStart(digits, "0");
}
