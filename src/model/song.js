import { createPattern } from "./pattern.js";
import { createTrackChannel } from "./trackChannel.js";

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
export function createSong({ name = "Untitled Project", bpm = 120, trackCount = 8, rowCount = 64 } = {}) {
  const firstPattern = createPattern({ id: 0, trackCount, rowCount, name: "Pattern 1" });
  return {
    name,
    bpm,
    trackCount,
    rowCount,
    trackChannels: Array.from({ length: trackCount }, (_, i) => createTrackChannel({ index: i })),
    patterns: [firstPattern],
    patternQueue: [firstPattern.id],
    selectedPatternId: firstPattern.id,
    // The master bus's own FX baseline — { [fxParamId]: value } (model/fxParams.js), set by
    // the FX panel's MASTER view (ui/chrome/FxPanel.jsx). Separate from every trackChannel's
    // own `fx` (see model/trackChannel.js) — a tracker cell can never automate this (see
    // audio/compile.js#compileRowFx, which only ever resolves a *track* index).
    masterFx: {},
    // Monotonically increasing — never reused, even after a pattern is removed from the
    // queue, so an id always unambiguously identifies the pattern that created it.
    nextPatternId: firstPattern.id + 1,
  };
}
