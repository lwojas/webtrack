import { describe, expect, it, vi } from "vitest";
import { createPushEncoderController } from "../src/midi/push/encoderController.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import {
  ENCODER_CC,
  CC_ENCODER_MODE_VOLUME,
  CC_ENCODER_MODE_FX,
  CC_ARROW_LEFT,
  CC_ARROW_RIGHT,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
  lcdSysex,
} from "../src/midi/push/constants.js";

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

function createTestContext() {
  const store = createStore({ song: createSong(), instruments: [] });
  const device = createFakeDevice();
  // A minimal stand-in for appContext.js's real fxController — routes straight to the store,
  // same as the real one does for the model half (the real one also pushes to audio/fx.js,
  // which this test has no reason to exercise).
  const fxController = { setTrackFxParam: (trackIndex, paramId, value) => store.setTrackFxParam(trackIndex, paramId, value) };
  const controller = createPushEncoderController({ device, store, fxController });
  return { store, device, controller };
}

const CC_ON = 0xb0;

describe("createPushEncoderController — mode switching", () => {
  it("defaults to volume mode: CC114 full, CC115 dim", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_VOLUME, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_FX, FEEDBACK_DIM]);
  });

  it("CC115 switches to FX mode, lighting CC115 full and CC114 dim", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_FX, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_VOLUME, FEEDBACK_DIM]);
  });

  it("CC114 switches back to volume mode", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_ENCODER_MODE_VOLUME, 127]);

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_VOLUME, FEEDBACK_FULL]);
  });
});

describe("createPushEncoderController — volume mode", () => {
  it("turning encoder i raises track i's volume, clamped to the control contract's range", () => {
    const { store, device, controller } = createTestContext();
    controller.attach();

    // encoderDelta(40) === 40 (values < 64 are a positive delta) — several turns to clearly move it.
    for (let i = 0; i < 10; i++) device.fireMessage([CC_ON, ENCODER_CC[2], 40]);

    expect(store.getState().song.trackChannels[2].volume).toBeGreaterThan(1.0);
    expect(store.getState().song.trackChannels[2].volume).toBeLessThanOrEqual(1.5);
  });

  it("turning the encoder down clamps at 0, never negative", () => {
    const { store, controller, device } = createTestContext();
    controller.attach();

    // encoderDelta(100) === 100 - 128 === -28 (values >= 64 are value - 128, a negative delta).
    for (let i = 0; i < 20; i++) device.fireMessage([CC_ON, ENCODER_CC[0], 100]);

    expect(store.getState().song.trackChannels[0].volume).toBe(0);
  });

  it("paints the LCD header as VOLUME", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "VOLUME"));
  });
});

describe("createPushEncoderController — FX mode", () => {
  function enterFxMode(device, controller) {
    controller.attach();
    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);
  }

  it("shows an empty-state header when the selected track has no FX enabled", () => {
    const { device, controller } = createTestContext();
    enterFxMode(device, controller);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  (no FX enabled)  TRK1"));
  });

  it("turning an encoder changes the current FX module's continuous parameter", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter"); // filter.cutoff, filter.resonance, filter.mode, in that order
    enterFxMode(device, controller);
    const before = store.getState().song.trackChannels[0].fx["filter.cutoff"];
    expect(before).toBe(20000); // the catalog default, which is also filter.cutoff's max

    // encoderDelta(100) === 100 - 128 === -28 (a negative delta) — default sits at the max, so
    // only a downward turn is guaranteed to actually move it.
    device.fireMessage([CC_ON, ENCODER_CC[0], 100]); // encoder 0 -> filter.cutoff

    expect(store.getState().song.trackChannels[0].fx["filter.cutoff"]).toBeLessThan(before);
  });

  it("turning the boolean filter.mode encoder toggles it once accumulated movement crosses the threshold", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter");
    enterFxMode(device, controller);
    expect(store.getState().song.trackChannels[0].fx["filter.mode"]).toBe(0); // LOW by default

    device.fireMessage([CC_ON, ENCODER_CC[2], 4]); // encoder 2 -> filter.mode, delta 4 meets the threshold

    expect(store.getState().song.trackChannels[0].fx["filter.mode"]).toBe(1); // HIGH
  });

  it("an unassigned encoder (beyond the current FX's param count) is a no-op", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter"); // 3 params — encoders 3-7 are unassigned
    enterFxMode(device, controller);

    expect(() => device.fireMessage([CC_ON, ENCODER_CC[6], 40])).not.toThrow();
    expect(store.getState().song.trackChannels[0].fx).toMatchObject({ "filter.mode": 0 });
  });

  it("Left/Right pages between enabled FX modules on the current track, clamped at the ends", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter");
    store.addTrackFx(0, "delay");
    enterFxMode(device, controller);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter  1/2  TRK1"));
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Delay  2/2  TRK1"));

    device.send.mockClear();
    device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127]); // already at the last page — clamp, no resend
    expect(device.send).not.toHaveBeenCalled();

    device.fireMessage([CC_ON, CC_ARROW_LEFT, 127]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter  1/2  TRK1"));
  });

  it("Left/Right paging is ignored while in volume mode", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter");
    store.addTrackFx(0, "delay");
    controller.attach(); // stays in volume mode

    expect(() => device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127])).not.toThrow();
  });
});

describe("createPushEncoderController — refresh()", () => {
  it("resets the diff caches so a full repaint is sent again", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    device.send.mockClear();

    controller.refresh();

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_VOLUME, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "VOLUME"));
  });
});
