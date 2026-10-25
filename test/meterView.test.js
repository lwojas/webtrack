import { describe, expect, it } from "vitest";
import { MeterTracker, emptyMeters } from "webdsp";
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
  it("leaves the master strip unflagged for a quiet signal", () => {
    const tracker = new MeterTracker(64);
    const t = targets();
    tracker.update(snapshot(0.1), 0);
    paintMeters(tracker, 0, t);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(false);
  });

  it("flags only the clipping track and clears it after the hold", () => {
    const tracker = new MeterTracker(64, { clipHoldMs: 1000 });
    const t = targets();
    tracker.update(snapshot(1.2, { 2: 1.1, 1: 0.4 }), 0);
    paintMeters(tracker, 0, t);
    expect(t.trackClips.map((c) => c.el.classes.has("channel-strip__clip--on"))).toEqual([false, true, false]);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(true);
    tracker.update(snapshot(0), 1500);
    paintMeters(tracker, 1500, t);
    expect(t.trackClips[1].el.classes.has("channel-strip__clip--on")).toBe(false);
    expect(t.masterStrip.classes.has("channel-strip--clipping")).toBe(false);
  });
});
