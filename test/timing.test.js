import { describe, expect, it } from "vitest";
import {
  STEPS_PER_BAR,
  MAX_BARS,
  rowCountForBars,
  barsForRowCount,
  rowToBarBeat,
  formatBarBeat,
  swingDelaySeconds,
} from "../src/model/timing.js";

describe("timing", () => {
  it("STEPS_PER_BAR matches 4 beats of 4 steps (4/4 at a 16th-note row resolution)", () => {
    expect(STEPS_PER_BAR).toBe(16);
  });

  it("rowCountForBars/barsForRowCount round-trip up to MAX_BARS", () => {
    for (let bars = 1; bars <= MAX_BARS; bars++) {
      expect(barsForRowCount(rowCountForBars(bars))).toBe(bars);
    }
    expect(rowCountForBars(4)).toBe(64); // the MVP's original default pattern length
  });

  it("rowToBarBeat maps row 0 to bar 1 / beat 1 and advances every 4 rows", () => {
    expect(rowToBarBeat(0)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(rowToBarBeat(4)).toEqual({ bar: 1, beat: 2, tick: 0 });
    expect(rowToBarBeat(16)).toEqual({ bar: 2, beat: 1, tick: 0 });
    expect(rowToBarBeat(18)).toEqual({ bar: 2, beat: 1, tick: 2 });
  });

  it("formatBarBeat renders bar.beat", () => {
    expect(formatBarBeat(0)).toBe("1.1");
    expect(formatBarBeat(20)).toBe("2.2");
  });

  describe("swingDelaySeconds", () => {
    it("never delays an even (on-beat) step, regardless of swing amount", () => {
      expect(swingDelaySeconds(0, 0.25, 100)).toBe(0);
      expect(swingDelaySeconds(2, 0.25, 100)).toBe(0);
      expect(swingDelaySeconds(4, 0.25, 50)).toBe(0);
    });

    it("never delays an odd (off-beat) step when swing is 0 (neutral/disabled)", () => {
      expect(swingDelaySeconds(1, 0.25, 0)).toBe(0);
      expect(swingDelaySeconds(3, 0.25, 0)).toBe(0);
    });

    it("delays an odd step by up to a third of a step at maximum swing (full 2:1/triplet ratio)", () => {
      expect(swingDelaySeconds(1, 0.3, 100)).toBeCloseTo(0.1); // 0.3 / 3
    });

    it("scales linearly between 0 and the maximum", () => {
      expect(swingDelaySeconds(1, 0.3, 50)).toBeCloseTo(0.05); // half of the max delay
    });
  });
});
