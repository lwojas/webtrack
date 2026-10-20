// Project-level musical scale: a *context*, not a constraint. It tells note entry which pitches
// belong to the key (to emphasise them and optionally snap new entries to them) and nothing
// else — changing it never rewrites a note, and playback never reads it. Defined by semitone
// intervals so adding a scale is one table row. Pure data + functions, no UI. A line-for-line
// port of webseq's src/model/scale.ts (the two apps share no package) with the same test
// vectors. Notes here are the model's MIDI-style numbers (model/notes.js: 60 = C-4).

export const SCALES = [
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harmonicMinor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", label: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "pentatonicMajor", label: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { id: "pentatonicMinor", label: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "wholeTone", label: "Whole Tone", intervals: [0, 2, 4, 6, 8, 10] },
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const DEFAULT_SCALE_ID = "chromatic";
export const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Subjective starting points (root + scale + a handy edit octave), never definitions of a genre.
// `octave` is the tracker's octave convention (model/notes.js: C4 = 60).
export const SCALE_PRESETS = [
  { id: "liquidDnb", label: "Liquid DnB", root: 2, scale: "dorian", octave: 3 },
  { id: "minimalTechno", label: "Minimal Techno", root: 9, scale: "phrygian", octave: 2 },
  { id: "deepHouse", label: "Deep House", root: 7, scale: "dorian", octave: 3 },
  { id: "detroitTechno", label: "Detroit Techno", root: 4, scale: "minor", octave: 3 },
  { id: "ambient", label: "Ambient", root: 0, scale: "lydian", octave: 3 },
  { id: "acid", label: "Acid", root: 9, scale: "pentatonicMinor", octave: 2 },
  { id: "synthwave", label: "Synthwave", root: 9, scale: "minor", octave: 3 },
  { id: "lofi", label: "Lo-fi", root: 0, scale: "dorian", octave: 3 },
  { id: "trap", label: "Trap", root: 6, scale: "phrygian", octave: 2 },
  { id: "ukGarage", label: "UK Garage", root: 7, scale: "minor", octave: 3 },
  { id: "cinematic", label: "Cinematic", root: 2, scale: "harmonicMinor", octave: 3 },
];

// The project's key: root is a pitch class 0..11 (0 = C); snap makes keyboard/MIDI note entry land
// on scale notes (Shift = chromatic escape); preset remembers which musical preset set root+scale,
// for display only.
export function createScale() {
  return { root: 0, scale: DEFAULT_SCALE_ID, snap: false, preset: null };
}

export function scaleDef(id) {
  return SCALES.find((s) => s.id === id) ?? SCALES[SCALES.length - 1];
}

const mod12 = (n) => ((n % 12) + 12) % 12;

// A scale from partial/untrusted data (an old project has none): every field defaulted/clamped.
export function normalizeScale(raw) {
  const base = createScale();
  if (!raw || typeof raw !== "object") return base;
  const root = Number.isFinite(raw.root) ? mod12(Math.round(raw.root)) : base.root;
  const scale = typeof raw.scale === "string" && SCALES.some((s) => s.id === raw.scale) ? raw.scale : base.scale;
  const preset = typeof raw.preset === "string" && SCALE_PRESETS.some((p) => p.id === raw.preset) ? raw.preset : null;
  return { root, scale, snap: raw.snap === true, preset };
}

// The song's scale, or the all-notes default for a project saved before scales existed.
export function scaleOf(holder) {
  return normalizeScale(holder?.scale);
}

export function rootName(root) {
  return ROOT_NAMES[mod12(root)];
}

// "D Dorian", or with a preset: "Liquid DnB (D Dorian)".
export function formatScale(ctx) {
  const key = `${rootName(ctx.root)} ${scaleDef(ctx.scale).label}`;
  const preset = SCALE_PRESETS.find((p) => p.id === ctx.preset);
  return preset ? `${preset.label} (${key})` : key;
}

// Pitch classes (0..11) of root+scale, in scale order starting at the root.
export function getScaleNotes(root, scale) {
  return scaleDef(scale).intervals.map((i) => mod12(root + i));
}

// True when every pitch is in the scale, i.e. there is nothing to emphasise.
export function isChromatic(ctx) {
  return scaleDef(ctx.scale).intervals.length === 12;
}

export function isNoteInScale(ctx, midi) {
  return scaleDef(ctx.scale).intervals.includes(mod12(Math.round(midi) - ctx.root));
}

// 1-based scale degree of `midi` (root = 1), or null if it is not in the scale.
export function getScaleDegree(ctx, midi) {
  const idx = scaleDef(ctx.scale).intervals.indexOf(mod12(Math.round(midi) - ctx.root));
  return idx < 0 ? null : idx + 1;
}

// The scale note closest to `midi`; a tie goes to the lower note, so snapping is predictable.
export function getNearestScaleNote(ctx, midi) {
  const target = Math.round(midi);
  for (let d = 0; d <= 6; d++) {
    if (isNoteInScale(ctx, target - d)) return target - d;
    if (isNoteInScale(ctx, target + d)) return target + d;
  }
  return target;
}

// Every in-scale note in [minMidi, maxMidi], ascending.
export function getNotesInRange(ctx, minMidi, maxMidi) {
  const out = [];
  for (let n = Math.ceil(minMidi); n <= Math.floor(maxMidi); n++) if (isNoteInScale(ctx, n)) out.push(n);
  return out;
}

// `ctx` with one musical preset applied (root + scale), keeping the snap setting.
export function applyScalePreset(ctx, presetId) {
  const preset = SCALE_PRESETS.find((p) => p.id === presetId);
  return preset ? { ...ctx, root: preset.root, scale: preset.scale, preset: preset.id } : ctx;
}

// Merges a patch into the scale. Picking a root/scale by hand clears the preset label (the key no
// longer is the preset); a `preset` in the patch applies that preset.
export function patchScale(ctx, patch) {
  if (patch.preset) return { ...applyScalePreset(ctx, patch.preset), snap: patch.snap ?? ctx.snap };
  const touchesKey = patch.root !== undefined || patch.scale !== undefined;
  return normalizeScale({ ...ctx, ...patch, preset: touchesKey ? null : (patch.preset ?? ctx.preset) });
}

// Keyboard/MIDI note entry: with Snap on, the note moves to the nearest scale note unless the
// player asked for a chromatic one (Shift on the computer keyboard).
export function snapEnteredNote(ctx, note, { chromatic = false } = {}) {
  return ctx.snap && !chromatic ? getNearestScaleNote(ctx, note) : note;
}
