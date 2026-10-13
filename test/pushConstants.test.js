import { describe, expect, it } from "vitest";
import { padNote, padCoordinates, encoderDelta, lcdSysex, LCD_LINE_ID, LCD_LINE_LENGTH } from "../src/midi/push/constants.js";
import { RAW, PALETTE } from "../src/midi/push/colors.js";

describe("padNote", () => {
  it("bottom-left pad is note 36", () => {
    expect(padNote(0, 0)).toBe(36);
  });

  it("row-major: moving one column right adds 1", () => {
    expect(padNote(0, 1)).toBe(37);
    expect(padNote(0, 7)).toBe(43);
  });

  it("moving one row up (from the bottom) adds 8", () => {
    expect(padNote(1, 0)).toBe(44);
  });

  it("top-right pad is note 99", () => {
    expect(padNote(7, 7)).toBe(99);
  });
});

describe("padCoordinates", () => {
  it("is the exact inverse of padNote across the whole grid", () => {
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        expect(padCoordinates(padNote(row, column))).toEqual({ row, column });
      }
    }
  });

  it("returns null for a note outside the 36-99 pad range", () => {
    expect(padCoordinates(35)).toBe(null);
    expect(padCoordinates(100)).toBe(null);
  });
});

describe("encoderDelta", () => {
  it("a value below 64 is a positive delta", () => {
    expect(encoderDelta(1)).toBe(1);
    expect(encoderDelta(63)).toBe(63);
  });

  it("a value of 64 or above is a negative delta via two's complement", () => {
    expect(encoderDelta(64)).toBe(-64);
    expect(encoderDelta(127)).toBe(-1);
  });
});

describe("lcdSysex", () => {
  it("wraps the padded 68-byte line in the correct SysEx header/footer for its lineIndex", () => {
    const message = lcdSysex(0, "PATTERN 1");
    expect(message[0]).toBe(0xf0);
    expect(message.slice(1, 4)).toEqual([0x47, 0x7f, 0x15]);
    expect(message[4]).toBe(LCD_LINE_ID[0]);
    expect(message.slice(5, 8)).toEqual([0x00, 0x45, 0x00]);
    expect(message[message.length - 1]).toBe(0xf7);
    expect(message).toHaveLength(8 + LCD_LINE_LENGTH + 1);
  });

  it("space-pads short text to exactly LCD_LINE_LENGTH bytes, so a shorter message fully overwrites a longer previous one", () => {
    const message = lcdSysex(1, "HI");
    const textBytes = message.slice(8, 8 + LCD_LINE_LENGTH);
    expect(textBytes.slice(0, 2)).toEqual([72, 73]); // "HI"
    expect(textBytes.slice(2).every((byte) => byte === 32)).toBe(true); // space-padded
    expect(message[4]).toBe(LCD_LINE_ID[1]);
  });

  it("truncates text longer than LCD_LINE_LENGTH rather than overflowing the message", () => {
    const longText = "x".repeat(LCD_LINE_LENGTH + 10);
    const message = lcdSysex(2, longText);
    expect(message).toHaveLength(8 + LCD_LINE_LENGTH + 1);
  });
});

describe("colors.js — PALETTE only ever references RAW, never a bare number", () => {
  it("every palette entry resolves to one of the declared raw bytes", () => {
    const rawValues = new Set(Object.values(RAW));
    for (const value of Object.values(PALETTE)) {
      expect(rawValues.has(value)).toBe(true);
    }
  });
});
