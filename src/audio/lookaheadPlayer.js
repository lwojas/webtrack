// A structural twin of webdsp's own src/sequencing/lookaheadPlayer.ts, reimplemented against
// our Song/Bank/Pattern/Track/Row/Event model instead of its generic `Pattern = PatternNote[][]`
// shape (see ECS-156 plan §1/§6). setInterval only decides when to top up the schedule within
// a lookahead horizon — it is never the source of timing truth, which is always
// runtime.getCurrentTime().
const LOOKAHEAD_SECONDS = 0.15;
const TICK_INTERVAL_MS = 25;

export function createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds, onPatternSwitched }) {
  let pattern = null;
  let pendingPattern = null;
  let trackChannels = null;
  let instruments = null;
  let timerId = null;
  let stepCounter = 0;
  let startTime = 0;
  let playing = false;

  function tick() {
    const duration = getStepDurationSeconds();
    const horizon = runtime.getCurrentTime() + LOOKAHEAD_SECONDS;

    while (startTime + stepCounter * duration < horizon) {
      const rowIndex = stepCounter % pattern.rowCount;

      // A pattern switch requested mid-loop only takes effect at the next loop boundary
      // (row 0), not immediately — see ECS-156 plan §6/§7.
      if (rowIndex === 0 && pendingPattern) {
        pattern = pendingPattern;
        pendingPattern = null;
        onPatternSwitched?.();
      }

      const stepTime = startTime + stepCounter * duration;
      const events = compileRow(pattern, trackChannels, instruments, rowIndex, stepTime, duration);
      if (events.length > 0) runtime.schedule(events);

      stepCounter += 1;
    }
  }

  function start({ initialPattern, initialTrackChannels, initialInstruments, startAt } = {}) {
    pattern = initialPattern;
    pendingPattern = null;
    trackChannels = initialTrackChannels;
    instruments = initialInstruments;
    stepCounter = 0;
    startTime = startAt ?? runtime.getCurrentTime() + 0.05;
    playing = true;

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

  // Deferred to the next loop boundary — see tick() above.
  function requestPatternSwitch(newPattern) {
    pendingPattern = newPattern;
  }

  // Purely derived from the engine's own clock — never the setInterval timer above — so a
  // slow/throttled UI thread only degrades the playhead's redraw rate, never audio timing.
  function getPlayheadRow() {
    if (!playing || !pattern) return -1;
    const duration = getStepDurationSeconds();
    const elapsed = runtime.getCurrentTime() - startTime;
    if (elapsed < 0) return -1;
    return Math.floor(elapsed / duration) % pattern.rowCount;
  }

  return { start, stop, isPlaying, requestPatternSwitch, getPlayheadRow };
}
