// A structural twin of webdsp's own src/sequencing/lookaheadPlayer.ts, reimplemented against
// our Song/Bank/Pattern/Track/Row/Event model instead of its generic `Pattern = PatternNote[][]`
// shape (see ECS-156 plan §1/§6). setInterval only decides when to top up the schedule within
// a lookahead horizon — it is never the source of timing truth, which is always
// runtime.getCurrentTime().
//
// stepCounter is the one shared transport clock — it counts up for the entire playing session
// and is never reset, only in start(). There is deliberately no per-track timer/counter
// anywhere in this file.
//
// Each track's own polymetric playhead (model/pattern.js#trackLocalStep) folds not the raw
// stepCounter but the *pattern-relative* position — stepCounter minus patternStartStep, the
// stepCounter value at which the current pattern instance began. That keeps stepCounter itself
// as the one continuous transport clock (never reset, never re-created) while still making
// every pattern a self-contained musical unit: whenever playback crosses a pattern boundary —
// a manual switch or the queue auto-advancing, including looping back into the same pattern —
// patternStartStep jumps to that boundary's stepCounter, so every track's local phase restarts
// at 0 for the new pattern instance, instead of carrying over wherever it happened to be.
import { trackLocalStep } from "../model/pattern.js";
import { voiceTracker } from "./voiceTracker.js";

const LOOKAHEAD_SECONDS = 0.15;
const TICK_INTERVAL_MS = 25;

