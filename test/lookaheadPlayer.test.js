import { describe, expect, it, vi, afterEach } from "vitest";
import { createLookaheadPlayer } from "../src/audio/lookaheadPlayer.js";

// A faked webdsp AudioRuntime, same convention test/controlRegistry.test.js uses for a faked
// playbackController — drive the player against a controllable clock rather than a real
// AudioContext. `advance()` moves the clock the player reads its timing truth from
// (runtime.getCurrentTime()), independent of whatever timer actually calls tick().
function createFakeRuntime(initialTime = 0) {
  let time = initialTime;
  return {
    getCurrentTime: () => time,
    schedule: vi.fn(),
    release: vi.fn(),
    cancelScheduled: vi.fn(),
    instrumentNoteOn: vi.fn(),
    advance(seconds) {
      time += seconds;
    },
  };
}

function makePattern({ rowCount = 16, trackLengths = [4, 4] } = {}) {
  return {
    id: 0,
    rowCount,
    tracks: trackLengths.map((length) => ({
      length,
      events: Array.from({ length: rowCount }, () => ({ note: null, instrument: null })),
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createLookaheadPlayer — one shared transport, independent per-track playheads", () => {
  it("getTrackPlayheadRow folds the exact same transport step into each track's own length", () => {
    const runtime = createFakeRuntime();
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 3] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    runtime.advance(5); // shared transport step 5

    expect(player.getTrackPlayheadRow(0)).toBe(5 % 4); // 1 — wraps every 4 steps
    expect(player.getTrackPlayheadRow(1)).toBe(5 % 3); // 2 — wraps every 3 steps, independently

    player.stop();
  });

  it("a track's playhead keeps wrapping on its own length past where a shorter track already wrapped twice", () => {
    const runtime = createFakeRuntime();
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ rowCount: 16, trackLengths: [3, 16] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    runtime.advance(7); // track 0 (length 3) has wrapped twice (steps 0-2, 3-5) and is on its 3rd pass

    expect(player.getTrackPlayheadRow(0)).toBe(7 % 3); // 1
    expect(player.getTrackPlayheadRow(1)).toBe(7 % 16); // 7 — same absolute step, un-wrapped

    player.stop();
  });

  it("compileRow is called with the raw shared transport step, not a per-track row", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const steps = [];
    const compileRow = vi.fn((_pattern, _trackChannels, _instruments, transportStep) => {
      steps.push(transportStep);
      return [];
    });
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 3] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    runtime.advance(1);
    vi.advanceTimersByTime(25);
    runtime.advance(1);
    vi.advanceTimersByTime(25);

    expect(steps).toEqual([0, 1, 2]);

    player.stop();
  });

  it("drives every track off exactly one setInterval, regardless of track count", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const runtime = createFakeRuntime();
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 3, 7, 16, 2] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    player.stop();
    setIntervalSpy.mockRestore();
  });

  it("resets every track's phase to 0 at a pattern transition (queue auto-advance), while the shared transport keeps counting up", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const patternA = makePattern({ rowCount: 4, trackLengths: [16, 12, 7] });
    const patternB = makePattern({ rowCount: 4, trackLengths: [16, 12, 7] });
    const getNextQueueEntry = vi.fn((currentIndex) => ({ pattern: patternB, queueIndex: currentIndex + 1 }));
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      getStepDurationSeconds: () => 1,
      getNextQueueEntry,
    });

    player.start({ initialPattern: patternA, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    runtime.advance(4); // patternA's own rowCount (4) elapses — queue auto-advances to patternB
    vi.advanceTimersByTime(25); // let the tick loop actually process the boundary at step 4

    expect(getNextQueueEntry).toHaveBeenCalledWith(0);
    // Every track starts patternB at its own loop's beginning, not wherever the absolute
    // transport step (4) would have landed each of them (4 % 16, 4 % 12, 4 % 7).
    expect(player.getTrackPlayheadRow(0)).toBe(0);
    expect(player.getTrackPlayheadRow(1)).toBe(0);
    expect(player.getTrackPlayheadRow(2)).toBe(0);

    runtime.advance(3); // 3 steps into patternB — the shared transport step is now 7
    expect(player.getTrackPlayheadRow(0)).toBe(3 % 16);
    expect(player.getTrackPlayheadRow(1)).toBe(3 % 12);
    expect(player.getTrackPlayheadRow(2)).toBe(3 % 7);

    player.stop();
  });

  it("resets phase on every loop boundary even when the queue loops back into the same pattern", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const pattern = makePattern({ rowCount: 4, trackLengths: [7] });
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      getStepDurationSeconds: () => 1,
      getNextQueueEntry: (currentIndex) => ({ pattern, queueIndex: currentIndex }),
    });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    runtime.advance(4); // one full pass of the 4-row pattern — loops back into itself
    vi.advanceTimersByTime(25);

    expect(player.getTrackPlayheadRow(0)).toBe(0); // not 4 % 7

    player.stop();
  });

  it("calls onTrackFxChange for every cell-fx entry compileRowFx reports at the row being scheduled", () => {
    const runtime = createFakeRuntime();
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 4] });
    const compileRowFx = vi.fn((_pattern, transportStep) =>
      transportStep === 0 ? [{ trackIndex: 0, instanceId: 7, paramId: "filter.cutoff", value: 1200 }] : [],
    );
    const changes = [];
    const onTrackFxChange = vi.fn((trackIndex, instanceId, paramId, value) => changes.push({ trackIndex, instanceId, paramId, value }));
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      compileRowFx,
      getStepDurationSeconds: () => 1,
      onTrackFxChange,
    });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });

    expect(changes).toEqual([{ trackIndex: 0, instanceId: 7, paramId: "filter.cutoff", value: 1200 }]);

    player.stop();
  });

  it("never calls compileRowFx when no onTrackFxChange callback was given", () => {
    const runtime = createFakeRuntime();
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 4] });
    const compileRowFx = vi.fn(() => []);
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], compileRowFx, getStepDurationSeconds: () => 1 });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });

    expect(compileRowFx).not.toHaveBeenCalled();

    player.stop();
  });

  it("swing delays the scheduled time of odd steps but never changes which row/step is compiled", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const times = [];
    const steps = [];
    const compileRow = vi.fn((_pattern, _trackChannels, _instruments, transportStep, time) => {
      steps.push(transportStep);
      times.push(time);
      return [];
    });
    const player = createLookaheadPlayer({
      runtime,
      compileRow,
      getStepDurationSeconds: () => 1,
      getSwing: () => 100, // maximum: odd steps delayed by 1/3 of a step
    });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    for (let i = 0; i < 4; i++) {
      runtime.advance(1);
      vi.advanceTimersByTime(25);
    }

    // The logical/compiled step sequence is untouched by swing.
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    // Even steps land exactly on the logical grid; odd steps are pushed later by 1/3 step.
    expect(times).toEqual([0, 1 + 1 / 3, 2, 3 + 1 / 3, 4]);

    player.stop();
  });

  it("swing of 0 schedules every step exactly on the logical grid, same as no swing at all", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const times = [];
    const compileRow = vi.fn((_pattern, _trackChannels, _instruments, _transportStep, time) => {
      times.push(time);
      return [];
    });
    const player = createLookaheadPlayer({
      runtime,
      compileRow,
      getStepDurationSeconds: () => 1,
      getSwing: () => 0,
    });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    for (let i = 0; i < 4; i++) {
      runtime.advance(1);
      vi.advanceTimersByTime(25);
    }

    expect(times).toEqual([0, 1, 2, 3, 4]);

    player.stop();
  });

  it("onStepScheduled reports each step's unswung grid time, never the swing-delayed scheduledTime (audio/resampleController.js's own capture window depends on this)", () => {
    vi.useFakeTimers();
    const runtime = createFakeRuntime();
    const reported = [];
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      getStepDurationSeconds: () => 1,
      getSwing: () => 100, // maximum swing — would expose a bug if this hook read scheduledTime
      onStepScheduled: (stepTime, stepDuration) => reported.push([stepTime, stepDuration]),
    });
    const pattern = makePattern({ rowCount: 16, trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    for (let i = 0; i < 3; i++) {
      runtime.advance(1);
      vi.advanceTimersByTime(25);
    }

    expect(reported).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    player.stop();
  });

  it("getTrackPlayheadRow is -1 for an unknown track index or while stopped", () => {
    const runtime = createFakeRuntime();
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    expect(player.getTrackPlayheadRow(0)).toBe(-1); // stopped
    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    expect(player.getTrackPlayheadRow(5)).toBe(-1); // no such track

    player.stop();
  });
});

