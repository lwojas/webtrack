import { describe, expect, it, vi } from "vitest";
import { createHostSync } from "../src/audio/hostSync.js";

function setup(hasTransport = true) {
  let now = 10;
  let listener = null;
  const calls = [];
  const playAt = vi.fn((step, at, bpm) => calls.push(`playAt(${step.toFixed(3)}, ${at.toFixed(3)}, ${bpm})`));
  const stop = vi.fn(() => calls.push("stop"));
  const sync = createHostSync({
    runtime: {
      getCurrentTime: () => now,
      getHostTransport: () => null,
      onHostTransport: (fn) => {
        listener = fn;
        return () => (listener = null);
      },
    },
    getTransport: () => (hasTransport ? { playAt, stop } : null),
  });
  const emit = (t) => listener?.({ playing: true, bpm: 120, beat: 0, time: 10.1, loop: null, timeSignature: null, epoch: 1, ...t });
  return { sync, emit, playAt, stop, calls, setNow: (n) => (now = n), setListenerTransport: () => {} };
}

describe("hostSync", () => {
  it("starts on the host's first beat at the host's time and tempo (quarter notes -> tracker steps)", () => {
    const { emit, calls } = setup();
    emit({ beat: 8, time: 10.1, bpm: 120 });
    expect(calls).toEqual(["playAt(32.000, 10.100, 120)"]); // 8 quarter notes = 32 sixteenth steps
  });

  it("when late, starts at the nearest future moment on the host's grid", () => {
    const { emit, calls, setNow } = setup();
    setNow(10.3);
    emit({ beat: 8, time: 10.1, bpm: 120 }); // at = 10.33, beat = 8 + 0.23 * 2 = 8.46 quarters
    expect(calls).toEqual(["playAt(33.840, 10.330, 120)"]);
  });

  it("does not restart on the periodic refresh, but does on a locate and on a tempo change", () => {
    const { emit, playAt } = setup();
    emit({ epoch: 1 });
    emit({ epoch: 1, beat: 0.2, time: 10.2 });
    expect(playAt).toHaveBeenCalledTimes(1);
    emit({ epoch: 2, beat: 64, time: 11 });
    expect(playAt).toHaveBeenCalledTimes(2);
    emit({ epoch: 2, bpm: 140, beat: 65, time: 11.5 });
    expect(playAt).toHaveBeenCalledTimes(3);
  });

  it("stops when the host stops, only if the host started the playback", () => {
    const a = setup();
    a.emit({ epoch: 1 });
    a.emit({ playing: false, epoch: 2 });
    expect(a.stop).toHaveBeenCalledTimes(1);

    const b = setup(); // the host was never playing: a hand-started transport must keep running
    b.emit({ playing: false, epoch: 1 });
    expect(b.stop).not.toHaveBeenCalled();
  });

  it("applies a start that arrived before the transport existed on the next refresh", () => {
    let exists = false;
    let listener = null;
    const playAt = vi.fn();
    createHostSync({
      runtime: { getCurrentTime: () => 0, getHostTransport: () => null, onHostTransport: (fn) => ((listener = fn), () => {}) },
      getTransport: () => (exists ? { playAt, stop: vi.fn() } : null),
    });
    const t = { playing: true, bpm: 120, beat: 0, time: 1, loop: null, timeSignature: null, epoch: 1 };
    listener(t);
    expect(playAt).not.toHaveBeenCalled();
    exists = true;
    listener({ ...t, beat: 0.5, time: 1.25 });
    expect(playAt).toHaveBeenCalledTimes(1);
  });
});

describe("hostSync with a native sequence", () => {
  it("never schedules from the page: it follows the host while it plays and lets go when it stops", () => {
    let listener = null;
    const calls = [];
    const transport = { playAt: vi.fn(), stop: vi.fn(), attachHost: (t) => calls.push(`attach(${t.beat})`), detachHost: () => calls.push("detach") };
    createHostSync({
      runtime: { getCurrentTime: () => 10, getHostTransport: () => null, onHostTransport: (fn) => ((listener = fn), () => (listener = null)) },
      getTransport: () => transport,
      native: true,
    });
    const emit = (t) => listener({ playing: true, bpm: 120, beat: 0, time: 10.1, loop: null, timeSignature: null, epoch: 1, ...t });
    emit({ beat: 8 });
    emit({ beat: 8.5 });
    emit({ playing: false });
    emit({ playing: false }); // a second stop is not a second detach
    expect(calls).toEqual(["attach(8)", "attach(8.5)", "detach"]);
    expect(transport.playAt).not.toHaveBeenCalled();
  });
});
