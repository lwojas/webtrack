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
// (default, today's only behavior, via sampleId/rootNote/gain above), "midi" (sends the
// cell's note/velocity out a MIDI channel instead — see audio/compile.js#compileEvent and
// audio/midiOutput.js), or "instrument" (renders through one of webdsp's synthesized
// instruments — see audio/instrument.js and instrumentParams/engineInstrumentId below).
// `channel` is only meaningful for "midi" (0-15); `kind`/`track` only for "instrument" (a string
// key into model/instrumentParams.js's SYNTH_PARAMS_BY_KIND, e.g. "kick" — webdsp's own
// InstrumentKind, addressed by name rather than its numeric enum so a saved project stays
// readable/stable even if webdsp renumbers it). `channel`/`kind` are null for the other output
// type(s). Lives on the instrument, not the track, because Event.instrument — not the track — is
// what already selects which voice renders a given cell (a track's cells can reference different
// instrument slots), so this is the smallest-diff place for output type to live. A slot's
// sampleId/rootNote/gain/envelope/sampleAsset stay present (just unused) under "instrument"
// output, the same way they already go unused under "midi" — no special-casing needed to keep
// them around across a user flipping the output toggle back and forth.
// `track` (number | null, "instrument" output only) — which bus a synth instrument's live
// webdsp instance renders into: null (default) is MASTER_BUS, today's only behavior; a track
// index routes it into that track's own insert bus instead, so it passes through that track's
// FX chain (filter/delay/reverb/etc.), BusPan, and mute/solo/volume gating exactly the way a
// sample voice on that track already does (audio/instrument.js resolves this the same way
// audio/fx.js#resolveBusId already does for FX). This is orthogonal to any instrument kind's own
// *internal* DSP (e.g. Tom's damp low-pass, a future bass synth's own filter) — that's webdsp's
// sound design, not a webtrack routing concern; `track` only decides which bus the kind's
// already-finished output sums into. webdsp has no bus-of-a-bus chaining (every bus — track or
// instrument-routed — sums directly into MASTER_BUS, never into another non-master bus), so this
// is a single either/or choice, not a chain of its own.
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
// envelope: { attack, decay, sustain, release } — webdsp's per-sample ADSR amplitude envelope
// (node_modules/webdsp's docs/adsr-envelope.md's EnvelopeParams), persistent per instrument like
// gain (audio/instrumentEnvelope.js bridges this to runtime.setSampleEnvelope()). The default
// here is a literal copy of webdsp's own engine default — attack/decay 0, sustain 1, release
// 10ms — which "leaves the sound unchanged apart from a 10ms click-free release," i.e. exactly
// how every instrument already sounded before this feature existed, so an existing project (or
// one loaded before envelope existed — see persistence/projectFile.js) is unaffected until a
// user actually opens the instrument editor and changes something. Edited via
// ui/chrome/InstrumentPanel.jsx's instrument editor, directly below the existing Gain slider —
// per-sample/per-instrument, never a track or bus property (model/trackChannel.js has no
// equivalent field).
export function createInstrumentSlot({
  id,
  name = "Empty",
  sampleId = null,
  gain = 1.0,
  rootNote = 60,
  sampleAsset = null,
  output = { type: "sample", channel: null, kind: null, track: null },
  origin = "import",
  localAssetId = null,
  envelope = { attack: 0, decay: 0, sustain: 1, release: 0.01 },
  // instrumentParams: Record<paramId, number> | null — persistent per-instance control values
  // for an "instrument"-output slot (model/instrumentParams.js's catalog for output.kind),
  // seeded with that kind's defaults the moment a slot is switched to it (state/store.js#
  // setInstrumentOutput) — null until then, same "nothing to show yet" shape envelope/gain
  // don't need (they always have a value) but output.channel already does for an unconfigured
  // MIDI slot.
  instrumentParams = null,
  // engineInstrumentId: webdsp's own InstrumentId for this slot — session-scoped only, exactly
  // like sampleId above (never persisted; see persistence/projectFile.js). Written by
  // audio/instrument.js#createSynthInstrument the moment a live webdsp instrument exists for
  // this slot; audio/compile.js reads it the same inert way it already reads sampleId.
  engineInstrumentId = null,
} = {}) {
  return {
    id,
    name,
    sampleId,
    gain,
    rootNote,
    sampleAsset,
    output,
    origin,
    localAssetId,
    envelope,
    instrumentParams,
    engineInstrumentId,
  };
}
