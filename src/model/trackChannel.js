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
// chokeGroup: null (none) or a positive integer. A note on this track cuts the sounding voices of
// every *other* track in the same group at the note's exact start frame (open/closed hi-hat). The
// cut is made by the engine (webdsp docs/choke-groups.md); the tracker only stamps the group on
// each event. Distinct from voiceMode (a track against itself) and from voice stealing. A group
// only ever matters across tracks: webdsp tells sources apart by bus, and every track has its own.
export const CHOKE_GROUP_COUNT = 8;
// Anything a hand-edited or older project might hold (absent, 0, negative, fractional, NaN) is none.
export function effectiveChokeGroup(channel) {
  const g = channel?.chokeGroup;
  return Number.isInteger(g) && g >= 1 ? g : null;
}
//
// fxSend: this track is an FX send/return lane (model/mutations.js#setTrackChannelFxSend). It
// takes no notes, so no instrument or sample is ever written into it (model/mutations.js#
// setEventField, the paste/fill paths, and audio/compile.js all honour that), but its FX chain,
// cell FX automation, pan/volume and routing (an instrument slot's output.track can point at it)
// work as on any track. Absent/false = an ordinary track.
export function isFxSend(channel) {
  return channel?.fxSend === true;
}
//
// outputTrack: where this track's bus sums into after its own FX chain, gain and pan — null/absent =
// MASTER (the default), or another track's index (webdsp NodeParam.BusOutput). This is the post-FX
// route: an instrument's own Output Bus (model/instrument.js#output.track) feeds a track's *input*,
// before its FX, so e.g. a snare track can carry its own filter and still be summed into a drum-bus
// track with a compressor. Never self, and never a loop (outputTargets below).
export function effectiveOutputTrack(channel) {
  const t = channel?.outputTrack;
  return Number.isInteger(t) && t >= 0 ? t : null;
}

// Would routing `from` into `to` close a loop (to's own output chain leads back to from)?
export function wouldCycle(trackChannels, from, to) {
  const seen = new Set();
  for (let t = to; t !== null && !seen.has(t); t = effectiveOutputTrack(trackChannels[t])) {
    if (t === from) return true;
    seen.add(t);
  }
  return false;
}

// The track indices `from` may output into (everything but itself and anything that would loop).
export function outputTargets(trackChannels, from) {
  return trackChannels.map((_, i) => i).filter((i) => i !== from && !wouldCycle(trackChannels, from, i));
}

// Drops any outputTrack that is out of range, a self-route or part of a loop (older/hand-edited
// projects, a shrunk track count). Returns whether anything changed.
export function sanitizeOutputTracks(trackChannels) {
  let changed = false;
  trackChannels.forEach((channel, i) => {
    if (channel.outputTrack === undefined) return;
    const t = effectiveOutputTrack(channel);
    if (t === null || t >= trackChannels.length || t === i || wouldCycle(trackChannels, i, t)) {
      delete channel.outputTrack;
      changed = true;
    }
  });
  return changed;
}
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
  chokeGroup = null,
  fxSend = false,
  outputTrack = null,
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
    chokeGroup,
    // Only written when on, so projects saved before send tracks existed stay byte-identical.
    ...(fxSend ? { fxSend: true } : {}),
    // Likewise only written when routed to another track (absent = MASTER).
    ...(outputTrack !== null ? { outputTrack } : {}),
  };
}
