import { createPattern } from "./pattern.js";
import { createTrackChannel } from "./trackChannel.js";
import { createScale } from "./scale.js";

// A project owns a *pool* of patterns (song.patterns, unique by id) plus an ordered
// patternQueue of pattern ids — the queue is the sequence a project plays/is organized around,
// and the same id can appear in it more than once (see model/mutations.js's
// addPattern/appendPatternToQueue/removeFromPatternQueue). song.selectedPatternId is which one
// the tracker is currently editing/displaying; it's explicit project state, not UI/session
// state, since it's meaningful musical state a reopened project should restore.
//
// Banks (src/model/bank.js, removed) used to own this pattern list+selection directly — that
// conflated "which instruments/tracks can a pattern use" with "pattern identity and
// sequencing". There is currently no bank-scoped instrument/track behavior in this codebase
// (trackChannels below are already global, shared by every pattern), so there was nothing to
// preserve on that front; if per-bank instrument sets are added later, they'd hang off
// trackChannels/instruments, not off pattern storage.
export function createSong({ name = "Untitled Project", bpm = 120, swing = 0, trackCount = 8, rowCount = 64 } = {}) {
  const firstPattern = createPattern({ id: 0, trackCount, rowCount, name: "Pattern 1" });
  return {
    name,
    bpm,
    // Global sequencer-level timing adjustment (model/timing.js#swingDelaySeconds) — 0 is
    // neutral/disabled. Deliberately a Song field alongside bpm, not per-pattern/per-track:
    // it's a transport-clock concept (see audio/lookaheadPlayer.js), not musical/pattern data.
    swing,
    // The project's key (model/scale.js): a context for note entry, never applied to stored notes
    // or to playback. Chromatic = every note in scale, i.e. what a project without one has.
    scale: createScale(),
    trackCount,
    rowCount,
    trackChannels: Array.from({ length: trackCount }, (_, i) => createTrackChannel({ index: i })),
    patterns: [firstPattern],
    patternQueue: [firstPattern.id],
    selectedPatternId: firstPattern.id,
    // The master bus's own FX baseline — same three-layer *instance* chain model as every
    // trackChannel's own fx/fxChain (see model/trackChannel.js's doc comment): masterFxChain is
    // the ordered list of FX instances actually added to MASTER_BUS, masterFx is their current
    // parameter values (`{ "bus.gain"?: value, instances: { [instanceId]: {...} } }`). Set by the
    // FX panel's MASTER view (ui/chrome/FxPanel.jsx). A tracker cell can never automate either of
    // these (see audio/compile.js#compileRowFx, which only ever resolves a *track* index).
    masterFx: { instances: {} },
    masterFxChain: [],
    // The master bus's own output balance — see model/trackChannel.js's `pan` doc comment for
    // the by-design parallel with a track's own pan; MASTER_BUS has no ChannelStrip of its own
    // (ui/chrome/Mixer.jsx only ever renders per-track strips), so this is set from the FX
    // panel's pinned Output module instead (ui/chrome/FxPanel.jsx), right alongside masterFx's
    // own "bus.gain" entry — the same always-present, non-chain bus-output surface.
    masterPan: 0,
    // Monotonically increasing — never reused, even after a pattern is removed from the
    // queue, so an id always unambiguously identifies the pattern that created it.
    nextPatternId: firstPattern.id + 1,
    // Shared by every track's fxChain and masterFxChain (model/trackChannel.js's doc comment) —
    // one counter, not one per track/master, so an instance id is always unambiguous regardless
    // of which chain it came from. Never reused, same convention as nextPatternId above.
    nextFxInstanceId: 0,
  };
}