// Track voice-limit enforcement (model/trackChannel.js's voiceMode/maxVoices) is decided by
// audio/voiceTracker.js, unit-tested on its own (test/voiceTracker.test.js) — these tests only
// cover the *wiring*: that tick() asks it before every schedule() call, actually release()s
// whatever it says to, strips the trackIndex correlation field back off before the engine ever
// sees a compiled event, and registers the handle schedule() hands back against the right
// track. reserveVoiceSlot/registerVoice/resetVoiceTracking are injected fakes here (see
// createLookaheadPlayer's own doc comment on why those are overridable) so none of this touches
// the real app-wide voiceTracker singleton.
describe("createLookaheadPlayer — voice-limit wiring (audio/voiceTracker.js)", () => {
  it("reserves a slot per compiled event, release()s what's returned, then registers the resulting handle against its own track", () => {
    const runtime = createFakeRuntime();
    runtime.schedule = vi.fn(() => [101, 202]);
    const pattern = makePattern({ rowCount: 16, trackLengths: [4, 4] });
    const trackChannels = [
      { voiceMode: "poly", maxVoices: 4 },
      { voiceMode: "mono", maxVoices: 4 },
    ];
    const compileRow = vi.fn(() => [
      { kind: "sample", sampleId: 1, trackIndex: 0 },
      { kind: "sample", sampleId: 2, trackIndex: 1 },
    ]);
    const reserveCalls = [];
    const reserveVoiceSlot = vi.fn((trackIndex, channel) => {
      reserveCalls.push({ trackIndex, channel });
      return trackIndex === 1 ? [999] : [];
    });
    const registerCalls = [];
    const registerVoice = vi.fn((trackIndex, handle) => registerCalls.push({ trackIndex, handle }));

    const player = createLookaheadPlayer({
      runtime,
      compileRow,
      getStepDurationSeconds: () => 1,
      reserveVoiceSlot,
      registerVoice,
      resetVoiceTracking: vi.fn(),
    });

    player.start({ initialPattern: pattern, initialTrackChannels: trackChannels, initialInstruments: [], startAt: 0 });

    expect(reserveCalls).toEqual([
      { trackIndex: 0, channel: trackChannels[0] },
      { trackIndex: 1, channel: trackChannels[1] },
    ]);
    expect(runtime.release).toHaveBeenCalledTimes(1);
    expect(runtime.release).toHaveBeenCalledWith(999);

    // trackIndex only exists for this correlation — webdsp's ScheduledEvent has no such field.
    expect(runtime.schedule).toHaveBeenCalledWith([{ sampleId: 1 }, { sampleId: 2 }]);

    expect(registerCalls).toEqual([
      { trackIndex: 0, handle: 101 },
      { trackIndex: 1, handle: 202 },
    ]);

    player.stop();
  });

  it("resets voice tracking on every start()", () => {
    const runtime = createFakeRuntime();
    const resetVoiceTracking = vi.fn();
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      getStepDurationSeconds: () => 1,
      resetVoiceTracking,
    });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    expect(resetVoiceTracking).toHaveBeenCalledTimes(1);

    player.stop();
  });

  it("never reserves a voice slot or calls schedule when a row compiles no events", () => {
    const runtime = createFakeRuntime();
    const reserveVoiceSlot = vi.fn();
    const player = createLookaheadPlayer({
      runtime,
      compileRow: () => [],
      getStepDurationSeconds: () => 1,
      reserveVoiceSlot,
    });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });

    expect(reserveVoiceSlot).not.toHaveBeenCalled();
    expect(runtime.schedule).not.toHaveBeenCalled();

    player.stop();
  });
});

