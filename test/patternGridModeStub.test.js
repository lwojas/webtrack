import { describe, expect, it, vi } from "vitest";
import { createPatternGridModeStub } from "../src/midi/push/patternGridModeStub.js";
import { RAW } from "../src/midi/push/colors.js";

describe("createPatternGridModeStub — Pattern view placeholder", () => {
  it("turns off all 64 pads on enter", () => {
    const device = { send: vi.fn() };
    const stub = createPatternGridModeStub({ device });

    stub.onEnter();

    expect(device.send).toHaveBeenCalledTimes(64);
    expect(device.send.mock.calls.every(([bytes]) => bytes[0] === 0x90 && bytes[2] === RAW.OFF)).toBe(true);
  });

  it("a pad press is a no-op (nothing to dispatch to)", () => {
    const device = { send: vi.fn() };
    const stub = createPatternGridModeStub({ device });
    device.send.mockClear();

    expect(() => stub.onPadOn(0, 0, 100)).not.toThrow();
    expect(() => stub.onPadOff(0, 0)).not.toThrow();
    expect(device.send).not.toHaveBeenCalled();
  });
});