// getNextQueueEntry(currentQueueIndex) -> { pattern, queueIndex } | null — resolves what plays
// after the current pattern finishes, read fresh from the live pattern queue every boundary
// rather than snapshotted at start() (see audio/playbackController.js#resolveQueueEntry). Not a
// Song/patternQueue import here, deliberately: this module stays generic over "whatever the
// caller says comes next," the same way it was already generic over "whatever pattern plays."
export function createLookaheadPlayer({
  runtime,
  compileRow,
  compileRowFx = () => [],
  trackBusIds,
  getStepDurationSeconds,
  onPatternSwitched,
  getNextQueueEntry,
  onTrackFxChange,
  // Overridable for tests; production wiring shares the one app-wide voiceTracker instance
  // with audio/preview.js's manual-audition path (see voiceTracker.js's own doc comment on why
  // that has to be a shared instance, not one scoped to this player).
  reserveVoiceSlot = voiceTracker.reserveVoiceSlot,
  registerVoice = voiceTracker.registerVoice,
  resetVoiceTracking = voiceTracker.reset,
} = {}) {
  let pattern = null;
  let pendingPattern = null; // { pattern, queueIndex } | null — a manually requested switch
  let queueIndex = 0;
  let trackChannels = null;
  let instruments = null;
  let timerId = null;
  let stepCounter = 0;
  let patternStartStep = 0;
  let startTime = 0;
  let playing = false;

  function tick() {
    const duration = getStepDurationSeconds();
    const horizon = runtime.getCurrentTime() + LOOKAHEAD_SECONDS;

    while (startTime + stepCounter * duration < horizon) {
      // The *pattern's* own loop boundary (row 0 of its shared grid) — distinct from any
      // individual track's polymetric wrap, and still what drives queue advance/pattern
      // switching below; the pattern queue's own semantics (ECS-156 plan §6/§7) are untouched
      // by per-track lengths.
      const rowIndex = stepCounter % pattern.rowCount;

      // A transition only takes effect at a loop boundary (row 0) after at least one full
      // pass, never mid-pattern (see ECS-156 plan §6/§7). A manually requested switch
      // (requestPatternSwitch, e.g. the user selecting a different pattern to edit) wins if
      // one is pending; otherwise the queue auto-advances on its own, so playback never simply
      // stops just because the queue reached its last entry — a one-entry queue resolves back
      // to itself every time and loops continuously.
      if (rowIndex === 0 && stepCounter > 0) {
        // The pattern boundary itself — whether the queue is moving to a different pattern or
        // looping back into this same one, a new pattern instance is starting here, so every
        // track's local phase resets with it (see this file's own top-of-file doc comment).
        patternStartStep = stepCounter;
        if (pendingPattern) {
          pattern = pendingPattern.pattern;
          queueIndex = pendingPattern.queueIndex;
          pendingPattern = null;
          onPatternSwitched?.();
        } else if (getNextQueueEntry) {
          const next = getNextQueueEntry(queueIndex);
          if (next) {
            pattern = next.pattern;
            queueIndex = next.queueIndex;
          }
        }
      }

      const stepTime = startTime + stepCounter * duration;
      // The pattern-relative position, not the raw stepCounter — compileRow folds it into each
      // track's own loop length (model/pattern.js#trackLocalStep), and it's this, not the raw
      // transport, that should restart at 0 on every new pattern instance.
      const patternRelativeStep = stepCounter - patternStartStep;
      const events = compileRow(pattern, trackChannels, instruments, patternRelativeStep, stepTime, duration, trackBusIds);
      if (events.length > 0) {
        // Voice-limit enforcement (model/trackChannel.js's voiceMode/maxVoices, via
        // audio/voiceTracker.js) happens here, right before scheduling — release()ing whatever
        // the track's policy says must give way for this row's new triggers, in the same tick
        // that starts them. trackIndex rode along on each compiled event (audio/compile.js)
        // purely for this correlation and is stripped below — webdsp's ScheduledEvent has no
        // such field.
        events.forEach((event) => {
          const toRelease = reserveVoiceSlot(event.trackIndex, trackChannels[event.trackIndex]);
          toRelease.forEach((handle) => runtime.release(handle));
        });
        const handles = runtime.schedule(events.map(({ trackIndex, ...scheduledEvent }) => scheduledEvent)) ?? [];
        events.forEach((event, index) => registerVoice(event.trackIndex, handles[index]));
      }

      // Cell FX automation rides the same tick/lookahead cadence as note scheduling above —
      // see audio/fx.js's doc comment on webdsp's setNodeParameter having no timestamp of its
      // own, unlike schedule()'s sample-accurate ScheduledEvent.time. onTrackFxChange is who
      // actually calls setNodeParameter (wired in audio/playbackController.js); this file never
      // touches NodeParam/bus ids directly, same separation compileRow/trackChannels already
      // keep it at.
      if (onTrackFxChange) {
        const fxChanges = compileRowFx(pattern, patternRelativeStep);
        fxChanges.forEach(({ trackIndex, paramId, value }) => onTrackFxChange(trackIndex, paramId, value));
      }

      stepCounter += 1;
    }
  }

  function start({ initialPattern, initialQueueIndex = 0, initialTrackChannels, initialInstruments, startAt } = {}) {
    pattern = initialPattern;
    queueIndex = initialQueueIndex;
    pendingPattern = null;
    trackChannels = initialTrackChannels;
    instruments = initialInstruments;
    stepCounter = 0;
    patternStartStep = 0;
    startTime = startAt ?? runtime.getCurrentTime() + 0.05;
    playing = true;
    // A fresh session's voice handles have nothing to do with whatever a previous one was
    // tracking (see voiceTracker.js#reset's own doc comment).
    resetVoiceTracking();

    // Arm the interval only after the first tick — the same ordering webdsp's own
    // LookaheadPlayer uses, to avoid a late-arming interval line resurrecting a player that
    // could otherwise finish synchronously inside the initial tick().
    tick();
    timerId = setInterval(tick, TICK_INTERVAL_MS);
  }

  function stop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    playing = false;
    runtime.cancelScheduled();
  }

  function isPlaying() {
    return playing;
  }

  // Deferred to the next loop boundary — see tick() above. newQueueIndex is whatever the
  // caller resolved newPattern to in the live queue (or just the player's current queueIndex,
  // unchanged, if newPattern isn't queued at all — see playbackController.js#switchPattern).
  function requestPatternSwitch(newPattern, newQueueIndex) {
    pendingPattern = { pattern: newPattern, queueIndex: newQueueIndex };
  }

  // The shared transport step, purely derived from the engine's own clock — never the
  // setInterval timer above, and never reset at a pattern boundary (see tick()'s own doc
  // comment) — so a slow/throttled UI thread only degrades the playhead's redraw rate, never
  // audio timing, and every track's playhead reads the exact same clock position audio
  // scheduling used.
  function getTransportStep() {
    if (!playing) return -1;
    const duration = getStepDurationSeconds();
    const elapsed = runtime.getCurrentTime() - startTime;
    if (elapsed < 0) return -1;
    return Math.floor(elapsed / duration);
  }

  // The pattern-grid-relative row — kept for existing single-row consumers (the MVP control
  // contract's "transport.playheadRow", src/ui/debug/PerfPanel.jsx). The per-track visual
  // playhead (ui/grid/playheadLayer.js) uses getTrackPlayheadRow below instead.
  function getPlayheadRow() {
    if (!pattern) return -1;
    const step = getTransportStep();
    return step < 0 ? -1 : step % pattern.rowCount;
  }

  // One track's own local playhead row — the same trackLocalStep(track, patternPosition) fold
  // audio/compile.js uses to decide what plays, so the visual playhead can never show a
  // position the audio didn't actually use. getTransportStep() is the absolute, continuous
  // transport; patternStartStep (set at the last pattern boundary — see tick()) converts it to
  // the pattern-relative position every track's phase is actually anchored to.
  function getTrackPlayheadRow(trackIndex) {
    const track = pattern?.tracks[trackIndex];
    if (!track) return -1;
    const step = getTransportStep();
    return step < 0 ? -1 : trackLocalStep(track, step - patternStartStep);
  }

  // The queue slot currently sounding — distinct from song.selectedPatternId (ui/chrome/
  // PatternManager.jsx's playing-entry highlight needs to track this, not the Tracker's edit
  // target). -1 while stopped, matching getPlayheadRow()'s convention.
  function getQueueIndex() {
    return playing ? queueIndex : -1;
  }

  return { start, stop, isPlaying, requestPatternSwitch, getPlayheadRow, getTrackPlayheadRow, getQueueIndex };
}
