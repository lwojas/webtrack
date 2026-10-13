import { describe, expect, it, vi } from "vitest";
import { createPushModeController } from "../src/midi/push/modeController.js";
import { CC_MODE_NOTE, CC_MODE_SESSION, CC_MODE_TRACK, CC_MODE_CLIP, padNote } from "../src/midi/push/constants.js";
import { PALETTE } from "../src/midi/push/colors.js";

// A fake device (src/midi/push/pushDevice.js's own contract: { onMessage, send, isConnected })
// — the controller only needs onMessage/send, so isConnected is omitted.
function createFakeDevice() {
  const listeners = new Set();
  return {
    onMessage: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send: vi.fn(),
    fireMessage(bytes) {
      listeners.forEach((fn) => fn(bytes));
    },
  };
}

function createFakeContent() {
  return { onEnter: vi.fn(), onExit: vi.fn(), onPadOn: vi.fn(), onPadOff: vi.fn(), paint: vi.fn() };
}

const CC_ON = 0xb0;
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

describe("createPushModeController — mode button state machine", () => {
  it("defaults to session.tracker and paints all four mode buttons on attach", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });

    controller.attach();

    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "tracker" });
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_NOTE, PALETTE.MODE_BUTTON_INACTIVE]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_SESSION, PALETTE.MODE_BUTTON_ACTIVE]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_TRACK, PALETTE.MODE_BUTTON_ACTIVE]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_CLIP, PALETTE.MODE_BUTTON_INACTIVE]);
  });

  it("CC50 (Note) switches pushMode to note and repaints", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]);

    expect(controller.getState().pushMode).toBe("note");
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_NOTE, PALETTE.MODE_BUTTON_ACTIVE]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_SESSION, PALETTE.MODE_BUTTON_INACTIVE]);
  });

  it("CC112 (Track) sets sessionView to tracker AND switches into session mode, even from note mode", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]); // start from note mode

    device.fireMessage([CC_ON, CC_MODE_TRACK, 127]);

    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "tracker" });
  });

  it("CC113 (Clip) sets sessionView to pattern and switches into session mode", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();

    device.fireMessage([CC_ON, CC_MODE_CLIP, 127]);

    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "pattern" });
  });

  it("pressing Session returns to whichever sessionView was last set by Track/Clip", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    device.fireMessage([CC_ON, CC_MODE_CLIP, 127]); // sessionView -> pattern
    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]); // pushMode -> note

    device.fireMessage([CC_ON, CC_MODE_SESSION, 127]);

    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "pattern" });
  });

  it("a CC release (value 0) is not a press — never switches mode", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 0]);

    expect(controller.getState().pushMode).toBe("session");
  });

  it("an unrelated CC is ignored without throwing", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    expect(() => device.fireMessage([CC_ON, 71, 1])).not.toThrow(); // encoder 1
    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "tracker" });
  });
});

describe("createPushModeController — gridContent dispatch", () => {
  it("calls onEnter/paint for the default content on attach, never onExit", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    createPushModeController({ device, gridContent: { "session.tracker": tracker } }).attach();

    expect(tracker.onEnter).toHaveBeenCalledTimes(1);
    expect(tracker.paint).toHaveBeenCalledTimes(1);
    expect(tracker.onExit).not.toHaveBeenCalled();
  });

  it("calls onExit on the previous content and onEnter on the next when the key actually changes", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const note = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker, note } });
    controller.attach();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]);

    expect(tracker.onExit).toHaveBeenCalledTimes(1);
    expect(note.onEnter).toHaveBeenCalledTimes(1);
  });

  it("does not re-trigger onEnter/onExit when the active key doesn't change (e.g. Session pressed while already in session.tracker)", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach(); // onEnter already fired once here
    tracker.onEnter.mockClear();

    device.fireMessage([CC_ON, CC_MODE_SESSION, 127]);

    expect(tracker.onEnter).not.toHaveBeenCalled();
    expect(tracker.onExit).not.toHaveBeenCalled();
  });

  it("routes a pad Note On to the currently active content's onPadOn with (row, column, velocity)", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();

    device.fireMessage([NOTE_ON, padNote(2, 3), 100]);

    expect(tracker.onPadOn).toHaveBeenCalledWith(2, 3, 100);
  });

  it("routes a real Note Off, and a Note On with velocity 0, both to onPadOff", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();

    device.fireMessage([NOTE_OFF, padNote(0, 0), 0]);
    device.fireMessage([NOTE_ON, padNote(1, 1), 0]);

    expect(tracker.onPadOff).toHaveBeenCalledWith(0, 0);
    expect(tracker.onPadOff).toHaveBeenCalledWith(1, 1);
    expect(tracker.onPadOn).not.toHaveBeenCalled();
  });

  it("ignores a note outside the pad grid's range (e.g. a side button sent as a Note message)", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();

    device.fireMessage([NOTE_ON, 12, 100]); // the touch-strip tap note, not a pad

    expect(tracker.onPadOn).not.toHaveBeenCalled();
  });

  it("a pad press only reaches the content active at the moment it arrives, not a previously active one", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const note = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker, note } });
    controller.attach();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]); // switch to note mode
    device.fireMessage([NOTE_ON, padNote(0, 0), 100]);

    expect(note.onPadOn).toHaveBeenCalledWith(0, 0, 100);
    expect(tracker.onPadOn).not.toHaveBeenCalled();
  });
});
