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
import { STEPS_PER_BEAT, swingDelaySeconds } from "../model/timing.js";
import { voiceTracker } from "./voiceTracker.js";
import { midiOutput } from "./midiOutput.js";

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
  compileRowAutomation = () => [],
  trackBusIds,
  getStepDurationSeconds,
  // Global sequencer swing (model/timing.js#swingDelaySeconds) — a pure scheduling-time
  // adjustment to when a step's events actually fire, read fresh every tick like getBpm's
  // duration is, so changing it live takes effect on the next unscheduled step with no
  // rescheduling. Deliberately optional/defaulted: tests and other callers that don't care
  // about swing never need to know it exists.
  getSwing = () => 0,
  onPatternSwitched,
  getNextQueueEntry,
  onTrackFxChange,
  // Cell automation of FX instances and instrument slots (audio/compile.js#compileRowAutomation),
  // handed over once per step together with that step's (swung) audio time, to be scheduled on the
  // audio clock. When supplied, onTrackFxChange below only sees the bus.gain entry (which has no
  // scheduled form); without it, every FX entry still goes through onTrackFxChange as before.
  onAutomation,
  // Reports each step's own unswung grid time/duration, once per step, right before that
  // step's notes are compiled — audio/resampleController.js's onStepScheduled is what actually
  // uses this (see its own doc comment for why the *grid* time, not the swing-delayed
  // scheduledTime below, is what a resample capture window is built from). Deliberately
  // optional: this file stays agnostic of what "resample" even means, the same way it already
  // doesn't know what onTrackFxChange's caller does with a value.
  onStepScheduled,
  // Overridable for tests; production wiring shares the one app-wide voiceTracker instance
  // with audio/preview.js's manual-audition path (see voiceTracker.js's own doc comment on why
  // that has to be a shared instance, not one scoped to this player).
  reserveVoiceSlot = voiceTracker.reserveVoiceSlot,
  registerVoice = voiceTracker.registerVoice,
  resetVoiceTracking = voiceTracker.reset,
  // Same "shared app-wide singleton, overridable for tests" shape as the voiceTracker
  // functions above — audio/midiOutput.js's own doc comment explains why `kind: "midi"`
  // events need no equivalent voice-tracking of their own.
  scheduleMidiEvents = midiOutput.scheduleNoteEvents,
  cancelMidiScheduled = midiOutput.cancelScheduled,
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
  // The step duration the engine's beat grid was last told about (null = not yet this session).
  let announcedStepDuration = null;

  function tick() {
    const duration = getStepDurationSeconds();
    const horizon = runtime.getCurrentTime() + LOOKAHEAD_SECONDS;

    // Tell webdsp's beat grid where our beats are, so tempo-aware instruments (Pulse's pump and
    // repeat) hit on this sequencer's beats. Step times below are startTime + stepCounter *
    // duration, so a grid anchored at startTime with `duration * STEPS_PER_BEAT` per beat lies
    // exactly on them — including after a live BPM change, which this re-announces (the engine
    // grid is straight: swing moves notes, never the pump). Sent before any notes of this tick.
    if (duration !== announcedStepDuration) {
      runtime.setTempo(60 / (duration * STEPS_PER_BEAT), { anchorTime: startTime });
      announcedStepDuration = duration;
    }

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

      // The logical step time — purely stepCounter * duration, never touched by swing. Swing
      // only ever adjusts the *scheduled* time derived from it below; the logical position
      // (rowIndex, patternRelativeStep, the playhead) stays on this untouched grid, per
      // docs/ARCHITECTURE.md's "logical sequencer position -> ... -> swing adjustment ->
      // event scheduling" flow.
      const stepTime = startTime + stepCounter * duration;
      onStepScheduled?.(stepTime, duration);
      const scheduledTime = stepTime + swingDelaySeconds(stepCounter, duration, getSwing());
      // The pattern-relative position, not the raw stepCounter — compileRow folds it into each
      // track's own loop length (model/pattern.js#trackLocalStep), and it's this, not the raw
      // transport, that should restart at 0 on every new pattern instance.
      const patternRelativeStep = stepCounter - patternStartStep;
      // The Track LFO's clock (audio/trackLfo.js): the same anchor and tempo the engine's beat grid
      // got above, so event LFOs and synth LFOs/Pulse share one timebase. Not reset by pattern
      // switches (the LFO belongs to the track).
      const lfoClock = { anchorTime: startTime, bpm: 60 / (duration * STEPS_PER_BEAT) };
      const events = compileRow(pattern, trackChannels, instruments, patternRelativeStep, scheduledTime, duration, trackBusIds, lfoClock);
      // compileEvent's own `kind` tag (audio/compile.js) splits this row's events three ways:
      // webdsp sample voices (with all the voice-limit bookkeeping below), MIDI output
      // (self-contained — see audio/midiOutput.js's doc comment on why it needs none of that),
      // and webdsp synthesized instruments (self-contained the same way — each instance is
      // already monophonic/self-stealing on the engine side, so there's no equivalent
      // voice-limit bookkeeping to do here either).
      const sampleEvents = events.filter((event) => event.kind === "sample");
      const midiEvents = events.filter((event) => event.kind === "midi");
      const instrumentEvents = events.filter((event) => event.kind === "instrument");

      if (sampleEvents.length > 0) {
        // Voice-limit enforcement (model/trackChannel.js's voiceMode/maxVoices, via
        // audio/voiceTracker.js) happens here, right before scheduling — release()ing whatever
        // the track's policy says must give way for this row's new triggers, in the same tick
        // that starts them. trackIndex rode along on each compiled event (audio/compile.js)
        // purely for this correlation and is stripped below — webdsp's ScheduledEvent has no
        // such field.
        sampleEvents.forEach((event) => {
          const toRelease = reserveVoiceSlot(event.trackIndex, trackChannels[event.trackIndex]);
          toRelease.forEach((handle) => runtime.release(handle));
        });
        const handles = runtime.schedule(sampleEvents.map(({ trackIndex, kind, ...scheduledEvent }) => scheduledEvent)) ?? [];
        sampleEvents.forEach((event, index) => registerVoice(event.trackIndex, handles[index]));
      }

      if (midiEvents.length > 0) scheduleMidiEvents(midiEvents, runtime.getCurrentTime());

      // webdsp's own instrumentNoteOn() is the per-note scheduling primitive here (there's no
      // schedule()-style batch call for instruments — node_modules/webdsp's docs/
      // instruments.md) — `time` sample-accurately schedules it exactly like runtime.schedule()
      // does for sampleEvents above. No voice handle is kept (instrumentNoteOn returns none,
      // and a fresh note on the same instance just restarts it — one instance is one
      // monophonic machine, by webdsp's own design), so there's nothing to register with
      // registerVoice/reserveVoiceSlot the way sample voices need.
      instrumentEvents.forEach((event) => {
        const params = { velocity: event.velocity };
        if (event.time !== undefined) params.time = event.time;
        if (event.pan !== undefined) params.pan = event.pan;
        if (event.pitch !== undefined) params.pitch = event.pitch;
        if (event.chokeGroup !== undefined) params.chokeGroup = event.chokeGroup;
        // Only sustained kinds (Bass) carry one — webdsp releases the note itself, sample-
        // accurately; see audio/compile.js.
        if (event.duration !== undefined) params.duration = event.duration;
        runtime.instrumentNoteOn(event.instrumentId, params);
      });

      // Cell FX automation rides the same tick/lookahead cadence as note scheduling above —
      // see audio/fx.js's doc comment on webdsp's setNodeParameter having no timestamp of its
      // own, unlike schedule()'s sample-accurate ScheduledEvent.time. onTrackFxChange is who
      // actually calls setNodeParameter (wired in audio/playbackController.js); this file never
      // touches NodeParam/bus ids directly, same separation compileRow/trackChannels already
      // keep it at.
      if (onTrackFxChange) {
        const fxChanges = compileRowFx(pattern, patternRelativeStep);
        fxChanges
          .filter(({ instanceId }) => !onAutomation || instanceId === null)
          .forEach(({ trackIndex, instanceId, paramId, value }) => onTrackFxChange(trackIndex, instanceId, paramId, value));
      }
      if (onAutomation) {
        const automation = compileRowAutomation(pattern, patternRelativeStep, duration);
        if (automation.length > 0) onAutomation(automation, scheduledTime);
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
    announcedStepDuration = null;
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
    // Web MIDI's own send() has no cancel (see audio/midiOutput.js's doc comment) — this is
    // the one place that actually works, since MIDI output scheduling never used it.
    cancelMidiScheduled();
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
