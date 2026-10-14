// rootNote: the MIDI-style note number this sample plays at its natural (unpitched) rate.
// audio/compile.js converts an event's note into a semitone offset from this before passing
// webdsp's trigger `pitch` parameter — without it, the NOTE column would be purely cosmetic
// and never actually change what's heard. rootNote is a *sample-engine-only* concept: it only
// means anything for output.type === "sample" (see output below) — a MIDI note number is
// already the pitch as far as the receiving device is concerned, so audio/compile.js's MIDI
// branch never reads rootNote at all.
// sampleAsset: { buffer: ArrayBuffer, mimeType, fileName } | null — the raw bytes behind
// sampleId, kept alongside it because sampleId is only valid for the current AudioRuntime
// session (webdsp doesn't persist samples) and project save/load needs the original bytes to
// re-embed, not the session-local id. See src/persistence/projectFile.js.
// output: which engine renders a cell that addresses this instrument slot — "sample"
// (default, today's only behavior, via sampleId/rootNote/gain above) or "midi" (sends the
// cell's note/velocity out a MIDI channel instead — see audio/compile.js#compileEvent and
// audio/midiOutput.js). `channel` is only meaningful for "midi" (0-15); null for "sample".
// Lives on the instrument, not the track, because Event.instrument — not the track — is what
// already selects which voice renders a given cell (a track's cells can reference different
// instrument slots), so this is the smallest-diff place for output type to live.
//
// origin: "import" (a file the user picked) or "resample" (captured from the tracker's own
// playback via audio/resampleController.js) — purely provenance/display (the Instrument Panel's
// origin badge), never read by audio/compile.js: a resampled instrument behaves exactly like an
// imported one once it exists. localAssetId is the key this sample's raw bytes are stored under
// in persistence/localAssetStore.js's IndexedDB-backed store (set by appContext.js#
// applyInstrumentSample for every sample load, either origin) — distinct from sampleId, which is
// only a handle into the *current* AudioRuntime session, and from sampleAsset, which is the
// in-memory copy of the same bytes. See persistence/projectFile.js for why a "resample"-origin
// instrument's sample is never embedded as base64 in the project JSON the way an "import"-origin
// one is: resample bytes are addressed by localAssetId only, in both the explicit save and the
// local recovery cache.
export function createInstrumentSlot({
  id,
  name = "Empty",
  sampleId = null,
  gain = 1.0,
  rootNote = 60,
  sampleAsset = null,
  output = { type: "sample", channel: null },
  origin = "import",
  localAssetId = null,
} = {}) {
  return { id, name, sampleId, gain, rootNote, sampleAsset, output, origin, localAssetId };
}
