// Cue points for chop playback. The pure cue maths (normalise/add/move/remove cues, conversion to
// engine regions) is webdsp's — node_modules/webdsp's docs/sample-chop.md; this file keeps what is
// webtracker's own: the mode list, a note-range-driven slice cap, and the note <-> slice mapping.
// An instrument slot stores its cue points as fractions (0..1) of the sample, interior boundaries
// only, so N cues = N+1 contiguous slices. audio/instrumentRegions.js turns them into frame
// regions. In chop mode a cell's note picks a slice as (event.note - instrument.rootNote): the
// slot's root note plays slice 1 (see audio/compile.js).
import { addCue as dspAddCue, moveCue as dspMoveCue, normalizeCues as dspNormalizeCues, MIN_SLICE } from "webdsp";

export { removeCue, sliceCount, MIN_SLICE } from "webdsp";

export const SAMPLE_MODES = ["chromatic", "chop"];
export const DEFAULT_SAMPLE_MODE = "chromatic";
/** Most slices a sample may have; keeps every slice reachable from the note range. */
export const MAX_SLICES = 49;
/** Highest note number the tracker can hold (MIDI range). */
export const MAX_NOTE = 127;

// The chop start marker (instrument.chopStart, a fraction, default 0) is where slice 1 begins, so
// leading silence can be skipped. Cues live strictly after it, so the cue helpers take it.

/** `start` clamped to [0, first cue (or the end) - MIN_SLICE]; non-finite means 0. */
export function normalizeChopStart(start, cues) {
  if (!Number.isFinite(start)) return 0;
  return Math.min((cues[0] ?? 1) - MIN_SLICE, Math.max(0, start));
}
export const normalizeCues = (cues, start = 0) => dspNormalizeCues(cues.filter((c) => c >= start + MIN_SLICE), MAX_SLICES);
/** `slices` equal slices spanning start..1 (1 = no cues). */
export function evenCues(slices, start = 0) {
  const n = Math.min(MAX_SLICES, Math.max(1, Math.round(slices)));
  return Array.from({ length: n - 1 }, (_, i) => start + ((1 - start) * (i + 1)) / n);
}
export const addCue = (cues, at, start = 0) => (at < start + MIN_SLICE ? [...cues] : dspAddCue(cues, at, MAX_SLICES));
/** Moves cue `index`; the first cue cannot cross the start marker. */
export const moveCue = (cues, index, to, start = 0) => dspMoveCue(cues, index, index === 0 ? Math.max(to, start + MIN_SLICE) : to);
/** Moves the start marker, clamped before the first cue. */
export const moveChopStart = (cues, to) => normalizeChopStart(to, cues);
/** Frame regions for slices start..cue..cue..1 over a sample of `length` frames. */
export function cueRegions(cues, length, start = 0) {
  const bounds = [start, ...cues, 1].map((f) => Math.round(f * length));
  return bounds.slice(0, -1).map((from, i) => ({ start: from, end: bounds[i + 1] }));
}

/** The note that plays 0-based `slice` for a slot with this root, or null if beyond the note range. */
export function noteForSlice(rootNote, slice) {
  const note = rootNote + slice;
  return note >= 0 && note <= MAX_NOTE ? note : null;
}
