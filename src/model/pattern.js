import { createEmptyEvent } from "./event.js";

function createPatternTrack(rowCount) {
  return { events: Array.from({ length: rowCount }, () => createEmptyEvent()) };
}

// A pattern's event grid, independent of track mute/solo/volume (trackChannel.js) and
// independent of which bank it belongs to. A PatternTrack is keyed by track index, matching
// song.trackChannels — the pattern doesn't duplicate per-track mixer state.
export function createPattern({ trackCount = 8, rowCount = 64, name = "Pattern" } = {}) {
  return {
    name,
    rowCount,
    tracks: Array.from({ length: trackCount }, () => createPatternTrack(rowCount)),
  };
}
