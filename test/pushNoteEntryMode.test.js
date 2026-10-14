import { describe, expect, it, vi } from "vitest";
import { createPushNoteEntryMode } from "../src/midi/push/noteEntryMode.js";
import { padNote, PUSH_CHANNEL } from "../src/midi/push/constants.js";
import { PALETTE, RAW } from "../src/midi/push/colors.js";

function createFakeDevice() {
  return { send: vi.fn() };
}

describe("createPushNoteEntryMode", () => {
  it("onPadOn emits the exact note the hardware assigned that pad, through noteInputSource.js's contract", () => {
    const mode = createPushNoteEntryMode();
    const onNoteOn = vi.fn();
    mode.onNoteOn(onNoteOn);

    mode.onPadOn(2, 3, 100);

    expect(onNoteOn).toHaveBeenCalledWith({ note: padNote(2, 3), velocity: 100, channel: PUSH_CHANNEL });
  });

  it("onPadOff emits a matching noteOff for the same pad", () => {
    const mode = createPushNoteEntryMode();
    const onNoteOff = vi.fn();
    mode.onNoteOff(onNoteOff);

    mode.onPadOff(0, 0);

    expect(onNoteOff).toHaveBeenCalledWith({ note: padNote(0, 0), channel: PUSH_CHANNEL });
  });

  it("attach() is a no-op satisfying noteInputSource.js's full contract shape", () => {
    const mode = createPushNoteEntryMode();
    expect(() => mode.attach()()).not.toThrow();
  });
});

describe("createPushNoteEntryMode — pad colors (point 7: a deliberate Note Mode color scheme)", () => {
  it("onEnter paints every pad to the configured base color", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });

    mode.onEnter();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(0, 0), PALETTE.NOTE_MODE_BASE]);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(7, 7), PALETTE.NOTE_MODE_BASE]);
    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("onPadOn lights the pressed color, onPadOff reverts it to the base color", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.onPadOn(2, 3, 100);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(2, 3), PALETTE.NOTE_MODE_PRESSED]);

    device.send.mockClear();
    mode.onPadOff(2, 3);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(2, 3), PALETTE.NOTE_MODE_BASE]);
  });

  it("onExit darkens every pad", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.onExit();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(0, 0), RAW.OFF]);
    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("a redundant repaint sends nothing — same diff-cache discipline trackerGridMode.js uses", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.paint();

    expect(device.send).not.toHaveBeenCalled();
  });

  it("refresh() resets the diff cache so a full repaint is sent again", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.refresh();

    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("works without a device at all (the existing no-arg construction) — every send is a safe no-op", () => {
    const mode = createPushNoteEntryMode();
    expect(() => {
      mode.onEnter();
      mode.onPadOn(0, 0, 100);
      mode.onPadOff(0, 0);
      mode.onExit();
    }).not.toThrow();
  });
});
