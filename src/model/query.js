export function getBank(song, bankIndex) {
  return song.banks[bankIndex];
}

export function getPattern(song, bankIndex, patternIndex) {
  return getBank(song, bankIndex)?.patterns[patternIndex];
}

export function getActivePattern(song, bankIndex) {
  const bank = getBank(song, bankIndex);
  return bank ? bank.patterns[bank.activePatternIndex] : undefined;
}

export function getEvent(song, bankIndex, patternIndex, trackIndex, rowIndex) {
  const pattern = getPattern(song, bankIndex, patternIndex);
  return pattern?.tracks[trackIndex]?.events[rowIndex];
}

export function getTrackChannel(song, trackIndex) {
  return song.trackChannels[trackIndex];
}

export function isAnyTrackSoloed(song) {
  return song.trackChannels.some((channel) => channel.solo);
}
