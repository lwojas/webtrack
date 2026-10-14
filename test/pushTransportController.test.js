import { describe, expect, it, vi } from "vitest";
import { createPushTransportController } from "../src/midi/push/transportController.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { CC_PLAY, FEEDBACK_DIM, FEEDBACK_FULL } from "../src/midi/push/constants.js";

function createFakeDevice() {
  const listeners = new Set();
  return {
    send: vi.fn(),
    onMessage: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fireMessage(bytes) {
      listeners.forEach((fn) => fn(bytes));
    },
  };
}

function createTestContext(togglePlayback = vi.fn()) {
  const store = createStore({ song: createSong(), instruments: [] });
  const device = createFakeDevice();
  const controller = createPushTransportController({ device, store, togglePlayback });
  return { store, device, controller, togglePlayback };
}

const CC_ON = 0xb0;

describe("createPushTransportController", () => {
  it("paints the Play button dim on attach while stopped", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_DIM]);
  });

  it("paints the Play button full when already playing on attach", () => {
    const { store, device, controller } = createTestContext();
    store.setTransport(true);
    device.send.mockClear();
    controller.attach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_FULL]);
  });

  it("pressing CC_PLAY calls togglePlayback — never a separate play/stop mechanism", () => {
    const { device, controller, togglePlayback } = createTestContext();
    controller.attach();

    device.fireMessage([CC_ON, CC_PLAY, 127]);

    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it("a CC_PLAY release (value 0) does not toggle playback", () => {
    const { device, controller, togglePlayback } = createTestContext();
    controller.attach();

    device.fireMessage([CC_ON, CC_PLAY, 0]);

    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("follows the store's transport state, not just a button-press toggle", () => {
    const { store, device, controller } = createTestContext();
    controller.attach();
    device.send.mockClear();

    store.setTransport(true);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_FULL]);

    device.send.mockClear();
    store.setTransport(false);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_DIM]);
  });

  it("a redundant repaint (state unchanged) sends nothing", () => {
    const { store, device, controller } = createTestContext();
    controller.attach();
    device.send.mockClear();

    store.setTransport(false); // fires the event again with the same value

    expect(device.send).not.toHaveBeenCalled();
  });

  it("refresh() resets the diff cache and repaints from the store's current state", () => {
    const { store, device, controller } = createTestContext();
    store.setTransport(true);
    controller.attach();
    device.send.mockClear();

    controller.refresh();

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_FULL]);
  });

  it("detach dims the Play button and stops reacting to further presses", () => {
    const { store, device, controller, togglePlayback } = createTestContext();
    store.setTransport(true);
    const detach = controller.attach();
    device.send.mockClear();

    detach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_PLAY, FEEDBACK_DIM]);

    device.fireMessage([CC_ON, CC_PLAY, 127]);
    expect(togglePlayback).not.toHaveBeenCalled();
  });
});
