import { createSong } from "../model/song.js";
import { createInstrumentSlot } from "../model/instrument.js";
import { setEventField } from "../model/mutations.js";

// A simple 4-on-the-floor kick + off-beat hat pattern in the project's one starting pattern,
// so the app (and the phase-3 audio harness) is playable with zero setup.
export function createDemoSong() {
  // Dev/perf-experiment hook: ?tracks=N builds the demo song with N tracks (no live resize UI yet).
  const requested = Number(new URLSearchParams(globalThis.location?.search ?? "").get("tracks"));
  const hasRequested = Number.isInteger(requested) && requested >= 1 && requested <= 64;
  const trackCount = hasRequested ? requested : 8;
  const song = createSong({ name: "Demo Song", trackCount });
  const pattern = song.patterns[0];

  for (let row = 0; row < pattern.rowCount; row += 4) {
    setEventField(song, { patternId: pattern.id, trackIndex: 0, rowIndex: row }, "note", 60);
    setEventField(song, { patternId: pattern.id, trackIndex: 0, rowIndex: row }, "instrument", 0);
  }
  for (let row = 2; row < pattern.rowCount; row += 4) {
    setEventField(song, { patternId: pattern.id, trackIndex: 1, rowIndex: row }, "note", 60);
    setEventField(song, { patternId: pattern.id, trackIndex: 1, rowIndex: row }, "instrument", 1);
  }

  // With ?tracks=N, give every extra track a pattern too so the whole mixer/audio path is exercised.
  for (let t = 2; hasRequested && t < trackCount; t++) {
    for (let row = t % 4; row < pattern.rowCount; row += 4) {
      setEventField(song, { patternId: pattern.id, trackIndex: t, rowIndex: row }, "note", 60 + (t % 12));
      setEventField(song, { patternId: pattern.id, trackIndex: t, rowIndex: row }, "instrument", t % 2);
    }
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
