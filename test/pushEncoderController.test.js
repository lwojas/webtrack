import { describe, expect, it, vi } from "vitest";
import { createPushEncoderController } from "../src/midi/push/encoderController.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getSelectedPattern } from "../src/model/query.js";
import {
  ENCODER_CC,
  CC_ENCODER_MODE_VOLUME,
  CC_ENCODER_MODE_FX,
  CC_ARROW_LEFT,
  CC_ARROW_RIGHT,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
  LCD_LINE_ID,
  LCD_SEGMENT_OFFSETS,
  LCD_SEGMENT_WIDTH,
  lcdSysex,
} from "../src/midi/push/constants.js";

// Decodes a sent LCD SysEx message's text payload back to a plain string, so a test can read
// off what actually landed at a given column rather than re-deriving it from the input text.
function decodeLcdText(message) {
  return String.fromCharCode(...message.slice(8, message.length - 1));
}

// The most recent text sent to LCD line `lineIndex`, reading straight off device.send's call
// history rather than reconstructing it — so the test only passes if the real positioning logic
// produced it, not because the test duplicated that logic. Last match, not first: sendLcdLine's
// own diff cache means a line is only resent when its content actually changes, so an earlier
// (now-stale) paint of the same line can still be in the call history.
function sentLcdLine(device, lineIndex) {
  const calls = device.send.mock.calls.filter(([message]) => message[4] === LCD_LINE_ID[lineIndex]);
  const lastCall = calls[calls.length - 1];
  return lastCall ? decodeLcdText(lastCall[0]) : null;
}

function segmentAt(lineText, encoderIndex) {
  const offset = LCD_SEGMENT_OFFSETS[encoderIndex];
  return lineText.slice(offset, offset + LCD_SEGMENT_WIDTH);
}

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
  const fxController = {
    setTrackFxParam: (trackIndex, paramId, value) => store.setTrackFxParam(trackIndex, paramId, value),
    setTrackFxInstanceParam: (trackIndex, instanceId, paramId, value) => store.setTrackFxInstanceParam(trackIndex, instanceId, paramId, value),
  };
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
    const id = store.addTrackFx(0, "filter"); // filter.cutoff, filter.resonance, filter.mode, filter.slope, in that order
    enterFxMode(device, controller);
    const before = store.getState().song.trackChannels[0].fx.instances[id]["filter.cutoff"];
    expect(before).toBe(20000); // the catalog default, which is also filter.cutoff's max

    // encoderDelta(100) === 100 - 128 === -28 (a negative delta) — default sits at the max, so
    // only a downward turn is guaranteed to actually move it.
    device.fireMessage([CC_ON, ENCODER_CC[0], 100]); // encoder 0 -> filter.cutoff

    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.cutoff"]).toBeLessThan(before);
  });

  it("turning the boolean filter.mode encoder toggles it once accumulated movement crosses the threshold", () => {
    const { store, device, controller } = createTestContext();
    const id = store.addTrackFx(0, "filter");
    enterFxMode(device, controller);
    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.mode"]).toBe(0); // LOW by default

    device.fireMessage([CC_ON, ENCODER_CC[2], 4]); // encoder 2 -> filter.mode, delta 4 meets the threshold

    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.mode"]).toBe(1); // HIGH
  });

  it("turning the boolean filter.slope encoder toggles between webdsp's real 12/24 values, not a normalized 0/1", () => {
    const { store, device, controller } = createTestContext();
    const id = store.addTrackFx(0, "filter");
    enterFxMode(device, controller);
    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.slope"]).toBe(12); // 12dB by default

    device.fireMessage([CC_ON, ENCODER_CC[3], 4]); // encoder 3 -> filter.slope, delta 4 meets the threshold

    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.slope"]).toBe(24);

    device.fireMessage([CC_ON, ENCODER_CC[3], 4]); // turning again flips it back

    expect(store.getState().song.trackChannels[0].fx.instances[id]["filter.slope"]).toBe(12);
  });

  it("an unassigned encoder (beyond the current FX's param count) is a no-op", () => {
    const { store, device, controller } = createTestContext();
    const id = store.addTrackFx(0, "filter"); // 4 params — encoders 4-7 are unassigned
    enterFxMode(device, controller);

    expect(() => device.fireMessage([CC_ON, ENCODER_CC[6], 40])).not.toThrow();
    expect(store.getState().song.trackChannels[0].fx.instances[id]).toMatchObject({ "filter.mode": 0 });
  });

  it("Left/Right pages between enabled FX modules on the current track, clamped at the ends", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter");
    store.addTrackFx(0, "delay");
    enterFxMode(device, controller);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter #1  1/2  TRK1"));
    device.send.mockClear();

    device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Delay #1  2/2  TRK1"));

    device.send.mockClear();
    device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127]); // already at the last page — clamp, no resend
    expect(device.send).not.toHaveBeenCalled();

    device.fireMessage([CC_ON, CC_ARROW_LEFT, 127]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter #1  1/2  TRK1"));
  });

  it("stacking two instances of the same type pages between them, each with independent parameters", () => {
    const { store, device, controller } = createTestContext();
    const first = store.addTrackFx(0, "filter");
    const second = store.addTrackFx(0, "filter");
    store.setTrackFxInstanceParam(0, first, "filter.cutoff", 400);
    store.setTrackFxInstanceParam(0, second, "filter.cutoff", 4000);
    enterFxMode(device, controller);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter #1  1/2  TRK1"));

    device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127]);
    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  Filter #2  2/2  TRK1"));

    // encoder 0 now turns the *second* Filter's cutoff, never the first's.
    device.fireMessage([CC_ON, ENCODER_CC[0], 100]); // negative delta
    expect(store.getState().song.trackChannels[0].fx.instances[second]["filter.cutoff"]).toBeLessThan(4000);
    expect(store.getState().song.trackChannels[0].fx.instances[first]["filter.cutoff"]).toBe(400);
  });

  it("Left/Right paging is ignored while in volume mode", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter");
    store.addTrackFx(0, "delay");
    controller.attach(); // stays in volume mode

    expect(() => device.fireMessage([CC_ON, CC_ARROW_RIGHT, 127])).not.toThrow();
  });
});

