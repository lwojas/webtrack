import { describe, expect, it, vi } from "vitest";
import { createMidiDeviceManager } from "../src/midi/deviceManager.js";

function createFakePort(name, overrides = {}) {
  return { id: name, name, manufacturer: "", state: "connected", connection: "open", ...overrides };
}

function createFakeMidiAccess({ inputs = [], outputs = [] }) {
  const stateChangeListeners = new Set();
  return {
    inputs: new Map(inputs.map((p) => [p.id, p])),
    outputs: new Map(outputs.map((p) => [p.id, p])),
    addEventListener: (type, fn) => {
      if (type === "statechange") stateChangeListeners.add(fn);
    },
    removeEventListener: (type, fn) => stateChangeListeners.delete(fn),
    fireStateChange() {
      stateChangeListeners.forEach((fn) => fn());
    },
  };
}

describe("createMidiDeviceManager", () => {
  it("getSnapshot() is not ready before requestAccess() resolves", () => {
    const manager = createMidiDeviceManager({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess({})) });
    expect(manager.getSnapshot()).toEqual({ ready: false, inputs: [], outputs: [] });
  });

  it("lists every input/output port once access resolves, flagging a Push-named port", async () => {
    const access = createFakeMidiAccess({
      inputs: [createFakePort("Ableton Push User Port"), createFakePort("Some Keyboard")],
      outputs: [createFakePort("Ableton Push User Port")],
    });
    const manager = createMidiDeviceManager({ requestMIDIAccess: () => Promise.resolve(access) });

    await manager.requestAccess();
    const snapshot = manager.getSnapshot();

    expect(snapshot.ready).toBe(true);
    expect(snapshot.inputs).toHaveLength(2);
    expect(snapshot.inputs.find((p) => p.name === "Ableton Push User Port").likelyPush).toBe(true);
    expect(snapshot.inputs.find((p) => p.name === "Some Keyboard").likelyPush).toBe(false);
    expect(snapshot.outputs).toHaveLength(1);
  });

  it("requestAccess() is idempotent — a second call doesn't request access again", async () => {
    const requestMIDIAccess = vi.fn(() => Promise.resolve(createFakeMidiAccess({})));
    const manager = createMidiDeviceManager({ requestMIDIAccess });

    await manager.requestAccess();
    await manager.requestAccess();

    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers once access resolves and again on the MIDIAccess's own statechange", async () => {
    const access = createFakeMidiAccess({});
    const manager = createMidiDeviceManager({ requestMIDIAccess: () => Promise.resolve(access) });
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.requestAccess();
    expect(listener).toHaveBeenCalledTimes(1);

    access.fireStateChange();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("resolves to a not-ready snapshot (never throws) when requestMIDIAccess is unavailable", async () => {
    const manager = createMidiDeviceManager({ requestMIDIAccess: undefined });
    await manager.requestAccess();
    expect(manager.getSnapshot()).toEqual({ ready: false, inputs: [], outputs: [] });
  });
});
