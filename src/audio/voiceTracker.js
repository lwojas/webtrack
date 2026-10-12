import { getRuntime } from "./runtime.js";

// Enforces a track's voice-allocation policy (model/trackChannel.js's voiceMode/maxVoices) at
// the one seam every trigger path actually shares: webdsp's AudioRuntime itself has no
// per-track/per-bus voice concept at all (see node_modules/webdsp/lib/index.d.ts — VoiceHandle,
// trigger/schedule/release/stop, and onVoiceEnded are all engine-global, keyed only by an
// opaque handle). So "this track" is purely an application-level grouping this module keeps on
// top of those handles — not something the engine was asked to grow a feature for.
//
// Deliberately decision-only: reserveVoiceSlot() never calls release()/stop() itself, only
// returns which already-registered handles the caller must release before/alongside the new
// trigger. The caller (audio/lookaheadPlayer.js's tick(), audio/preview.js's triggerPreview())
// already holds a *resolved* runtime reference at that point, so it can call release()
// synchronously, in the same tick, right alongside its own trigger()/schedule() call — keeping
// "steal the old voice" and "start the new one" as close together as this engine's API (no
// scheduled-time release — see TriggerParams.time vs. release()'s own no-args signature) allows.
export function createVoiceTracker() {
  const activeByTrack = new Map(); // trackIndex -> VoiceHandle[], oldest first
  let voiceEndedWired = false;

  function pruneVoice(handle) {
    for (const active of activeByTrack.values()) {
      const index = active.indexOf(handle);
      if (index !== -1) {
        active.splice(index, 1);
        return;
      }
    }
  }

  // Lazily subscribes to the real engine's onVoiceEnded — the same "whichever call site asks
  // first wins, exactly once" idempotent shape audio/runtime.js#ensureTrackBuses uses for
  // trackBusIds — so a naturally-finished voice (its own sample ending, or a prior release()'s
  // taper completing) gets pruned here too, not just a voice this module explicitly stole.
  // Without this, a track that's never had a voice stolen would still slowly leak its active
  // list, eventually refusing new voices it should obviously still have room for.
  function ensureVoiceEndedWired() {
    if (voiceEndedWired) return;
    try {
      getRuntime().then((runtime) => runtime.onVoiceEnded(pruneVoice));
      voiceEndedWired = true;
    } catch {
      // Audio runtime not initialized yet (no Play/preview has happened this session) — retried
      // on the next reserveVoiceSlot call, the same "legitimate no-op until a user gesture"
      // shape audio/preview.js's own getRuntime() call already relies on.
    }
  }

  // Called right before triggering a new voice on `trackIndex`. `channel` is (or duck-types)
  // a trackChannel (model/trackChannel.js) — only voiceMode/maxVoices are read.
  //
  // Mono releases every voice this module still thinks is active on the track (normally at
  // most one — more only if onVoiceEnded hasn't caught up yet). Poly releases nothing until the
  // track is already at maxVoices, then steals the oldest voice, FIFO — "the newest trigger
  // always wins" is the chosen voice-stealing policy; a trigger is never silently dropped.
  function reserveVoiceSlot(trackIndex, { voiceMode, maxVoices }) {
    ensureVoiceEndedWired();
    const active = activeByTrack.get(trackIndex) ?? [];
    let toRelease = [];

    if (voiceMode === "mono") {
      toRelease = active;
      activeByTrack.set(trackIndex, []);
    } else {
      const overflow = active.length - (maxVoices - 1);
      if (overflow > 0) {
        toRelease = active.slice(0, overflow);
        activeByTrack.set(trackIndex, active.slice(overflow));
      }
    }

    return toRelease;
  }

  // Called once the engine has actually handed back a handle for a voice reserveVoiceSlot
  // already made room for. A missing handle (e.g. a test runtime stub) is a no-op, not a crash.
  function registerVoice(trackIndex, handle) {
    if (handle === undefined || handle === null) return;
    const active = activeByTrack.get(trackIndex) ?? [];
    active.push(handle);
    activeByTrack.set(trackIndex, active);
  }

  function getActiveCount(trackIndex) {
    return activeByTrack.get(trackIndex)?.length ?? 0;
  }

  // Hands back every handle this module still thinks is active on a track and clears its
  // bookkeeping for it — used when mute/solo makes a track inaudible mid-playback
  // (audio/playbackController.js#syncTrackMuting) to actually stop whatever's already
  // sounding, instead of just letting reserveVoiceSlot's compile-time gate keep the *next*
  // trigger from starting. The caller is responsible for calling runtime.release() on each
  // handle — this module only tracks which ones were active, same division as
  // reserveVoiceSlot above.
  function releaseTrack(trackIndex) {
    const active = activeByTrack.get(trackIndex) ?? [];
    activeByTrack.set(trackIndex, []);
    return active;
  }

  // audio/playbackController.js#play calls this on every (re)start — a fresh session's handles
  // have nothing to do with whatever a previous session was tracking.
  function reset() {
    activeByTrack.clear();
  }

  return { reserveVoiceSlot, registerVoice, getActiveCount, releaseTrack, reset };
}

// One shared instance for the whole app: scheduled playback (audio/lookaheadPlayer.js) and
// manual/live note audition (audio/preview.js) both report into the same per-track voice
// bookkeeping, so a track's voice budget holds regardless of which path triggered a given
// voice — exactly what model/trackChannel.js's voiceMode/maxVoices promise. Any future input
// path (e.g. MIDI, were one added — see input/noteInputSource.js's doc comment) would go
// through one of those same two trigger paths rather than needing a third one wired in here.
export const voiceTracker = createVoiceTracker();