describe("createPushEncoderController — LCD alignment", () => {
  it("every one of the 8 tracks' name lands in its own encoder's physical segment, volume mode", () => {
    const { device, controller } = createTestContext();
    controller.attach();

    const nameLine = sentLcdLine(device, 2);
    for (let i = 0; i < 8; i++) {
      // Default track names are "TRK 1".."TRK 8" (model/trackChannel.js) — distinct per encoder,
      // so a column landing in the wrong segment (the bug this guards) shows up as a mismatch.
      expect(segmentAt(nameLine, i).trim()).toBe(`TRK ${i + 1}`);
    }
  });

  it("the rightmost pair (encoders 6/7) lines up correctly — this is where contiguous packing drifted worst", () => {
    const { device, controller } = createTestContext();
    controller.attach();

    const nameLine = sentLcdLine(device, 2);
    expect(segmentAt(nameLine, 6).trim()).toBe("TRK 7");
    expect(segmentAt(nameLine, 7).trim()).toBe("TRK 8");
    // The spare column between display unit 3 (encoders 4/5) and unit 4 (encoders 6/7) must stay
    // blank, not swallowed into either segment's content.
    expect(nameLine[50]).toBe(" ");
  });

  it("a boolean FX parameter's ON/OFF centers within its own encoder's segment, not a neighbor's", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "filter"); // filter.cutoff, filter.resonance, filter.mode (boolean) — encoder 2
    controller.attach();
    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);

    const barLine = sentLcdLine(device, 1);
    expect(segmentAt(barLine, 2)).toBe("  OFF   ");
    // Neighboring encoders (continuous bars) must not bleed into encoder 2's segment or vice versa.
    expect(segmentAt(barLine, 1)).toMatch(/^\[[=-]+\]$/);
    // encoder 3 is filter.slope — also boolean, so the bar row shows the same literal ON/OFF
    // (the value row below is where its own 12dB/24dB labels actually show — see formatFxValue).
    expect(segmentAt(barLine, 3)).toBe("  OFF   ");
    expect(segmentAt(barLine, 4)).toBe(" ".repeat(LCD_SEGMENT_WIDTH)); // unassigned — no 5th filter param

    const valueLine = sentLcdLine(device, 3);
    expect(segmentAt(valueLine, 3).trim()).toBe("12dB");
  });

  it("a short and a long parameter name both stay confined to their own segment", () => {
    const { store, device, controller } = createTestContext();
    store.addTrackFx(0, "compressor"); // Threshold, Ratio, Attack, Release, Knee, Makeup
    controller.attach();
    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);

    const nameLine = sentLcdLine(device, 2);
    expect(segmentAt(nameLine, 0).trim()).toBe("Threshol"); // long name, truncated within its own 8-wide segment
    expect(segmentAt(nameLine, 1).trim()).toBe("Ratio"); // short name, not pulled into a neighbor's offset
  });
});

