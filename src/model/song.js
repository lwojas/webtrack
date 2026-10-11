import { createBank } from "./bank.js";
import { createTrackChannel } from "./trackChannel.js";

// Which bank is currently selected is UI/session state, not part of the song — see
// state/store.js's `activeBankIndex`. Which pattern is selected *within* a bank is part of
// the bank itself (bank.activePatternIndex), since it's meaningful musical state the song
// should remember per bank, not a single global cursor.
export function createSong({ bpm = 120, trackCount = 8, bankCount = 4, rowCount = 64 } = {}) {
  return {
    bpm,
    trackCount,
    rowCount,
    trackChannels: Array.from({ length: trackCount }, (_, i) => createTrackChannel({ index: i })),
    banks: Array.from({ length: bankCount }, (_, i) =>
      createBank({ id: i, name: `Bank ${String.fromCharCode(65 + i)}`, trackCount, rowCount }),
    ),
  };
}
