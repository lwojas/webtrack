import { describe, expect, it } from "vitest";
import { createVoiceTracker } from "../src/audio/voiceTracker.js";

// createVoiceTracker() (not the shared `voiceTracker` singleton) so every test gets its own
// isolated instance — the singleton exists purely so production code shares one view of what's
// sounding across lookaheadPlayer.js and preview.js (see that module's doc comment), which is
// exactly the kind of cross-test state leakage a unit test should avoid.
describe("createVoiceTracker — poly", () => {
  it("reserves without releasing anything while under maxVoices", () => {
    const tracker = createVoiceTracker();
    const toRelease = tracker.reserveVoiceSlot(0, { voiceMode: "poly", maxVoices: 4 });
    expect(toRelease).toEqual([]);
    tracker.registerVoice(0, 101);
    expect(tracker.getActiveCount(0)).toBe(1);
  });

  it("steals the oldest voice, FIFO, once the track is already at maxVoices", () => {
    const tracker = createVoiceTracker();
    const config = { voiceMode: "poly", maxVoices: 2 };

    expect(tracker.reserveVoiceSlot(0, config)).toEqual([]);
    tracker.registerVoice(0, 1);
    expect(tracker.reserveVoiceSlot(0, config)).toEqual([]);
    tracker.registerVoice(0, 2);

    // Third trigger while 2 voices (the max) are already active — the oldest (1) gives way.
    const toRelease = tracker.reserveVoiceSlot(0, config);
    expect(toRelease).toEqual([1]);
    tracker.registerVoice(0, 3);

    expect(tracker.getActiveCount(0)).toBe(2); // voices 2 and 3 — 1 was stolen, never counted
  });

  it("never drops a trigger — stealing always leaves room for the new voice", () => {
    const tracker = createVoiceTracker();
    const config = { voiceMode: "poly", maxVoices: 1 };

    expect(tracker.reserveVoiceSlot(0, config)).toEqual([]);
    tracker.registerVoice(0, 1);
    expect(tracker.reserveVoiceSlot(0, config)).toEqual([1]);
    tracker.registerVoice(0, 2);
    expect(tracker.reserveVoiceSlot(0, config)).toEqual([2]);
    tracker.registerVoice(0, 3);

    expect(tracker.getActiveCount(0)).toBe(1);
  });

  it("tracks every track's voice budget independently", () => {
    const tracker = createVoiceTracker();
    tracker.registerVoice(0, 1);
    tracker.registerVoice(0, 2);
    tracker.registerVoice(1, 3);

    expect(tracker.reserveVoiceSlot(0, { voiceMode: "poly", maxVoices: 2 })).toEqual([1]);
    expect(tracker.reserveVoiceSlot(1, { voiceMode: "poly", maxVoices: 2 })).toEqual([]);
  });
});

describe("createVoiceTracker — mono", () => {
  it("releases every currently active voice on the track before the new one", () => {
    const tracker = createVoiceTracker();
    tracker.registerVoice(0, 1);
    tracker.registerVoice(0, 2); // two still-active voices, e.g. left over from a poly session

    const toRelease = tracker.reserveVoiceSlot(0, { voiceMode: "mono", maxVoices: 4 });
    expect(toRelease).toEqual([1, 2]);
    expect(tracker.getActiveCount(0)).toBe(0);

    tracker.registerVoice(0, 3);
    expect(tracker.getActiveCount(0)).toBe(1);
  });

  it("ignores maxVoices entirely while mono", () => {
    const tracker = createVoiceTracker();
    tracker.registerVoice(0, 1);
    const toRelease = tracker.reserveVoiceSlot(0, { voiceMode: "mono", maxVoices: 16 });
    expect(toRelease).toEqual([1]);
  });

  it("is a no-op on an already-silent track", () => {
    const tracker = createVoiceTracker();
    expect(tracker.reserveVoiceSlot(0, { voiceMode: "mono", maxVoices: 4 })).toEqual([]);
  });
});

describe("createVoiceTracker — ending voices", () => {
  it("registerVoice ignores an undefined/null handle rather than tracking a ghost voice", () => {
    const tracker = createVoiceTracker();
    tracker.registerVoice(0, undefined);
    tracker.registerVoice(0, null);
    expect(tracker.getActiveCount(0)).toBe(0);
  });

  it("reset clears every track's bookkeeping (a fresh playback session)", () => {
    const tracker = createVoiceTracker();
    tracker.registerVoice(0, 1);
    tracker.registerVoice(1, 2);
    tracker.reset();
    expect(tracker.getActiveCount(0)).toBe(0);
    expect(tracker.getActiveCount(1)).toBe(0);
  });
});
