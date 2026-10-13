import { describe, expect, it, vi, afterEach } from "vitest";
import { createMidiOutput } from "../src/audio/midiOutput.js";

function createFakeMidiAccess(outputList = []) {
  const outputs = new Map(outputList.map((output, i) => [String(i), output]));
  return { outputs, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

// Flushes the microtask queue so createMidiOutput's ensureConnected() promise chain resolves
// before fake timers (a separate, macrotask-only mechanism) are advanced — same two-step
// "await a resolved promise, then advance timers" shape test/midiInputSource.test.js's
// vi.waitFor-based attach() tests need for their own async requestMIDIAccess.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createMidiOutput — scheduleNoteEvents", () => {
  it("sends Note On at the event's own delay-from-now, then Note Off at time+duration", async () => {
    vi.useFakeTimers();
    const output = { send: vi.fn() };
    const midiOutput = createMidiOutput({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess([output])) });

    midiOutput.scheduleNoteEvents([{ kind: "midi", channel: 1, note: 60, velocity: 100, time: 5, duration: 0.5 }], 4);
    await flushMicrotasks();

    vi.advanceTimersByTime(999);
    expect(output.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // 1000ms from now = time 5, given currentTime 4
    expect(output.send).toHaveBeenCalledWith([0x91, 60, 100]);
    expect(output.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(499);
    expect(output.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1); // 1500ms from now = time 5.5 (5 + duration 0.5)
    expect(output.send).toHaveBeenCalledWith([0x81, 60, 0]);
    expect(output.send).toHaveBeenCalledTimes(2);
  });

  it("sends immediately (no negative delay) for an event whose time has already passed", async () => {
    vi.useFakeTimers();
    const output = { send: vi.fn() };
    const midiOutput = createMidiOutput({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess([output])) });

    midiOutput.scheduleNoteEvents([{ kind: "midi", channel: 0, note: 60, velocity: 100, time: 1, duration: 0.1 }], 4);
    await flushMicrotasks();

    vi.advanceTimersByTime(0);
    expect(output.send).toHaveBeenCalledWith([0x90, 60, 100]);
  });

  it("broadcasts to every currently connected output port", async () => {
    vi.useFakeTimers();
    const outputA = { send: vi.fn() };
    const outputB = { send: vi.fn() };
    const midiOutput = createMidiOutput({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess([outputA, outputB])) });

    midiOutput.scheduleNoteEvents([{ kind: "midi", channel: 0, note: 60, velocity: 100, time: 0, duration: 0.1 }], 0);
    await flushMicrotasks();
    vi.advanceTimersByTime(0);

    expect(outputA.send).toHaveBeenCalledWith([0x90, 60, 100]);
    expect(outputB.send).toHaveBeenCalledWith([0x90, 60, 100]);
  });

  it("cancelScheduled() stops every still-pending Note On/Off from ever firing", async () => {
    vi.useFakeTimers();
    const output = { send: vi.fn() };
    const midiOutput = createMidiOutput({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess([output])) });

    midiOutput.scheduleNoteEvents([{ kind: "midi", channel: 0, note: 60, velocity: 100, time: 5, duration: 0.5 }], 4);
    await flushMicrotasks();
    midiOutput.cancelScheduled();

    vi.advanceTimersByTime(10000);
    expect(output.send).not.toHaveBeenCalled();
  });

  it("does nothing (no throw) when requestMIDIAccess isn't available", () => {
    const midiOutput = createMidiOutput({ requestMIDIAccess: undefined });
    expect(() => midiOutput.scheduleNoteEvents([{ kind: "midi", channel: 0, note: 60, velocity: 100, time: 0, duration: 0.1 }], 0)).not.toThrow();
  });
});

describe("createMidiOutput — sendImmediateNoteOn", () => {
  it("sends right away (once connected), with no matching Note Off ever scheduled", async () => {
    const output = { send: vi.fn() };
    const midiOutput = createMidiOutput({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess([output])) });

    // The very first call also kicks off the (async) requestMIDIAccess connection — same
    // "may legitimately no-op until the connection resolves" shape as every other lazy-connect
    // pattern in this codebase (e.g. audio/voiceTracker.js's ensureVoiceEndedWired). By the
    // second call, the microtask flush below has let it resolve.
    midiOutput.sendImmediateNoteOn(2, 64, 90);
    await flushMicrotasks();

    midiOutput.sendImmediateNoteOn(2, 64, 90);
    expect(output.send).toHaveBeenCalledWith([0x92, 64, 90]);
    expect(output.send).toHaveBeenCalledTimes(1);
  });
});
