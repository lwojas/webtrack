import { createEmptyEvent } from "./event.js";

// `length` is the track's own playback loop length in steps — independent of `events.length`
// (which always matches the pattern's shared rowCount/grid size, see model/mutations.js's
// setPatternRowCount). Defaulting it to rowCount means a freshly created track plays exactly
// as it always has (every track looping over the whole grid); a track only becomes
// polymetric once something explicitly shortens its `length` below that (see
// model/mutations.js#setTrackLength).
function createPatternTrack(rowCount, length = rowCount) {
  return { events: Array.from({ length: rowCount }, () => createEmptyEvent()), length };
}

// The shared transport step (lookaheadPlayer's own stepCounter — a single, ever-advancing
// clock, never reset per pattern/track) folded into this track's own loop length. This is the
// one formula every polymetric read path uses — audio/compile.js for what plays, and the
// grid's per-track playhead (ui/grid/playheadLayer.js, via audio/playbackController.js) for
// what's drawn — so the two can never disagree about a track's position.
export function trackLocalStep(track, transportStep) {
  const length = track.length || 1;
  return ((transportStep % length) + length) % length;
}

// A pattern's event grid, independent of track mute/solo/volume (trackChannel.js). A
// PatternTrack is keyed by track index, matching song.trackChannels — the pattern doesn't
// duplicate per-track mixer state.
//
// `id` is a stable identity, assigned by the caller (model/song.js's nextPatternId counter) —
// it's what the project's patternQueue references, and what stays valid across renames or the
// pattern being requeued, so two queue slots can point at the exact same pattern instance.
//
// Each PatternTrack owns its own `events` array length *and* its own playback `length` — both
// default to the pattern's shared rowCount, but nothing requires them to stay equal (see
// createPatternTrack above and model/mutations.js#setTrackLength).
export function createPattern({ id, trackCount = 8, rowCount = 64, name = "Pattern" } = {}) {
  return {
    id,
    name,
    rowCount,
    tracks: Array.from({ length: trackCount }, () => createPatternTrack(rowCount)),
  };
}
