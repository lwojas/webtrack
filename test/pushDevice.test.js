import { describe, expect, it, vi } from "vitest";
import { createPushDevice } from "../src/midi/push/pushDevice.js";

function createFakePort(name) {
  const listeners = new Map();
  return {
    name,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fireMessage(data) {
      listeners.get("midimessage")?.({ data });
    },
    listenerCount: () => listeners.size,
    send: vi.fn(),
  };
}

function createFakeMidiAccess({ inputs = [], outputs = [] }) {
  const stateChangeListeners = new Set();
  return {
    inputs: new Map(inputs.map((p, i) => [String(i), p])),
    outputs: new Map(outputs.map((p, i) => [String(i), p])),
    addEventListener: (type, fn) => {
      if (type === "statechange") stateChangeListeners.add(fn);
    },
    removeEventListener: (type, fn) => stateChangeListeners.delete(fn),
  };
}

describe("createPushDevice — connects only to the Push's User Port, never the Live Port", () => {
  it("picks the 'User Port' input/output out of several ports by name", async () => {
    const liveIn = createFakePort("Ableton Push Live Port");
    const userIn = createFakePort("Ableton Push User Port");
    const liveOut = createFakePort("Ableton Push Live Port");
    const userOut = createFakePort("Ableton Push User Port");
    const access = createFakeMidiAccess({ inputs: [liveIn, userIn], outputs: [liveOut, userOut] });
    const device = createPushDevice({ requestMIDIAccess: () => Promise.resolve(access) });

    device.attach();
    await vi.waitFor(() => expect(device.isConnected()).toBe(true));

    expect(userIn.listenerCount()).toBe(1);
    expect(liveIn.listenerCount()).toBe(0);

    device.send([1, 2, 3]);
    expect(userOut.send).toHaveBeenCalledWith([1, 2, 3]);
    expect(liveOut.send).not.toHaveBeenCalled();
  });

  it("matches a manufacturer-suffixed name variant, e.g. 'Ableton Push User Port (Akai)'", async () => {
    const userIn = createFakePort("Ableton Push User Port (Akai)");
    const userOut = createFakePort("Ableton Push User Port (Akai)");
    const access = createFakeMidiAccess({ inputs: [userIn], outputs: [userOut] });
    const device = createPushDevice({ requestMIDIAccess: () => Promise.resolve(access) });

    device.attach();
    await vi.waitFor(() => expect(device.isConnected()).toBe(true));
  });

  it("reports not connected when no matching port exists yet", () => {
    const device = createPushDevice({ requestMIDIAccess: () => Promise.resolve(createFakeMidiAccess({})) });
    expect(device.isConnected()).toBe(false);
  });

  it("forwards a raw message from the User input port to onMessage subscribers", async () => {
    const userIn = createFakePort("Ableton Push User Port");
    const access = createFakeMidiAccess({ inputs: [userIn], outputs: [] });
    const device = createPushDevice({ requestMIDIAccess: () => Promise.resolve(access) });
    const onMessage = vi.fn();
    device.onMessage(onMessage);
    device.attach();

    await vi.waitFor(() => expect(userIn.listenerCount()).toBe(1));
    userIn.fireMessage(new Uint8Array([0xb0, 50, 127]));

    expect(onMessage).toHaveBeenCalledWith([0xb0, 50, 127]);
  });

  it("send() is a silent no-op before any output port is connected", () => {
    const device = createPushDevice({ requestMIDIAccess: undefined });
    expect(() => device.send([1, 2, 3])).not.toThrow();
  });
});
