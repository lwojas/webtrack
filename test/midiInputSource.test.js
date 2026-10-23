import { describe, expect, it, vi } from "vitest";
import { createMidiNoteSource } from "../src/input/midiInputSource.js";

// A fake Web MIDI input port — just enough of MIDIInput's shape (addEventListener/
// removeEventListener for "midimessage", plus a way for the test to fire one) for
// midiInputSource.js to wire against, same "fake the dependency, not the browser" convention
// test/lookaheadPlayer.test.js's fake runtime uses.
function createFakeInput() {
  const listeners = new Map();
  return {
    type: "input",
    state: "connected",
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fireMessage(data) {
      listeners.get("midimessage")?.({ data });
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function createFakeMidiAccess(initialInputs = []) {
  const stateChangeListeners = new Set();
  return {
    inputs: { forEach: (fn) => initialInputs.forEach(fn) },
    addEventListener: (type, fn) => {
      if (type === "statechange") stateChangeListeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === "statechange") stateChangeListeners.delete(fn);
    },
    fireStateChange(port) {
      stateChangeListeners.forEach((fn) => fn({ port }));
    },
  };
}

describe("createMidiNoteSource", () => {
  it("emits noteOn with channel for a Note On message", async () => {
    const input = createFakeInput();
    const access = createFakeMidiAccess([input]);
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.resolve(access) });

    const onNoteOn = vi.fn();
    source.onNoteOn(onNoteOn);
    const detach = source.attach();

    await vi.waitFor(() => expect(input.listenerCount()).toBe(1));
    input.fireMessage([0x91, 60, 100]); // Note On, channel 1 (status low nibble = 1)

    expect(onNoteOn).toHaveBeenCalledWith({ note: 60, velocity: 100, channel: 1 });
    detach();
  });

  it("emits noteOff for a real Note Off message", async () => {
    const input = createFakeInput();
    const access = createFakeMidiAccess([input]);
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.resolve(access) });

    const onNoteOff = vi.fn();
    source.onNoteOff(onNoteOff);
    source.attach();

    await vi.waitFor(() => expect(input.listenerCount()).toBe(1));
    input.fireMessage([0x80, 60, 0]); // Note Off, channel 0

    expect(onNoteOff).toHaveBeenCalledWith({ note: 60, channel: 0 });
  });

  it("treats a Note On with velocity 0 as a note off (running-status idiom)", async () => {
    const input = createFakeInput();
    const access = createFakeMidiAccess([input]);
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.resolve(access) });

    const onNoteOn = vi.fn();
    const onNoteOff = vi.fn();
    source.onNoteOn(onNoteOn);
    source.onNoteOff(onNoteOff);
    source.attach();

    await vi.waitFor(() => expect(input.listenerCount()).toBe(1));
    input.fireMessage([0x90, 72, 0]);

    expect(onNoteOn).not.toHaveBeenCalled();
    expect(onNoteOff).toHaveBeenCalledWith({ note: 72, channel: 0 });
  });

  it("wires an input that connects later via a statechange event", async () => {
    const access = createFakeMidiAccess([]); // nothing plugged in yet
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onNoteOn = vi.fn();
    source.onNoteOn(onNoteOn);
    source.attach();

    const lateInput = createFakeInput();
    await vi.waitFor(() => {
      access.fireStateChange(lateInput);
      expect(lateInput.listenerCount()).toBe(1);
    });

    lateInput.fireMessage([0x90, 64, 90]);
    expect(onNoteOn).toHaveBeenCalledWith({ note: 64, velocity: 90, channel: 0 });
  });

  it("detach() unwires every input, so a later message is no longer reported", async () => {
    const input = createFakeInput();
    const access = createFakeMidiAccess([input]);
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onNoteOn = vi.fn();
    source.onNoteOn(onNoteOn);
    const detach = source.attach();

    await vi.waitFor(() => expect(input.listenerCount()).toBe(1));
    detach();
    expect(input.listenerCount()).toBe(0);

    input.fireMessage([0x90, 60, 100]);
    expect(onNoteOn).not.toHaveBeenCalled();
  });

  it("attach() is a safe no-op when requestMIDIAccess isn't available (unsupported browser)", () => {
    const source = createMidiNoteSource({ requestMIDIAccess: undefined });
    expect(() => source.attach()()).not.toThrow();
  });

  it("attach() swallows a rejected requestMIDIAccess (denied permission) rather than throwing", async () => {
    const source = createMidiNoteSource({ requestMIDIAccess: () => Promise.reject(new Error("denied")) });
    expect(() => source.attach()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("works again after a detach and re-attach (React StrictMode mounts, unmounts and mounts again in dev)", async () => {
    const input = createFakeInput();
    const source = createMidiNoteSource({ requestMIDIAccess: async () => createFakeMidiAccess([input]) });
    const onNoteOn = vi.fn();
    source.onNoteOn(onNoteOn);

    const detachFirst = source.attach();
    detachFirst(); // StrictMode's simulated unmount, before the access request has even resolved
    source.attach();
    await new Promise((resolve) => setTimeout(resolve, 0));

    input.fireMessage([0x90, 60, 100]);
    expect(onNoteOn).toHaveBeenCalledTimes(1);
  });
});
