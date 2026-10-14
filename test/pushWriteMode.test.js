import { describe, expect, it, vi } from "vitest";
import { createPushWriteMode } from "../src/midi/push/writeMode.js";
import { CC_RECORD, FEEDBACK_DIM, FEEDBACK_FULL_BLINK } from "../src/midi/push/constants.js";

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

const CC_ON = 0xb0;

describe("createPushWriteMode", () => {
  it("paints Record dim on attach while off", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_RECORD, FEEDBACK_DIM]);
  });

  it("pressing CC_RECORD toggles isActive() and flashes the LED full+blink", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_RECORD, 127]);

    expect(writeMode.isActive()).toBe(true);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_RECORD, FEEDBACK_FULL_BLINK]);
  });

  it("pressing CC_RECORD again toggles it back off, dimming the LED", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    device.fireMessage([CC_ON, CC_RECORD, 127]);
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_RECORD, 127]);

    expect(writeMode.isActive()).toBe(false);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_RECORD, FEEDBACK_DIM]);
  });

  it("a CC_RECORD release (value 0) does not toggle it", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();

    device.fireMessage([CC_ON, CC_RECORD, 0]);

    expect(writeMode.isActive()).toBe(false);
  });

  it("notifies onChange listeners with the new active state", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    const listener = vi.fn();
    writeMode.onChange(listener);

    device.fireMessage([CC_ON, CC_RECORD, 127]);
    expect(listener).toHaveBeenCalledWith(true);

    device.fireMessage([CC_ON, CC_RECORD, 127]);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it("an unsubscribed onChange listener stops being notified", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    const listener = vi.fn();
    const unsubscribe = writeMode.onChange(listener);
    unsubscribe();

    device.fireMessage([CC_ON, CC_RECORD, 127]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("refresh() resets the diff cache and repaints the current state", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    writeMode.attach();
    device.fireMessage([CC_ON, CC_RECORD, 127]);
    device.send.mockClear();

    writeMode.refresh();

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_RECORD, FEEDBACK_FULL_BLINK]);
  });

  it("detach dims Record and stops reacting to further presses", () => {
    const device = createFakeDevice();
    const writeMode = createPushWriteMode({ device });
    const detach = writeMode.attach();
    device.fireMessage([CC_ON, CC_RECORD, 127]);
    device.send.mockClear();

    detach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_RECORD, FEEDBACK_DIM]);

    const listener = vi.fn();
    writeMode.onChange(listener);
    device.fireMessage([CC_ON, CC_RECORD, 127]);
    expect(listener).not.toHaveBeenCalled();
  });
});
