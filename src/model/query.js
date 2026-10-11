export function getPattern(song, patternId) {
  return song.patterns.find((pattern) => pattern.id === patternId);
}

export function getSelectedPattern(song) {
  return getPattern(song, song.selectedPatternId);
}

export function getEvent(song, patternId, trackIndex, rowIndex) {
  const pattern = getPattern(song, patternId);
  return pattern?.tracks[trackIndex]?.events[rowIndex];
}

export function getTrackChannel(song, trackIndex) {
  return song.trackChannels[trackIndex];
}

export function isAnyTrackSoloed(song) {
  return song.trackChannels.some((channel) => channel.solo);
}

// The queue as a list of { queueIndex, patternId, pattern } — what the Pattern Manager
// renders. Resolves each queue slot's pattern fresh rather than assuming queue order matches
// song.patterns order (it doesn't: the same patternId can occupy more than one slot).
export function getPatternQueueEntries(song) {
  return song.patternQueue.map((patternId, queueIndex) => ({
    queueIndex,
    patternId,
    pattern: getPattern(song, patternId),
  }));
}
