import { initRuntime, ensureTrackBuses, getRuntime, peekRuntime } from "./runtime.js";
import { createLookaheadPlayer } from "./lookaheadPlayer.js";
import { createResampleController } from "./resampleController.js";
import { compileRow, compileRowFx, compileRowAutomation } from "./compile.js";
import { setTrackFxParam, setTrackFxInstanceParam, getTrackEffectId, resolveNodeParam } from "./fx.js";
import { resolveInstrumentParam, setSynthInstrumentParam } from "./instrument.js";
import { resolveEnvelopeParam, setInstrumentEnvelope } from "./instrumentEnvelope.js";
import { createAutomationScheduler } from "./automation.js";
import { fxKey, getBaseValue, instKey } from "../model/cellAutomation.js";
import { voiceTracker } from "./voiceTracker.js";
import { hostBeatAt } from "webdsp";
import { STEPS_PER_BEAT } from "../model/timing.js";
import { trackLocalStep } from "../model/pattern.js";
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
  getSwing,
  onTransportChange,
  onPatternSwitchPending,
  // Called whenever a cell's FX automation latches in during playback (audio/compile.js's
  // compileRowFx, via lookaheadPlayer.js's tick()) — appContext.js wires this to the store
  // mutation that keeps trackChannel.fx (and the FX panel, if it's open on that track) in sync
  // with whatever's actually sounding. The real engine call (runtime.setNodeParameter) happens
  // unconditionally below, whether or not a caller even supplies this.
  onTrackFxChange,
}) {
  let player = null;
  // Cell automation of FX instances and instrument slots (audio/automation.js): scheduled on the
  // audio clock as base-value writes, restored to the model's authored values on stop.
  let trackBusIdsForAutomation = [];
  const automation = createAutomationScheduler(
    () => runtimeForAutomation,
    () => ({
      trackBusIds: trackBusIdsForAutomation,
      instruments: getInstruments(),
      effectId: getTrackEffectId,
      nodeParam: resolveNodeParam,
      instrumentParam: resolveInstrumentParam,
      sampleParam: resolveEnvelopeParam,
    }),
    {
      fx: (trackIndex, instanceId, paramId, value) => setTrackFxInstanceParam(trackIndex, instanceId, paramId, value),
      instrument: (slot, paramId, value) => {
        const instrument = getInstruments()[slot];
        if (instrument?.output?.type === "instrument" && instrument.output.kind) setSynthInstrumentParam(instrument, instrument.output.kind, paramId, value);
        else if (instrument?.sampleId != null) setInstrumentEnvelope(instrument.sampleId, { [paramId]: value });
      },
    },
  );
  let runtimeForAutomation = null;
  // Lazily created alongside player, in play() below, for the same reason: both need the
  // resolved runtime object, which only exists once initRuntime() has resolved.
  let resampleController = null;

  // The tempo of an external clock this transport is following (audio/hostSync.js), or null when it plays on
  // its own, at the song's BPM. Cleared by every stop.
  let hostBpm = null;

  // Non-null while the host plays the song itself (audio/nativeSequence.js; webdsp's runtime.setSequence): nothing is scheduled from here, this
  // controller only reports the position the host's transport maps to, for the playheads. The runtime is cached for the playhead reads, which are
  // synchronous.
  let hosted = null;
  let hostedRuntime = null;

  // The queue entry and row the host is at right now, from its mapping.
  function hostedPosition() {
    const step = hostBeatAt(hosted, hostedRuntime.getCurrentTime()) * STEPS_PER_BEAT;
    return positionAtStep(step);
  }

  function getStepDurationSeconds() {
    return 60 / (hostBpm ?? getBpm()) / STEPS_PER_BEAT;
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

  // The host plays the song itself: stop scheduling from here and just follow its position (`t` maps engine time to the host's position;
  // pass the newest whenever it changes). While attached, play/stop do nothing (the host owns the transport) and resample is refused.
  function attachHost(t) {
    const runtime = peekRuntime(); // synchronous on purpose: a host stop right after a start must find it attached
    if (!runtime) return;
    if (!hosted && player?.isPlaying()) {
      resampleController?.cancel("Resample cancelled: the host took over playback.");
      player.stop();
    }
    hostedRuntime = runtime;
    const wasHosted = hosted !== null;
    hosted = t;
    hostBpm = t.bpm;
    if (!wasHosted) onTransportChange?.({ playing: true, hostBpm });
  }

  function detachHost() {
    if (!hosted) return;
    hosted = null;
    hostBpm = null;
    onTransportChange?.({ playing: false, hostBpm: null });
  }

  async function play() {
    if (hosted) return;
    hostBpm = null;
    await start(initialQueueEntry(), {});
  }

  // Maps a step count from the start of the pattern queue (wrapping around the queue) to the queue entry
  // and row it falls on.
  function positionAtStep(step) {
    const entries = getPatternQueueEntries(getSong());
    const total = entries.reduce((sum, entry) => sum + entry.pattern.rowCount, 0);
    if (entries.length === 0 || total <= 0 || !Number.isFinite(step)) return { entry: initialQueueEntry(), row: 0 };
    let within = ((step % total) + total) % total;
    for (let i = 0; i < entries.length; i++) {
      const rows = entries[i].pattern.rowCount;
      if (within < rows) return { entry: { pattern: entries[i].pattern, queueIndex: i }, row: within };
      within -= rows;
    }
    return { entry: initialQueueEntry(), row: 0 };
  }

  // Starts (or restarts) playback so queue step `step` sounds at engine time `at`, at `bpm` quarter notes per
  // minute: what following an external clock needs. `at` is clamped to just after now. The song's own BPM is
  // not touched. A running transport is stopped first.
  async function playAt(step, at, bpm) {
    const runtime = await initRuntime();
    stop();
    hostBpm = bpm;
    const { entry, row } = positionAtStep(step);
    await start(entry, { startAt: Math.max(at, runtime.getCurrentTime() + 0.03), initialRow: row });
  }

  async function start({ pattern, queueIndex }, { startAt, initialRow } = {}) {
    const runtime = await initRuntime();
    // Allocated once, up front — every tick needs trackBusIds synchronously (to route note
    // voices into the right bus, audio/compile.js#compileRow), so it can't be resolved lazily
    // per-call the way audio/fx.js's own setTrackFxParam resolves it for a one-off FX panel
    // tweak. Both end up sharing the exact same array either way (audio/runtime.js's own
    // module-level cache), so a track's bus id is never allocated twice.
    const trackBusIds = await ensureTrackBuses(getSong().trackCount);
    runtimeForAutomation = runtime;
    trackBusIdsForAutomation = trackBusIds;
    if (!player) {
      player = createLookaheadPlayer({
        runtime,
        compileRow,
        compileRowFx,
        compileRowAutomation,
        trackBusIds,
        getStepDurationSeconds,
        getSwing,
        onPatternSwitched: () => onPatternSwitchPending?.(false),
        getNextQueueEntry: (currentIndex) => resolveQueueEntry(currentIndex + 1),
        // bus.gain is the one cell FX entry with no scheduled form (webdsp's scheduleParams does
        // not cover bus parameters), so it still latches at the tick: engine call plus the model
        // update that keeps the FX panel's output slider in step. Every other entry (FX instance
        // parameters, instrument parameters) goes through onAutomation below instead: scheduled on
        // the audio clock, never written into the model while playing.
        onTrackFxChange: (trackIndex, instanceId, paramId, value) => {
          if (instanceId !== null) return;
          setTrackFxParam(trackIndex, paramId, value);
          onTrackFxChange?.(trackIndex, instanceId, paramId, value);
        },
        onAutomation: (items, time) => automation.schedule(items, time),
        onStepScheduled: (stepTime, stepDuration) => resampleController?.onStepScheduled(stepTime, stepDuration),
      });
    }
    if (!resampleController) {
      resampleController = createResampleController({ runtime, isPlaying: () => player.isPlaying() });
    }
    player.start({
      initialPattern: pattern,
      initialQueueIndex: queueIndex,
      initialTrackChannels: getTrackChannels(),
      initialInstruments: getInstruments(),
      startAt,
      initialRow,
    });
    onTransportChange?.({ playing: true, hostBpm });
  }

  function stop() {
    if (hosted) return;
    resampleController?.cancel("Resample cancelled: playback stopped.");
    player?.stop();
    // After player.stop() (which cancels what is still queued in the engine): put every parameter
    // automation moved back to its authored value. A direct write also ends any ramp still running.
    const instruments = getInstruments();
    automation.restoreBase((item) => {
      const channel = getTrackChannels()[item.trackIndex];
      return item.kind === "fx"
        ? getBaseValue(fxKey(item.instanceId, item.paramId), channel, instruments)
        : getBaseValue(instKey(item.slot, item.paramId), channel, instruments);
    });
    hostBpm = null;
    onTransportChange?.({ playing: false, hostBpm: null });
  }

  // ui/chrome/TransportBar.jsx's Resample button, via appContext.js's handleResample — see
  // audio/resampleController.js's own doc comment for the arm/capture flow. Refused
  // synchronously (no resampleController yet, since play() hasn't run) before playback has ever
  // started once.
  function armResample(steps) {
    if (hosted) return { ok: false, reason: "The host is playing the song; resampling needs this page to play it." };
    if (!resampleController) return { ok: false, reason: "Nothing is playing." };
    return resampleController.arm(steps, getStepDurationSeconds());
  }

  function getResampleStatus() {
    return resampleController?.getStatus() ?? "idle";
  }

  // While playing, the switch is deferred to the next loop boundary (see lookaheadPlayer.js),
  // which reports back via onPatternSwitched once it actually takes effect. While stopped,
  // there's nothing to defer — the next play() call reads the song fresh, so the switch is
  // already effectively immediate and there's no pending state to report. Also resyncs the
  // player's queueIndex to wherever newPattern sits in the live queue, so auto-advance keeps
  // making sense afterward; if newPattern isn't queued at all (e.g. a just-duplicated pattern
  // that hasn't been queued yet), the queueIndex is left as-is.
  function switchPattern(newPattern) {
    if (hosted || !player?.isPlaying()) return;
    const entries = getPatternQueueEntries(getSong());
    const matchIndex = entries.findIndex((entry) => entry.patternId === newPattern.id);
    const queueIndex = matchIndex === -1 ? player.getQueueIndex() : matchIndex;
    player.requestPatternSwitch(newPattern, queueIndex);
    onPatternSwitchPending?.(true);
  }

  function isPlaying() {
    return hosted !== null || (player?.isPlaying() ?? false);
  }

  // Stops whatever's already sounding on any track that mute/solo just made inaudible.
  // audio/compile.js#compileRow's mute/solo gate is compile-time-only — it keeps a gated
  // track's *next* note from being scheduled, but has no way to reach back and silence a
  // voice already handed to the engine (runtime.schedule()/trigger()), which otherwise just
  // rings on until it ends naturally or the track's next retrigger falls on a gated row —
  // for a long/sustained note, that can look like "mute doesn't work until the pattern
  // loops." Called from appContext.js on every TRACK_CHANNEL_CHANGED (mute, solo, or
  // otherwise) — recomputing the full audibility set each time and releasing only what's
  // actually gated keeps this correct regardless of which field changed, and releasing an
  // already-empty track is just a no-op. A no-op entirely while stopped.
  function syncTrackMuting() {
    if (hosted || !player?.isPlaying()) return;
    const channels = getTrackChannels();
    const soloActive = channels.some((channel) => channel.solo);
    channels.forEach((channel, trackIndex) => {
      const audible = !channel.muted && (!soloActive || channel.solo);
      if (audible) return;
      const handles = voiceTracker.releaseTrack(trackIndex);
      if (handles.length === 0) return;
      getRuntime().then((runtime) => handles.forEach((handle) => runtime.release(handle)));
    });
  }

  function getPlayheadRow() {
    if (hosted) return hostedPosition().row;
    return player?.getPlayheadRow() ?? -1;
  }

  // One track's own local playhead row (model/pattern.js#trackLocalStep) — what
  // ui/grid/playheadLayer.js draws per track column instead of one shared row.
  function getTrackPlayheadRow(trackIndex) {
    if (hosted) {
      const { entry, row } = hostedPosition();
      const track = entry.pattern.tracks[trackIndex];
      return track ? trackLocalStep(track, row) : -1;
    }
    return player?.getTrackPlayheadRow(trackIndex) ?? -1;
  }

  // The queue entry actually sounding right now — ui/chrome/PatternManager.jsx's playing
  // highlight polls this (see its own doc comment for why a poll, not a store event).
  function getPlayingQueueIndex() {
    if (hosted) return hostedPosition().entry.queueIndex;
    return player?.getQueueIndex() ?? -1;
  }

  return {
    play,
    playAt,
    attachHost,
    detachHost,
    stop,
    switchPattern,
    isPlaying,
    getPlayheadRow,
    getTrackPlayheadRow,
    getPlayingQueueIndex,
    syncTrackMuting,
    armResample,
    getResampleStatus,
  };
}
