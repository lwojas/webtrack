import { describe, expect, it } from "vitest";
import { EqBandType } from "webdsp";
import { bandsFromValues, dbToY, freqToX, handleDb, widenedValue, widthField, xToFreq, yToDb } from "../src/model/eqGeometry.js";
import { getFxParam } from "../src/model/fxParams.js";

describe("EQ curve editor geometry", () => {
  it("maps frequency logarithmically across the width and back", () => {
    expect(freqToX(20, 600)).toBeCloseTo(0, 6);
    expect(freqToX(20000, 600)).toBeCloseTo(600, 6);
    expect(freqToX(632.455, 600)).toBeCloseTo(300, 1);
    for (const hz of [25, 440, 8000]) expect(xToFreq(freqToX(hz, 600), 600)).toBeCloseTo(hz, 6);
    expect(xToFreq(-50, 600)).toBe(20);
    expect(xToFreq(9999, 600)).toBe(20000);
  });

  it("maps dB linearly, 0 dB in the middle, clamped to the view", () => {
    expect(dbToY(0, 200)).toBe(100);
    expect(dbToY(18, 200)).toBe(0);
    expect(yToDb(dbToY(-7.5, 200), 200)).toBeCloseTo(-7.5, 9);
    expect(yToDb(-500, 200)).toBe(18);
    expect(yToDb(900, 200)).toBe(-18);
  });

  it("reads bands from catalog values, defaulting missing keys", () => {
    const bands = bandsFromValues({ "eq.b2On": 1, "eq.b2Freq": 1234, "eq.b2Gain": -4, "eq.b4Type": 4, "eq.b4Slope": 24 });
    expect(bands).toHaveLength(4);
    expect(bands[0].enabled).toBe(false);
    expect(bands[1]).toMatchObject({ enabled: true, type: EqBandType.Bell, frequency: 1234, gain: -4 });
    expect(bands[3]).toMatchObject({ type: EqBandType.HighPass, slope: 24 });
  });

  it("catalog defaults reproduce the engine's default bands", () => {
    const defaults = Object.fromEntries(["On", "Type", "Freq", "Gain", "Q", "ShelfSlope", "Slope"].flatMap((f) => [1, 2, 3, 4].map((n) => [`eq.b${n}${f}`, getFxParam(`eq.b${n}${f}`).default])));
    expect(bandsFromValues(defaults)).toEqual(bandsFromValues({}));
  });

  it("puts gainless bands on the 0 dB line and exposes the right width control", () => {
    const [low, , , high] = bandsFromValues({ "eq.b1Gain": 6, "eq.b4Type": 3, "eq.b4Gain": 9 });
    expect(handleDb(low)).toBe(6);
    expect(handleDb(high)).toBe(0);
    expect(widthField(EqBandType.Bell)).toBe("q");
    expect(widthField(EqBandType.HighShelf)).toBe("shelfSlope");
    expect(widthField(EqBandType.LowPass)).toBeNull();
  });

  it("widens/narrows within the engine's ranges", () => {
    expect(widenedValue(EqBandType.Bell, 1, 1)).toBeLessThan(1);
    expect(widenedValue(EqBandType.Bell, 1, 99)).toBe(0.1);
    expect(widenedValue(EqBandType.Bell, 1, -99)).toBe(18);
    expect(widenedValue(EqBandType.LowShelf, 0.5, -99)).toBe(1);
  });
});
