import { initRuntime } from "./runtime.js";
import { createLookaheadPlayer } from "./lookaheadPlayer.js";
import { compileRow } from "./compile.js";
import { STEPS_PER_BEAT } from "../model/timing.js";
import { getPatternQueueEntries } from "../model/query.js";

// The bridge between state/store.js and audio/* — deliberately takes its state as getter
// functions rather than importing state/store.js directly, so audio/ stays free of any ui/
// or state/ import (see ECS-156 plan §6's import rule). state/store.js is what actually wires
// these getters to itself. getSong() is read fresh on every call below (at play(), at every
// queue-advance boundary) rather than snapshotted — the pattern queue is live, authoritative
// project state (model/song.js's doc comment), so playback must always see its current shape.
export function createPlaybackController({
  getSong,
  getTrackChannels,
  getInstruments,
  getBpm,
  onTransportChange,
  onPatternSwitchPending,
}) {
  let player = null;

  function getStepDurationSeconds() {
    return 60 / getBpm() / STEPS_PER_BEAT;
  }

  // Resolves one queue slot by index (wrapping around both ends) to its { pattern, queueIndex }
  // — this is what makes the queue loop: index patternQueue.length just wraps back to 0, and a
  // one-entry queue always resolves back to itself.
  function resolveQueueEntry(index) {
    const entries = getPatternQueueEntries(getSong());
    if (entries.length === 0) return null;
    const wrapped = ((index % entries.length) + entries.length) % entries.length;
    return { pattern: entries[wrapped].pattern, queueIndex: wrapped };
  }

  // Where playback starts: the selected pattern's own queue slot, if it currently has one
  // (so pressing Play after picking a pattern in the Tracker/Pattern Manager plays from there,
  // matching prior behavior), otherwise the first queue entry — the queue is authoritative, so
  // a selected pattern that isn't queued at all can't anchor where playback begins.
  function initialQueueEntry() {
    const song = getSong();
    const entries = getPatternQueueEntries(song);
    const index = entries.findIndex((entry) => entry.patternId === song.selectedPatternId);
    return index === -1 ? { pattern: entries[0].pattern, queueIndex: 0 } : { pattern: entries[index].pattern, queueIndex: index };
  }

  async function play() {
    const runtime = await initRuntime();
    if (!player) {
      player = createLookaheadPlayer({
        runtime,
        compileRow,
        getStepDurationSeconds,
        onPatternSwitched: () => onPatternSwitchPending?.(false),
        getNextQueueEntry: (currentIndex) => resolveQueueEntry(currentIndex + 1),
      });
    }
    const { pattern, queueIndex } = initialQueueEntry();
    player.start({
      initialPattern: pattern,
      initialQueueIndex: queueIndex,
      initialTrackChannels: getTrackChannels(),
      initialInstruments: getInstruments(),
    });
    onTransportChange?.({ playing: true });
  }

  function stop() {
    player?.stop();
    onTransportChange?.({ playing: false });
  }

  // While playing, the switch is deferred to the next loop boundary (see lookaheadPlayer.js),
  // which reports back via onPatternSwitched once it actually takes effect. While stopped,
  // there's nothing to defer — the next play() call reads the song fresh, so the switch is
  // already effectively immediate and there's no pending state to report. Also resyncs the
  // player's queueIndex to wherever newPattern sits in the live queue, so auto-advance keeps
  // making sense afterward; if newPattern isn't queued at all (e.g. a just-duplicated pattern
  // that hasn't been queued yet), the queueIndex is left as-is.
  function switchPattern(newPattern) {
    if (!player?.isPlaying()) return;
    const entries = getPatternQueueEntries(getSong());
    const matchIndex = entries.findIndex((entry) => entry.patternId === newPattern.id);
    const queueIndex = matchIndex === -1 ? player.getQueueIndex() : matchIndex;
    player.requestPatternSwitch(newPattern, queueIndex);
    onPatternSwitchPending?.(true);
  }

  function isPlaying() {
    return player?.isPlaying() ?? false;
  }

  function getPlayheadRow() {
    return player?.getPlayheadRow() ?? -1;
  }

  // One track's own local playhead row (model/pattern.js#trackLocalStep) — what
  // ui/grid/playheadLayer.js draws per track column instead of one shared row.
  function getTrackPlayheadRow(trackIndex) {
    return player?.getTrackPlayheadRow(trackIndex) ?? -1;
  }

  // The queue entry actually sounding right now — ui/chrome/PatternManager.jsx's playing
  // highlight polls this (see its own doc comment for why a poll, not a store event).
  function getPlayingQueueIndex() {
    return player?.getQueueIndex() ?? -1;
  }

  return { play, stop, switchPattern, isPlaying, getPlayheadRow, getTrackPlayheadRow, getPlayingQueueIndex };
}
