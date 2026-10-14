import { describe, expect, it, vi } from "vitest";
import { createPushModeController } from "../src/midi/push/modeController.js";
import {
  CC_MODE_NOTE,
  CC_MODE_SESSION,
  CC_MODE_TRACK,
  CC_MODE_CLIP,
  padNote,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
} from "../src/midi/push/constants.js";

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
  it("defaults to session.tracker and paints all four mode buttons on attach — unselected is dim, not off", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });

    controller.attach();

    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "tracker" });
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_NOTE, FEEDBACK_DIM]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_SESSION, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_TRACK, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_CLIP, FEEDBACK_DIM]);
  });

  it("CC50 (Note) switches pushMode to note and repaints", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 127]);

    expect(controller.getState().pushMode).toBe("note");
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_NOTE, FEEDBACK_FULL]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_SESSION, FEEDBACK_DIM]);
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

  it("pressing Track while already in session.tracker repaints nothing — same mode state, no redundant CC traffic", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach(); // already session.tracker (the default)
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_MODE_TRACK, 127]);

    expect(device.send).not.toHaveBeenCalled();
  });

  it("an unrelated CC is ignored without throwing when the active content has no onCC", () => {
    const device = createFakeDevice();
    const controller = createPushModeController({ device, gridContent: {} });
    controller.attach();
    expect(() => device.fireMessage([CC_ON, 71, 1])).not.toThrow(); // encoder 1
    expect(controller.getState()).toEqual({ pushMode: "session", sessionView: "tracker" });
  });

  it("forwards a non-mode CC to the active content's onCC, never to a different content's", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    tracker.onCC = vi.fn();
    const note = createFakeContent();
    note.onCC = vi.fn();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker, note } });
    controller.attach();

    device.fireMessage([CC_ON, 102, 127]); // mute strip, track 0

    expect(tracker.onCC).toHaveBeenCalledWith(102, 127);
    expect(note.onCC).not.toHaveBeenCalled();
  });

  it("also forwards a non-mode CC's release (value 0) to the active content's onCC — write mode's Shift LED needs it", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    tracker.onCC = vi.fn();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();

    device.fireMessage([CC_ON, 49, 0]); // Shift release

    expect(tracker.onCC).toHaveBeenCalledWith(49, 0);
  });

  it("a mode button's own release (value 0) never reaches onCC as a mode switch, but is still forwarded", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    tracker.onCC = vi.fn();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();

    device.fireMessage([CC_ON, CC_MODE_NOTE, 0]);

    expect(controller.getState().pushMode).toBe("session"); // unchanged — not a press
    expect(tracker.onCC).toHaveBeenCalledWith(CC_MODE_NOTE, 0);
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

  // Regression test for a real bug: React StrictMode double-invokes effects once in dev
  // (mount, cleanup, mount again — docs/ARCHITECTURE.md's Gotcha #6). attach()'s returned
  // cleanup used to only unsubscribe the device message listener, never call onExit() on
  // whatever content attach() had just entered — so the first mount's onEnter() (e.g.
  // trackerGridMode.js's setInterval-driven playhead sync) leaked forever, orphaned, because
  // the second mount's onEnter() overwrote the only reference that could have canceled it.
  it("attach()'s returned cleanup calls onExit on the content that was active, undoing attach()'s own onEnter", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });

    const detach = controller.attach();
    expect(tracker.onEnter).toHaveBeenCalledTimes(1);
    expect(tracker.onExit).not.toHaveBeenCalled();

    detach();
    expect(tracker.onExit).toHaveBeenCalledTimes(1);
  });

  it("a second attach()+detach() cycle (simulating StrictMode's double-invoke) leaves exactly one onEnter uncanceled by its own detach, never two", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });

    const detach1 = controller.attach(); // StrictMode's throwaway first mount
    detach1(); // StrictMode's immediate cleanup
    controller.attach(); // StrictMode's real, final mount

    expect(tracker.onEnter).toHaveBeenCalledTimes(2);
    expect(tracker.onExit).toHaveBeenCalledTimes(1); // exactly once — from detach1, not leaked
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

describe("createPushModeController — refresh()", () => {
  it("repaints the mode buttons and calls the active content's own refresh(), not onEnter", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent();
    tracker.refresh = vi.fn();
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();
    tracker.onEnter.mockClear();
    device.send.mockClear();

    controller.refresh();

    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_MODE_SESSION, FEEDBACK_FULL]);
    expect(tracker.refresh).toHaveBeenCalledTimes(1);
    expect(tracker.onEnter).not.toHaveBeenCalled(); // never re-subscribes — see the StrictMode leak this avoids
  });

  it("falls back to paint() when the active content has no refresh()", () => {
    const device = createFakeDevice();
    const tracker = createFakeContent(); // no .refresh
    const controller = createPushModeController({ device, gridContent: { "session.tracker": tracker } });
    controller.attach();
    tracker.paint.mockClear();

    controller.refresh();

    expect(tracker.paint).toHaveBeenCalledTimes(1);
  });
});
