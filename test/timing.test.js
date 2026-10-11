import { describe, expect, it } from "vitest";
import {
  STEPS_PER_BAR,
  MAX_BARS,
  rowCountForBars,
  barsForRowCount,
  rowToBarBeat,
  formatBarBeat,
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
});
