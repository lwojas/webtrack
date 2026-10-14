import { describe, expect, it } from "vitest";
import { padColumn, centerColumn, formatBar, buildEncoderLine } from "../src/midi/push/lcd.js";

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
  it("joins 8 columns into one fixed-width line", () => {
    const columns = ["MIX", "FEEDBACK", "TIME", "", "", "", "", ""];
    const line = buildEncoderLine(columns, 8);
    expect(line).toHaveLength(64);
    expect(line.slice(0, 8)).toBe("MIX     ");
    expect(line.slice(8, 16)).toBe("FEEDBACK");
  });

  it("treats a missing/undefined column as blank", () => {
    const line = buildEncoderLine([undefined, "X"], 4);
    expect(line).toBe("    X   ");
  });
});
