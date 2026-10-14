// Resample: capture exactly N tracker steps of the engine's own master-bus output, synced to
// the same musical timing model playback already uses — never a wall-clock recording. webdsp's
// AudioRuntime.armCapture({startTime, stopTime}) already does the hard part: a sample-accurate
// capture window expressed in absolute engine time, the same domain as
// getCurrentTime()/schedule()'s ScheduledEvent.time (see webdsp's ARCHITECTURE.md, "How armed
// capture works"). This module's only job is picking the right [startTime, stopTime) and
// handing it to armCapture() at the right moment — no engine change needed.
//
// webseq's own audio/transport.ts#armResample is the reference this is modeled on, with one
// simplification: webseq targets "the next occurrence of a specific *pattern*" (it resamples
// one full pattern iteration). This targets "the next step the scheduler hasn't scheduled yet,
// whatever pattern it belongs to" — simpler, and it works across pattern/queue boundaries during
// playback for free, since audio/lookaheadPlayer.js's stepCounter grid doesn't care which
// pattern is logically selected at any given step.
export function createResampleController({ runtime, isPlaying }) {
  // { steps, status: "armed" | "capturing", resolve, reject } | null — non-null from arm()
  // until the target step boundary has actually been captured (or abandoned by cancel()).
  let state = null;

  function getStatus() {
    return state?.status ?? "idle";
  }

  // steps: how many tracker steps to capture (4/8/16/32/64 — ui/chrome/TransportBar.jsx's
  // dropdown). stepDurationSeconds: the *current* step length, read fresh by the caller
  // (audio/playbackController.js's getStepDurationSeconds) — used only for this synchronous
  // capacity preflight, mirroring webseq's "before starting a capture, show a deterministic
  // error rather than an async refusal" rule. The window actually handed to armCapture() below
  // is computed from the real engine-time stepTime once onStepScheduled fires, never from this
  // estimate, so a live BPM/swing change between arming and the next step boundary can't desync
  // the capture from what's really scheduled.
  function arm(steps, stepDurationSeconds) {
    if (!isPlaying()) return { ok: false, reason: "Nothing is playing." };
    if (state) return { ok: false, reason: "A resample is already in progress." };

    const estimatedSeconds = steps * stepDurationSeconds;
    const capacitySeconds = runtime.getCapabilities().maxCaptureSeconds;
    if (estimatedSeconds > capacitySeconds) {
      return {
        ok: false,
        reason: `${steps} steps is ~${estimatedSeconds.toFixed(1)}s, which exceeds the ${capacitySeconds}s capture capacity.`,
      };
    }

    const result = new Promise((resolve, reject) => {
      state = { steps, status: "armed", resolve, reject };
    });
    return { ok: true, result };
  }

  // Called from audio/lookaheadPlayer.js's tick(), once per step, with that step's own
  // unswung grid time and the current step duration — before its notes are scheduled. If a
  // resample is armed, this call *is* the next not-yet-scheduled step boundary: arm() only ever
  // runs between tick() calls (it's invoked from a UI event handler, and JS is single-threaded),
  // so whichever step onStepScheduled next reports is, by construction, the first one that
  // hadn't been scheduled yet when arm() was called. Capturing from the grid time (not the
  // swing-delayed moment notes actually fire) keeps the result's duration exactly
  // `steps * stepDurationSeconds` regardless of swing — swing only ever shifts odd-indexed
  // steps within a pair and never changes total duration over an even step count (every
  // supported length here is a power of two), so this stays phase-aligned with the tracker grid
  // for a later tile-back onto it.
  function onStepScheduled(stepTime, stepDurationSeconds) {
    if (!state || state.status !== "armed") return;
    const armed = state;
    armed.status = "capturing";
    try {
      const { result } = runtime.armCapture({ startTime: stepTime, stopTime: stepTime + armed.steps * stepDurationSeconds });
      result.then(
        (captured) => {
          if (state === armed) state = null;
          armed.resolve(captured);
        },
        (err) => {
          if (state === armed) state = null;
          armed.reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    } catch (err) {
      state = null;
      armed.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Abandons an armed-but-not-yet-capturing resample (audio/playbackController.js#stop() calls
  // this on every Stop). Once capturing has actually started there's no wire to cancel webdsp's
  // Capture (it runs to completion — see webdsp's ARCHITECTURE.md, "Intentionally deferred" has
  // no cancel either) — this still rejects the caller's promise immediately either way, so
  // armResample() never hangs forever; a late resolve() from an already-running capture is
  // simply ignored (a settled promise can't be re-settled).
  function cancel(reason = "Resample cancelled.") {
    if (!state) return;
    const armed = state;
    state = null;
    armed.reject(new Error(reason));
  }

  return { arm, onStepScheduled, cancel, getStatus };
}
