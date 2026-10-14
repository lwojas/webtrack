// A per-song mixer-level channel strip: mute/solo/volume persist across pattern switches on
// the same track, unlike the events themselves, which are per-pattern (see pattern.js).
//
// voiceMode/maxVoices (ui/grid/gridView.js's voice header row, below the LEN row) are this
// track's own voice-allocation policy, persisted the same way as mute/solo/volume — a track's
// voice budget shouldn't reset just because playback switched patterns. The engine enforces
// them, not the tracker/UI (see audio/voiceTracker.js):
//   - "poly": up to maxVoices voices may sound at once on this track; triggering past that
//     steals the oldest one (FIFO) rather than dropping the new trigger.
//   - "mono": every previously active voice on this track is released as soon as a new one
//     triggers, so the track is always monophonic regardless of maxVoices, which is kept
//     around (not forced to 1) so it's still there if the track switches back to poly.
export const VOICE_MODES = ["poly", "mono"];
// Kept small and musically meaningful rather than exposing the engine's full voice range —
// see model/trackChannel.js's own call site in ui/grid/gridView.js for the dropdown this backs.
export const MAX_VOICES_OPTIONS = [1, 2, 4, 8, 16];
export const DEFAULT_MAX_VOICES = 4;
//
// FX is a three-layer model (model/fxParams.js has the full doc comment on the catalog side),
// built on webdsp's own ordered-FX-chain-of-*instances* primitive (node_modules/webdsp's
// docs/fx-chain.md) rather than "one of each type":
//   1. FX_TYPES/FX_PARAMS — every FX kind the DSP knows how to provide. Catalog, not per-track.
//   2. `fxChain` — an ordered array of *instances* actually added to this track's insert bus,
//      each `{ id, type, bypassed }` — `id` (allocated from song.nextFxInstanceId, see
//      model/song.js) is this instance's own stable handle, distinct from `type`: two entries
//      can share the same `type` (two independent Filters), each with its own id, own stored
//      parameter values (see `fx` below), own bypass flag, and own webdsp EffectId once pushed
//      to the engine (audio/fx.js keeps that id -> EffectId mapping, never persisted — a fresh
//      EffectId is allocated the moment this instance is (re)created in a live runtime). Array
//      order is chain/signal-flow order, preserved end to end into webdsp's own chain order
//      (addEffect's `index`/`moveEffect` — see model/mutations.js#addTrackFx/moveTrackFx).
//   3. `fx` — this track's insert-bus parameter *values*: `{ "bus.gain"?: value, instances: {
//      [instanceId]: { [fxParamId]: value } } }`. `bus.gain` sits flat at the top (it isn't part
//      of any chain — see model/fxParams.js's own doc comment, always present/ungated); every
//      other param lives under `instances[id]`, one bag per chain entry, so two instances of the
//      same type (two Filters) each keep independent cutoff/resonance/etc. — changing one can
//      never change the other. Set by the FX panel and latched by cell automation during
//      playback (audio/compile.js#compileRowFx). Not cleared when an instance is removed from
//      fxChain (only its own `instances[id]` bag goes with it via removeTrackFx) — re-adding the
//      *same* id never happens (ids aren't reused), but this does mean a freshly re-enabled FX
//      of a given type always starts from that type's catalog defaults, same as any brand-new
//      instance.
// `bypassed` on an fxChain entry is backed by webdsp's own real per-instance enable/disable
// (`setEffectEnabled`, audio/fx.js) — a temporary mute distinct from removing the instance
// outright (model/mutations.js#setTrackFxBypass vs. #removeTrackFx). No more "push a neutral
// value" bypass trick: that was only ever needed because the pre-chain engine had no per-node
// disable primitive.
//
// A pattern's per-cell Event.fx is distinct from all of this: it's a sparse override that
// latches onto whichever of these *current* values playback is already using, addressing the
// same `{ "bus.gain"?: value, instances: { [instanceId]: { [paramId]: value } } }` shape so a
// cell can unambiguously automate one specific stacked instance's parameter — validated against
// fxChain at write time (model/mutations.js#setCellFxInstanceParam) so a cell can never reference
// an instance this track doesn't have.
//
// pan: this track's own insert bus output balance (-1..+1, default 0/centre — webdsp's
// NodeParam.BusPan, node_modules/webdsp's docs/panning.md) — a channel-strip control
// (ui/chrome/Mixer.jsx's ChannelStrip, alongside volume/mute/solo), never part of fxChain/fx: it
// sits after BusGain on the same always-present bus-output stage bus.gain already addresses, not
// a toggleable effect a track chooses to add/remove.
export function createTrackChannel({
  index,
  name,
  muted = false,
  solo = false,
  volume = 1.0,
  pan = 0,
  fx = { instances: {} },
  fxChain = [],
  voiceMode = "poly",
  maxVoices = DEFAULT_MAX_VOICES,
} = {}) {
  return {
    index,
    name: name ?? `TRK ${index + 1}`,
    muted,
    solo,
    volume,
    pan,
    fx,
    fxChain,
    voiceMode,
    maxVoices,
  };
}
