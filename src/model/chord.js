// Chords. A chord is a modifier on an ordinary event, like ratchet or tie: `event.note` is the chord's
// ROOT and `event.chord` says what is stacked on it. Nothing stores the notes it sounds as, so the
// grid, copy/paste, fill and the one-event-per-row model keep working unchanged; the tones are
// worked out only when needed (audio/compile.js expands the event into one trigger per tone, the
// chord editor shows them). A port of the idea of webseq3's model/chord.ts, adapted to a cell that
// already carries its own root note.
//
//   chord = { type, inversion?, spread?, offsets? }
//     type       a CHORD_TYPES id (fixed interval table), a diatonic type ("dia3"/"dia4"/"dia5": every second
//                note of the project scale, so the quality follows the key) or "custom" (explicit `offsets`).
//     inversion  0 = root position; n moves the n lowest tones up an octave, one at a time.
//     spread     how the tones are laid out (CHORD_SPREADS): close, open, drop 2, wide.
//     offsets    "custom" only: semitones above the root, ascending, the first being the lowest tone.
//
// A synth instrument is one monophonic machine, so each tone of a synth chord sounds on its own engine
// instance (audio/instrument.js keeps up to MAX_CHORD_VOICES per slot). Samples and MIDI output need
// no such thing. Chop slots never expand: a chop note is a slice, a chord has no meaning there.
import { getNotesInRange, isChromatic, getNearestScaleNote, scaleOf } from "./scale.js";
import { MAX_NOTE } from "./chop.js";

/** Most tones one chord may have: the engine instances one synth slot can need. */
export const MAX_CHORD_VOICES = 5;

export const CHORD_TYPES = [
  { id: "maj", label: "Major", intervals: [0, 4, 7] },
  { id: "min", label: "Minor", intervals: [0, 3, 7] },
  { id: "dim", label: "Diminished", intervals: [0, 3, 6] },
  { id: "aug", label: "Augmented", intervals: [0, 4, 8] },
  { id: "sus2", label: "Sus2", intervals: [0, 2, 7] },
  { id: "sus4", label: "Sus4", intervals: [0, 5, 7] },
  { id: "6", label: "6", intervals: [0, 4, 7, 9] },
  { id: "m6", label: "Minor 6", intervals: [0, 3, 7, 9] },
  { id: "69", label: "6/9", intervals: [0, 4, 7, 9, 14] },
  { id: "maj7", label: "Major 7", intervals: [0, 4, 7, 11] },
  { id: "m7", label: "Minor 7", intervals: [0, 3, 7, 10] },
  { id: "7", label: "Dominant 7", intervals: [0, 4, 7, 10] },
  { id: "dim7", label: "Diminished 7", intervals: [0, 3, 6, 9] },
  { id: "m7b5", label: "Half-dim 7", intervals: [0, 3, 6, 10] },
  { id: "maj9", label: "Major 9", intervals: [0, 4, 7, 11, 14] },
  { id: "m9", label: "Minor 9", intervals: [0, 3, 7, 10, 14] },
  { id: "9", label: "Dominant 9", intervals: [0, 4, 7, 10, 14] },
  { id: "11", label: "11", intervals: [0, 7, 10, 14, 17] },
  { id: "m11", label: "Minor 11", intervals: [0, 3, 10, 14, 17] },
  { id: "13", label: "13", intervals: [0, 4, 10, 14, 21] },
];

// Chords built from the project scale: `degrees` are scale steps above the root (every second note).
export const DIATONIC_TYPES = [
  { id: "dia3", label: "Scale triad", degrees: [0, 2, 4] },
  { id: "dia4", label: "Scale 7th", degrees: [0, 2, 4, 6] },
  { id: "dia5", label: "Scale 9th", degrees: [0, 2, 4, 6, 8] },
];

export const CUSTOM_TYPE = "custom";

export const CHORD_SPREADS = [
  { id: "close", label: "Close" },
  { id: "open", label: "Open" },
  { id: "drop2", label: "Drop 2" },
  { id: "wide", label: "Wide" },
];

const SPREAD_IDS = CHORD_SPREADS.map((s) => s.id);
const MAX_OFFSET = 36;

const typeOf = (id) => CHORD_TYPES.find((t) => t.id === id);
const diatonicOf = (id) => DIATONIC_TYPES.find((t) => t.id === id);

/** A chord as the editor first creates it. */
export function createChord(type = "maj") {
  return { type, inversion: 0, spread: "close" };
}

/** A chord from untrusted data (a saved project, a clipboard), or null when nothing usable is left. */
export function normalizeChord(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const type = typeof raw.type === "string" ? raw.type : null;
  let offsets;
  if (type === CUSTOM_TYPE) {
    if (!Array.isArray(raw.offsets)) return null;
    offsets = [...new Set(raw.offsets.filter((o) => Number.isFinite(o) && o >= -MAX_OFFSET && o <= MAX_OFFSET).map(Math.round))].sort((a, b) => a - b).slice(0, MAX_CHORD_VOICES);
    if (offsets.length === 0) return null;
  } else if (!typeOf(type) && !diatonicOf(type)) {
    return null;
  }
  const chord = { type };
  if (offsets) chord.offsets = offsets;
  const inversion = Number.isFinite(raw.inversion) ? Math.round(raw.inversion) : 0;
  const maxInv = Math.max(0, toneCount(chord) - 1);
  chord.inversion = Math.min(maxInv, Math.max(0, inversion));
  chord.spread = SPREAD_IDS.includes(raw.spread) ? raw.spread : "close";
  return chord;
}