// compileRow's `kind: "midi"` events (audio/compile.js) route to scheduleMidiEvents instead of
// runtime.schedule() — audio/midiOutput.js's own scheduling/timing is unit-tested separately
// (test/midiOutput.test.js); these tests only cover tick()'s routing/partitioning and that
// stop() cancels both webdsp's and MIDI output's pending work.
describe("createLookaheadPlayer — MIDI output routing (audio/midiOutput.js)", () => {
  it("routes kind: midi events to scheduleMidiEvents, never to runtime.schedule", () => {
    // Default fake runtime (time 0) + startAt 0 + 1s steps keeps tick()'s lookahead loop to
    // exactly one iteration (the same shape every other single-row test in this file relies
    // on), so compileRow/scheduleMidiEvents are each asserted on a single, unambiguous call.
    const runtime = createFakeRuntime();
    runtime.schedule = vi.fn(() => []);
    const compileRow = vi.fn(() => [{ kind: "midi", channel: 2, note: 60, velocity: 100, time: 0, duration: 0.25, trackIndex: 0 }]);
    const scheduleMidiEvents = vi.fn();

    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1, scheduleMidiEvents });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.schedule).not.toHaveBeenCalled();
    expect(scheduleMidiEvents).toHaveBeenCalledTimes(1);
    expect(scheduleMidiEvents).toHaveBeenCalledWith(
      [{ kind: "midi", channel: 2, note: 60, velocity: 100, time: 0, duration: 0.25, trackIndex: 0 }],
      0,
    );

    player.stop();
  });

  it("partitions a mixed row — sample events go to runtime.schedule, midi events to scheduleMidiEvents", () => {
    const runtime = createFakeRuntime();
    runtime.schedule = vi.fn(() => [101]);
    const compileRow = vi.fn(() => [
      { kind: "sample", sampleId: 1, trackIndex: 0 },
      { kind: "midi", channel: 0, note: 48, velocity: 90, time: 0, duration: 0.1, trackIndex: 1 },
    ]);

    const scheduleMidiEvents = vi.fn();
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1, scheduleMidiEvents });
    const pattern = makePattern({ trackLengths: [4, 4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}, {}], initialInstruments: [], startAt: 0 });

    // kind is stripped alongside trackIndex before webdsp ever sees a sample event.
    expect(runtime.schedule).toHaveBeenCalledWith([{ sampleId: 1 }]);
    expect(scheduleMidiEvents).toHaveBeenCalledTimes(1);
    expect(scheduleMidiEvents.mock.calls[0][0]).toEqual([
      { kind: "midi", channel: 0, note: 48, velocity: 90, time: 0, duration: 0.1, trackIndex: 1 },
    ]);

    player.stop();
  });

  it("never calls scheduleMidiEvents for a row with no midi-kind events", () => {
    const runtime = createFakeRuntime();
    const compileRow = vi.fn(() => [{ kind: "sample", sampleId: 1, trackIndex: 0 }]);
    const scheduleMidiEvents = vi.fn();
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1, scheduleMidiEvents });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(scheduleMidiEvents).not.toHaveBeenCalled();

    player.stop();
  });

  it("stop() cancels pending MIDI output sends alongside webdsp's own cancelScheduled", () => {
    const runtime = createFakeRuntime();
    const cancelMidiScheduled = vi.fn();
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1, cancelMidiScheduled });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    player.stop();

    expect(runtime.cancelScheduled).toHaveBeenCalledTimes(1);
    expect(cancelMidiScheduled).toHaveBeenCalledTimes(1);
  });
});