describe("createPushEncoderController — write mode: cellEdit mode", () => {
  it("setCellEditMode(true) switches the LCD header to CELL EDIT and dims both CC114/CC115", () => {
    const { device, controller } = createTestContext();
    controller.attach();

    controller.setCellEditMode(true);

    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "CELL EDIT  TRK1  ROW1"));
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_VOLUME, FEEDBACK_DIM]);
    expect(device.send).toHaveBeenCalledWith([CC_ON, CC_ENCODER_MODE_FX, FEEDBACK_DIM]);
  });

  it("setCellEditMode(false) restores whichever of volume/fx was active before", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    device.fireMessage([CC_ON, CC_ENCODER_MODE_FX, 127]);
    controller.setCellEditMode(true);
    device.send.mockClear();

    controller.setCellEditMode(false);

    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "FX  (no FX enabled)  TRK1"));
  });

  it("is idempotent — calling setCellEditMode(true) twice doesn't reset accumulators or double-repaint header text", () => {
    const { device, controller } = createTestContext();
    controller.attach();
    controller.setCellEditMode(true);
    device.send.mockClear();

    expect(() => controller.setCellEditMode(true)).not.toThrow();
    expect(device.send).not.toHaveBeenCalled();
  });

  it("turning encoder 0 changes the selected cell's note", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    device.fireMessage([CC_ON, ENCODER_CC[0], 5]); // delta +5

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].note).toBe(65);
  });

  it("turning encoder 1 changes the selected cell's instrument, clamped to 0-255", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    for (let i = 0; i < 10; i++) device.fireMessage([CC_ON, ENCODER_CC[1], 100]); // negative delta each time

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].instrument).toBe(0);
  });

  it("turning encoder 2 changes the selected cell's velocity, clamped to 0-127", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    for (let i = 0; i < 10; i++) device.fireMessage([CC_ON, ENCODER_CC[2], 40]);

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].velocity).toBe(127);
  });

  it("turning encoder 3 steps the selected cell's length by one row per tick, returning to null (auto) below 1", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    device.fireMessage([CC_ON, ENCODER_CC[3], 5]); // positive delta
    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].length).toBe(1);

    device.fireMessage([CC_ON, ENCODER_CC[3], 100]); // negative delta -> back to auto
    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].length).toBe(null);
  });

  it("turning encoder 4 changes the selected cell's pan, clamped to -1..1", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    for (let i = 0; i < 100; i++) device.fireMessage([CC_ON, ENCODER_CC[4], 40]);

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].pan).toBe(1);
  });

  it("turning encoder 5 steps through effectCommand once accumulated movement crosses the threshold", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    device.fireMessage([CC_ON, ENCODER_CC[5], 4]); // meets ENUM_STEP_THRESHOLD

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].effectCommand).toBe("pitch-slide-up");
  });

  it("turning encoder 6 changes the selected cell's effectParam, clamped to 0-255", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);

    for (let i = 0; i < 10; i++) device.fireMessage([CC_ON, ENCODER_CC[6], 40]);

    expect(getSelectedPattern(store.getState().song).tracks[0].events[0].effectParam).toBe(255);
  });

  it("switching the selected cell (CURSOR_MOVED) repaints the LCD with the new cell's values", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    store.setCell(1, 0, "note", 72);
    controller.attach();
    controller.setCellEditMode(true);
    device.send.mockClear();

    store.selectCell(1, 0, "note");

    expect(device.send).toHaveBeenCalledWith(lcdSysex(0, "CELL EDIT  TRK2  ROW1"));
  });

  it("a NoteEditor-style CELL_CHANGED edit on the selected cell repaints the LCD", () => {
    const { store, device, controller } = createTestContext();
    store.setCell(0, 0, "note", 60);
    controller.attach();
    controller.setCellEditMode(true);
    device.send.mockClear();

    store.setCell(0, 0, "velocity", 42); // the same mutator NoteEditor.jsx uses

    const valueLine = sentLcdLine(device, 3);
    expect(segmentAt(valueLine, 2).trim()).toBe("2A"); // toHex(42, 2)
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
