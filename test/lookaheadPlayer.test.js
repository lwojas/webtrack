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
    cancelScheduled: vi.fn(),
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
