// rootNote: the MIDI-style note number this sample plays at its natural (unpitched) rate.
// audio/compile.js converts an event's note into a semitone offset from this before passing
// webdsp's trigger `pitch` parameter — without it, the NOTE column would be purely cosmetic
// and never actually change what's heard.
// sampleAsset: { buffer: ArrayBuffer, mimeType, fileName } | null — the raw bytes behind
// sampleId, kept alongside it because sampleId is only valid for the current AudioRuntime
// session (webdsp doesn't persist samples) and project save/load needs the original bytes to
// re-embed, not the session-local id. See src/persistence/projectFile.js.
export function createInstrumentSlot({
  id,
  name = "Empty",
  sampleId = null,
  gain = 1.0,
  rootNote = 60,
  sampleAsset = null,
} = {}) {
  return { id, name, sampleId, gain, rootNote, sampleAsset };
}