// compileRow's `kind: "instrument"` events (audio/compile.js, e.g. webdsp's Kick) route to
// runtime.instrumentNoteOn() instead of runtime.schedule()/scheduleMidiEvents — each webdsp
// instrument instance is already monophonic/self-stealing engine-side, so unlike sampleEvents
// there's no voice-limit bookkeeping (reserveVoiceSlot/registerVoice) to wire up here.
describe("createLookaheadPlayer — synthesized instrument routing (webdsp Kick etc.)", () => {
  it("routes kind: instrument events to runtime.instrumentNoteOn, never to runtime.schedule", () => {
    const runtime = createFakeRuntime();
    runtime.schedule = vi.fn(() => []);
    const compileRow = vi.fn(() => [{ kind: "instrument", instrumentId: 5, velocity: 0.8, time: 0, trackIndex: 0 }]);

    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.schedule).not.toHaveBeenCalled();
    expect(runtime.instrumentNoteOn).toHaveBeenCalledTimes(1);
    expect(runtime.instrumentNoteOn).toHaveBeenCalledWith(5, { velocity: 0.8, time: 0 });

    player.stop();
  });

  it("omits pan from the call when the compiled event has none", () => {
    const runtime = createFakeRuntime();
    const compileRow = vi.fn(() => [{ kind: "instrument", instrumentId: 5, velocity: 1, time: 0, trackIndex: 0 }]);
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.instrumentNoteOn.mock.calls[0][1]).not.toHaveProperty("pan");

    player.stop();
  });

  it("partitions a mixed row — sample events go to runtime.schedule, instrument events to instrumentNoteOn", () => {
    const runtime = createFakeRuntime();
    runtime.schedule = vi.fn(() => [101]);
    const compileRow = vi.fn(() => [
      { kind: "sample", sampleId: 1, trackIndex: 0 },
      { kind: "instrument", instrumentId: 9, velocity: 0.5, pan: 0.2, time: 0, trackIndex: 1 },
    ]);

    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4, 4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}, {}], initialInstruments: [], startAt: 0 });

    expect(runtime.schedule).toHaveBeenCalledWith([{ sampleId: 1 }]);
    expect(runtime.instrumentNoteOn).toHaveBeenCalledTimes(1);
    expect(runtime.instrumentNoteOn).toHaveBeenCalledWith(9, { velocity: 0.5, pan: 0.2, time: 0 });

    player.stop();
  });

  it("never calls instrumentNoteOn for a row with no instrument-kind events", () => {
    const runtime = createFakeRuntime();
    const compileRow = vi.fn(() => [{ kind: "sample", sampleId: 1, trackIndex: 0 }]);
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.instrumentNoteOn).not.toHaveBeenCalled();

    player.stop();
  });

  // webdsp's InstrumentNoteParams.pitch (semitones on top of the instrument's own tune) —
  // audio/compile.js derives it from event.note - instrument.rootNote; this just confirms the
  // player forwards whatever compileRow already computed, same as it already does for pan.
  it("forwards pitch through to instrumentNoteOn when the compiled event has one — e.g. a Tom fill", () => {
    const runtime = createFakeRuntime();
    const compileRow = vi.fn(() => [{ kind: "instrument", instrumentId: 3, velocity: 1, pitch: 7, time: 0, trackIndex: 0 }]);
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.instrumentNoteOn).toHaveBeenCalledWith(3, { velocity: 1, time: 0, pitch: 7 });

    player.stop();
  });

  it("omits pitch from the call when the compiled event has none", () => {
    const runtime = createFakeRuntime();
    const compileRow = vi.fn(() => [{ kind: "instrument", instrumentId: 5, velocity: 1, time: 0, trackIndex: 0 }]);
    const player = createLookaheadPlayer({ runtime, compileRow, getStepDurationSeconds: () => 1 });
    const pattern = makePattern({ trackLengths: [4] });

    player.start({ initialPattern: pattern, initialTrackChannels: [{}], initialInstruments: [], startAt: 0 });

    expect(runtime.instrumentNoteOn.mock.calls[0][1]).not.toHaveProperty("pitch");

    player.stop();
  });
});
