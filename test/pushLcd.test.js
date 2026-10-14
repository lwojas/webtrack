import { describe, expect, it } from "vitest";
import { padColumn, centerColumn, formatBar, buildEncoderLine } from "../src/midi/push/lcd.js";
import { LCD_LINE_LENGTH, LCD_SEGMENT_OFFSETS } from "../src/midi/push/constants.js";

describe("padColumn", () => {
  it("pads short text to the given width with spaces", () => {
    expect(padColumn("MIX", 8)).toBe("MIX     ");
  });

  it("truncates text longer than the given width", () => {
    expect(padColumn("RESONANCE", 8)).toBe("RESONANC");
  });
});

describe("centerColumn", () => {
  it("centers text within the given width", () => {
    expect(centerColumn("ON", 8)).toBe("   ON   ");
  });

  it("truncates text longer than the given width before centering", () => {
    expect(centerColumn("HIGHPASS", 4)).toBe("HIGH");
  });
});

describe("formatBar", () => {
  it("renders an empty bar at ratio 0 and a full bar at ratio 1", () => {
    expect(formatBar(0, 8)).toBe("[------]");
    expect(formatBar(1, 8)).toBe("[======]");
  });

  it("renders a half-filled bar at ratio 0.5", () => {
    expect(formatBar(0.5, 8)).toBe("[===---]");
  });

  it("clamps an out-of-range ratio instead of producing a malformed glyph count", () => {
    expect(formatBar(-1, 8)).toBe("[------]");
    expect(formatBar(2, 8)).toBe("[======]");
  });
});

describe("buildEncoderLine", () => {
  it("places each column at its own physical segment offset, not packed contiguously", () => {
    const columns = ["MIX", "FEEDBACK", "TIME", "", "", "", "", ""];
    const line = buildEncoderLine(columns, 8);
    expect(line).toHaveLength(LCD_LINE_LENGTH);
    expect(line.slice(0, 8)).toBe("MIX     "); // encoder 0 — offset 0
    expect(line.slice(8, 16)).toBe("FEEDBACK"); // encoder 1 — offset 8
    expect(line.slice(17, 25)).toBe("TIME    "); // encoder 2 — offset 17, past the spare column at 16
  });

  it("leaves the spare column between each pair of display units blank", () => {
    const columns = ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC", "DDDDDDDD", "EEEEEEEE", "FFFFFFFF", "GGGGGGGG", "HHHHHHHH"];
    const line = buildEncoderLine(columns, 8);
    expect(line[16]).toBe(" ");
    expect(line[33]).toBe(" ");
    expect(line[50]).toBe(" ");
    expect(line[67]).toBe(" ");
  });

  it("positions all 8 encoder columns at the hardware's confirmed offsets", () => {
    const columns = ["0", "1", "2", "3", "4", "5", "6", "7"];
    const line = buildEncoderLine(columns, 8);
    LCD_SEGMENT_OFFSETS.forEach((offset, index) => {
      expect(line[offset]).toBe(String(index));
    });
  });

  it("drops a column index beyond the hardware's 8 segments rather than throwing", () => {
    const columns = new Array(10).fill("X");
    expect(() => buildEncoderLine(columns, 8)).not.toThrow();
    expect(buildEncoderLine(columns, 8)).toHaveLength(LCD_LINE_LENGTH);
  });

  it("treats a missing/undefined column as blank", () => {
    const line = buildEncoderLine([undefined, "X"], 4);
    expect(line.slice(0, 4)).toBe("    "); // encoder 0 — offset 0
    expect(line.slice(8, 12)).toBe("X   "); // encoder 1 — offset 8
  });
});
