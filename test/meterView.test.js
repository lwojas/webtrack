import { describe, expect, it } from "vitest";
import { METER_LED_DB, MeterTracker, emptyMeters } from "webdsp";
import { paintMeters } from "../src/ui/meterView.js";

function fakeEl() {
  const classes = new Set();
  return {
    classes,
    classList: { toggle: (token, force) => (force ? classes.add(token) : classes.delete(token)) },
  };
}

function targets() {
  return {
    leds: METER_LED_DB.map(fakeEl),
    masterStrip: fakeEl(),
    trackClips: [fakeEl(), fakeEl(), fakeEl()].map((el, i) => ({ el, bus: i === 2 ? undefined : i + 1 })),
  };
}

function snapshot(masterIn, buses = {}) {
  const s = emptyMeters(64);
  s.masterIn = masterIn;
  for (const [b, v] of Object.entries(buses)) s.buses[Number(b) - 1] = v;
  return s;
}

describe("paintMeters", () => {
  it("lights LEDs progressively, top three red, no clip for a normal level", () => {
    const tracker = new MeterTracker(64);
    const t = targets();
    tracker.update(snapshot(0.1), 0);
    paintMeters(tracker, 0, t);
    const lit = t.leds.filter((l) => l.classes.has("meter-led--lit")).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(METER_LED_DB.length - 3);
    expect(t.leds.slice(-3).every((l) => l.classes.has("meter-led--red"))).toBe(true);
    expect(t.leds[0].classes.has("meter-led--red")).toBe(false);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(false);
  });

  it("flags only the clipping track and clears it after the hold", () => {
    const tracker = new MeterTracker(64, { clipHoldMs: 1000 });
    const t = targets();
    tracker.update(snapshot(1.2, { 2: 1.1, 1: 0.4 }), 0);
    paintMeters(tracker, 0, t);
    expect(t.trackClips.map((c) => c.el.classes.has("channel-strip__clip--on"))).toEqual([false, true, false]);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(true);
    expect(t.leds.every((l) => l.classes.has("meter-led--lit"))).toBe(true);
    tracker.update(snapshot(0), 1500);
    paintMeters(tracker, 1500, t);
    expect(t.trackClips[1].el.classes.has("channel-strip__clip--on")).toBe(false);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(false);
  });
});