/** How many tones the chord has (its inversion limit is one less). */
export function toneCount(chord) {
  if (chord.type === CUSTOM_TYPE) return Math.min(MAX_CHORD_VOICES, chord.offsets?.length ?? 0);
  return Math.min(MAX_CHORD_VOICES, (typeOf(chord.type)?.intervals ?? diatonicOf(chord.type)?.degrees ?? []).length);
}

// Semitone offsets above the root before inversion/spread. Diatonic types read the project scale; in a
// chromatic project (no key) they fall back to the major-key stack.
function baseOffsets(chord, root, scale) {
  if (chord.type === CUSTOM_TYPE) return [...(chord.offsets ?? [])];
  const fixed = typeOf(chord.type);
  if (fixed) return [...fixed.intervals];
  const diatonic = diatonicOf(chord.type);
  if (!diatonic) return [];
  if (!scale || isChromatic(scale)) return [0, 4, 7, 11, 14].slice(0, diatonic.degrees.length);
  const notes = getNotesInRange(scale, 0, MAX_NOTE);
  const base = getNearestScaleNote(scale, root);
  const at = notes.indexOf(base);
  if (at < 0) return [0, 4, 7, 11, 14].slice(0, diatonic.degrees.length);
  const out = [];
  for (const d of diatonic.degrees) if (notes[at + d] !== undefined) out.push(notes[at + d] - root);
  return out;
}

/** Moves the `inversion` lowest tones up an octave, one at a time. */
function invert(tones, inversion) {
  let t = [...tones].sort((a, b) => a - b);
  for (let i = 0, n = Math.min(inversion, Math.max(0, t.length - 1)); i < n; i++) t = [...t.slice(1), t[0] + 12];
  return t;
}

/** Lays the (ascending) tones out per `spread`; needs 3+ tones to change anything. */
function applySpread(tones, spread) {
  if (tones.length < 3) return tones;
  const t = [...tones];
  if (spread === "open") t[1] += 12;
  else if (spread === "drop2") t[t.length - 2] -= 12;
  else if (spread === "wide") for (let i = 1; i < t.length; i += 2) t[i] += 12;
  return t.sort((a, b) => a - b);
}

/** Semitone offsets from the root of each tone, ascending, after inversion and spread. `root` and `scale`
 * only matter for the diatonic types. */
export function chordOffsets(chord, root = 60, scale = null) {
  const c = normalizeChord(chord);
  if (!c) return [];
  const base = baseOffsets(c, root, scale).slice(0, MAX_CHORD_VOICES);
  return applySpread(invert(base, c.inversion ?? 0), c.spread ?? "close");
}

/** The MIDI notes the chord sounds with `root` as its root, lowest first; tones outside 0..127 are dropped. */
export function chordNotes(chord, root, scale = null) {
  if (!Number.isInteger(root)) return [];
  return chordOffsets(chord, root, scale)
    .map((o) => root + o)
    .filter((n) => n >= 0 && n <= MAX_NOTE);
}

/** Short label for the chord ("Minor 7 · 1st inv · Open"), for the grid tooltip and the editor. */
export function chordLabel(chord) {
  const c = normalizeChord(chord);
  if (!c) return "";
  const name = c.type === CUSTOM_TYPE ? "Custom" : (typeOf(c.type) ?? diatonicOf(c.type)).label;
  const parts = [name];
  if (c.inversion) parts.push(`inv ${c.inversion}`);
  if (c.spread !== "close") parts.push(CHORD_SPREADS.find((s) => s.id === c.spread).label);
  return parts.join(" · ");
}

/** True when this event is played as a chord: it has a note, a usable chord and a slot that can voice one. */
export function isChordEvent(event, instrument) {
  if (!event || event.note === null || !event.chord) return false;
  if (instrument?.output?.type === "sample" && instrument.sampleMode === "chop") return false;
  return normalizeChord(event.chord) !== null;
}

/** The chord that turns the same tones into explicit offsets (so a tone can then be added or removed). */
export function toCustomChord(chord, root, scale = null) {
  const c = normalizeChord(chord);
  return { type: CUSTOM_TYPE, offsets: chordOffsets(c ?? createChord(), root, scale), inversion: 0, spread: "close" };
}

/** `chord` with the tone at `offset` toggled (custom chords only; keeps at least one tone, at most MAX_CHORD_VOICES). */
export function toggleChordTone(chord, offset) {
  if (chord.type !== CUSTOM_TYPE) return chord;
  const has = chord.offsets.includes(offset);
  if (has && chord.offsets.length <= 1) return chord;
  if (!has && chord.offsets.length >= MAX_CHORD_VOICES) return chord;
  const offsets = has ? chord.offsets.filter((o) => o !== offset) : [...chord.offsets, offset].sort((a, b) => a - b);
  return normalizeChord({ ...chord, offsets });
}

/** Most tones any chord event on `slot` uses across the song's patterns (1 when none): the engine instances a synth slot needs. */
export function voicesNeededForSlot(song, instruments, slot) {
  const instrument = instruments[slot];
  const scale = scaleOf(song);
  let needed = 1;
  for (const pattern of song.patterns) {
    for (const track of pattern.tracks) {
      for (const event of track.events) {
        if (event.instrument !== slot || !isChordEvent(event, instrument)) continue;
        needed = Math.max(needed, chordNotes(event.chord, event.note, scale).length);
      }
    }
  }
  return Math.min(MAX_CHORD_VOICES, needed);
}
