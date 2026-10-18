// Cue points for chop playback (pure model logic — no React, no webdsp). An instrument slot
// stores its cue points as fractions (0..1) of the sample, interior boundaries only, so they
// survive a reload at a different engine sample rate. Slices are contiguous: boundaries
// [0, ...cues, 1] give N cues -> N+1 slices. audio/instrumentRegions.js turns them into webdsp
// frame regions. In chop mode a note picks a slice as (event.note - instrument.rootNote), i.e.
// the slot's root note is slice 1 (see audio/compile.js).
// Same logic as webseq's model/chop.ts.

export const SAMPLE_MODES = ["chromatic", "chop"];
export const DEFAULT_SAMPLE_MODE = "chromatic";
/** Smallest slice, as a fraction of the sample. */
export const MIN_SLICE = 0.002;
/** Most slices a sample may have (webdsp's region table is larger; this keeps the note range usable). */
export const MAX_SLICES = 49;

/** Sorted, de-duplicated, in-range cues with every slice at least MIN_SLICE wide, capped to MAX_SLICES slices. */
export function normalizeCues(cues) {
  const sorted = cues
    .filter((c) => Number.isFinite(c))
    .map((c) => Math.min(1, Math.max(0, c)))
    .sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const c of sorted) {
    if (c - prev < MIN_SLICE || 1 - c < MIN_SLICE) continue;
    if (result.length >= MAX_SLICES - 1) break;
    result.push(c);
    prev = c;
  }
  return result;
}

/** Evenly spaced cues giving `slices` equal slices (1 = no cues). */
export function evenCues(slices) {
  const n = Math.min(MAX_SLICES, Math.max(1, Math.round(slices)));
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

export function sliceCount(cues) {
  return cues && cues.length > 0 ? cues.length + 1 : 0;
}

export function addCue(cues, at) {
  return normalizeCues([...cues, at]);
}

/** Moves cue `index` to `to`, clamped between its neighbours so cues never cross. */
export function moveCue(cues, index, to) {
  if (index < 0 || index >= cues.length) return [...cues];
  const lo = (index > 0 ? cues[index - 1] : 0) + MIN_SLICE;
  const hi = (index < cues.length - 1 ? cues[index + 1] : 1) - MIN_SLICE;
  const next = [...cues];
  next[index] = Math.min(hi, Math.max(lo, to));
  return next;
}

export function removeCue(cues, index) {
  return cues.filter((_, i) => i !== index);
}

/** webdsp regions (frame offsets) for `cues` over a sample of `length` frames. */
export function cueRegions(cues, length) {
  const bounds = [0, ...cues, 1].map((f) => Math.round(f * length));
  return bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
}
