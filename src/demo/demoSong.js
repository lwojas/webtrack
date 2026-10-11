import { createSong } from "../model/song.js";
import { createInstrumentSlot } from "../model/instrument.js";
import { setEventField } from "../model/mutations.js";

// A simple 4-on-the-floor kick + off-beat hat pattern in bank 0's first pattern, so the app
// (and the phase-3 audio harness) is playable with zero setup.
export function createDemoSong() {
  const song = createSong({ name: "Demo Song" });
  const pattern = song.banks[0].patterns[0];

  for (let row = 0; row < pattern.rowCount; row += 4) {
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: row }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: row }, "instrument", 0);
  }
  for (let row = 2; row < pattern.rowCount; row += 4) {
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 1, rowIndex: row }, "note", 60);
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 1, rowIndex: row }, "instrument", 1);
  }

  return song;
}

// sampleId is left null here — the caller loads the demo kit and fills it in once the
// samples are decoded (see harness.js / the real app's bootstrap).
export function createDemoInstruments() {
  return [
    createInstrumentSlot({ id: 0, name: "Kick", rootNote: 60 }),
    createInstrumentSlot({ id: 1, name: "Hat", rootNote: 60 }),
  ];
}
