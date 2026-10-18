// Cue points for chop playback. The pure cue maths (normalise/add/move/remove cues, conversion to
// engine regions) is webdsp's — node_modules/webdsp's docs/sample-chop.md; this file keeps what is
// webtracker's own: the mode list, a note-range-driven slice cap, and the note <-> slice mapping.
// An instrument slot stores its cue points as fractions (0..1) of the sample, interior boundaries
// only, so N cues = N+1 contiguous slices. audio/instrumentRegions.js turns them into frame
// regions. In chop mode a cell's note picks a slice as (event.note - instrument.rootNote): the
// slot's root note plays slice 1 (see audio/compile.js).
import { addCue as dspAddCue, evenCues as dspEvenCues, normalizeCues as dspNormalizeCues, sliceCount } from "webdsp";

export { cueRegions, moveCue, removeCue, sliceCount, MIN_SLICE } from "webdsp";

export const SAMPLE_MODES = ["chromatic", "chop"];
export const DEFAULT_SAMPLE_MODE = "chromatic";
/** Most slices a sample may have; keeps every slice reachable from the note range. */
export const MAX_SLICES = 49;
/** Highest note number the tracker can hold (MIDI range). */
export const MAX_NOTE = 127;

export const normalizeCues = (cues) => dspNormalizeCues(cues, MAX_SLICES);
export const evenCues = (slices) => dspEvenCues(slices, MAX_SLICES);
export const addCue = (cues, at) => dspAddCue(cues, at, MAX_SLICES);

/** The note that plays 0-based `slice` for a slot with this root, or null if beyond the note range. */
export function noteForSlice(rootNote, slice) {
  const note = rootNote + slice;
  return note >= 0 && note <= MAX_NOTE ? note : null;
}
