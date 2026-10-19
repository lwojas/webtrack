import { describe, expect, it } from "vitest";
import { AUTOMATION_TEMPLATES, applyTemplate, curveVertices, formatLaneLength, fractionToValue, paramScale, templateById, templateRegion, valueToFraction } from "../src/model/automationLane.js";
import { FX_PARAMS } from "../src/model/fxParams.js";

const cutoff = { min: 20, max: 20000, step: 1, unit: "Hz", default: 20000 };
const gain = { min: -60, max: 12, step: 0.1, unit: "dB", default: 0 };
const mix = { min: 0, max: 1, step: 0.01, unit: "", default: 0 };
const t = (id) => templateById(id);

describe("axis mapping", () => {
  it("is log for Hz / seconds, linear otherwise, and round-trips", () => {
    expect(paramScale(cutoff)).toBe("log");
    expect(paramScale({ min: 0.001, max: 3, unit: "s" })).toBe("log");
    expect(paramScale({ min: 0, max: 5, unit: "s" })).toBe("linear"); // zero-based time
    expect(paramScale(gain)).toBe("linear");
    for (const f of [0, 0.25, 0.5, 1]) expect(valueToFraction(cutoff, fractionToValue({ ...cutoff, step: 0.001 }, f))).toBeCloseTo(f, 5);
    expect(fractionToValue(cutoff, 0.5)).toBe(Math.round(Math.sqrt(20 * 20000)));
    expect(valueToFraction(gain, 99)).toBe(1);
    expect(valueToFraction(gain, -99)).toBe(0);
  });

  it("formats the lane's length in steps and bars", () => {
    expect(formatLaneLength(64)).toBe("64 steps · 4 bars");
    expect(formatLaneLength(16)).toBe("16 steps · 1 bar");
    expect(formatLaneLength(24)).toBe("24 steps · 1.5 bars");
    expect(formatLaneLength(1)).toBe("1 step · 0.06 bars");
  });
});

describe("curveVertices — exactly what plays", () => {
  it("a ramp point goes straight to the next point; a step point holds, then steps", () => {
    const v = curveVertices([{ row: 0, value: 1, glide: true }, { row: 4, value: 5, glide: false }, { row: 8, value: 2, glide: false }], 16);
    expect(v).toEqual([[0, 1], [4, 5], [8, 5], [8, 2], [15, 2]]);
  });

  it("holds the last value to the end of the loop and has no line without points", () => {
    expect(curveVertices([{ row: 3, value: 7, glide: false }], 16)).toEqual([[3, 7], [15, 7]]);
    expect(curveVertices([], 16)).toEqual([]);
    expect(curveVertices([{ row: 15, value: 7, glide: false }], 16)).toEqual([[15, 7]]);
  });
});

describe("templates", () => {
  it("regions: all, first bar, last bar; a loop of a bar or less has one region", () => {
    expect(templateRegion("all", 64)).toEqual({ from: 0, to: 64 });
    expect(templateRegion("start", 64)).toEqual({ from: 0, to: 16 });
    expect(templateRegion("end", 64)).toEqual({ from: 48, to: 64 });
    for (const r of ["all", "start", "end"]) expect(templateRegion(r, 16)).toEqual({ from: 0, to: 16 });
    expect(templateRegion("end", 24)).toEqual({ from: 8, to: 24 }); // an odd loop length still lands on its last 16 rows
  });

  it("a ramp spans exactly its region, from min to max, with the last point not gliding", () => {
    for (const [len, range, from, to] of [[16, "all", 0, 15], [64, "all", 0, 63], [64, "start", 0, 15], [64, "end", 48, 63]]) {
      const r = applyTemplate(t("rampUp"), range, gain, len);
      expect([r.from, r.to]).toEqual([from, to]);
      expect(r.points[0]).toEqual({ row: from, value: -60, glide: true });
      expect(r.points.at(-1)).toEqual({ row: to, value: 12, glide: false });
    }
  });

  it("is deterministic and keeps every point inside its region, strictly increasing and within range", () => {
    for (const template of AUTOMATION_TEMPLATES) {
      for (const [len, range] of [[16, "all"], [64, "all"], [64, "start"], [64, "end"], [128, "all"], [24, "all"]]) {
        for (const param of [cutoff, gain, mix]) {
          const a = applyTemplate(template, range, param, len);
          expect(applyTemplate(template, range, param, len)).toEqual(a);
          expect(a.points.length).toBeGreaterThan(1);
          a.points.forEach((p, i) => {
            expect(p.row).toBeGreaterThanOrEqual(a.from);
            expect(p.row).toBeLessThanOrEqual(a.to);
            expect(p.value).toBeGreaterThanOrEqual(param.min);
            expect(p.value).toBeLessThanOrEqual(param.max);
            if (i > 0) expect(p.row).toBeGreaterThan(a.points[i - 1].row);
          });
        }
      }
    }
  });

  it("fades on a dB gain start/end at unity, not at the boost maximum; other params use the full range", () => {
    const out = applyTemplate(t("fadeOut"), "all", gain, 16).points;
    expect(out[0].value).toBe(0);
    expect(out.at(-1).value).toBe(-60);
    expect(applyTemplate(t("fadeIn"), "all", cutoff, 16).points.at(-1).value).toBe(20000);
    expect(applyTemplate(t("rampUp"), "all", gain, 16).points.at(-1).value).toBe(12);
  });

  it("log params sweep exponentially: the middle of a ramp is the geometric mean", () => {
    const { points } = applyTemplate(t("rampUp"), "all", cutoff, 16);
    const mid = points[points.length >> 1];
    expect(mid.value).toBeGreaterThan(400 * 0.8);
    expect(mid.value).toBeLessThan(700 * 1.3); // ~sqrt(20*20000) = 632
    expect(points.length).toBeGreaterThan(4); // densified into short ramps
  });

  it("cyclic shapes scale with the region's bars; pulse holds each level and jumps between them", () => {
    expect(applyTemplate(t("wobble"), "all", mix, 64).points.length).toBeGreaterThan(applyTemplate(t("wobble"), "all", mix, 16).points.length * 3);
    const pulse = applyTemplate(t("pulse"), "all", gain, 16).points;
    expect(pulse.every((p) => !p.glide)).toBe(true);
    expect(pulse.map((p) => p.row)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]); // four 4-row cycles, phase-true
    expect(pulse.map((p) => p.value)).toEqual([12, -60, 12, -60, 12, -60, 12, -60]);
  });

  it("stepped params are rounded to their step", () => {
    const bits = { min: 1, max: 16, step: 1, unit: "", default: 16 };
    for (const p of applyTemplate(t("sine"), "all", bits, 16).points) expect(Number.isInteger(p.value)).toBe(true);
  });

  it("every cell-automatable FX parameter takes every template (smoke over the catalog)", () => {
    for (const param of FX_PARAMS.filter((p) => p.cellAutomatable !== false && p.kind !== "boolean")) {
      for (const template of AUTOMATION_TEMPLATES) {
        for (const p of applyTemplate(template, "all", param, 32).points) expect(Number.isFinite(p.value)).toBe(true);
      }
    }
  });
});
