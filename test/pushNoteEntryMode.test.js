import { describe, expect, it, vi } from "vitest";
import { createPushNoteEntryMode } from "../src/midi/push/noteEntryMode.js";
import { padNote, PUSH_CHANNEL } from "../src/midi/push/constants.js";

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
