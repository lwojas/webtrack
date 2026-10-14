import { describe, expect, it } from "vitest";
import { getFxParam, getFxParamsForType, formatFxValue } from "../src/model/fxParams.js";

describe("filter.mode — the boolean low-pass/high-pass FX parameter", () => {
  it("is catalogued under the filter type, independent of the filter's bypass values", () => {
    const param = getFxParam("filter.mode");
    expect(param).toBeTruthy();
    expect(param.kind).toBe("boolean");
    expect(param.type).toBe("filter");
    expect(param.cellAutomatable).toBe(false); // matches docs/FX.md's own reasoning for comp.knee etc.
    expect(getFxParamsForType("filter").map((p) => p.id)).toContain("filter.mode");
  });

  it("formatFxValue renders it as its on/off labels, not a numeric string", () => {
    const param = getFxParam("filter.mode");
    expect(formatFxValue(0, param)).toBe("LOW");
    expect(formatFxValue(1, param)).toBe("HIGH");
  });
});

describe("formatFxValue — boolean fallback labels", () => {
  it("falls back to ON/OFF when a boolean param defines no onLabel/offLabel", () => {
    const param = { kind: "boolean", step: 1, unit: "" };
    expect(formatFxValue(0, param)).toBe("OFF");
    expect(formatFxValue(1, param)).toBe("ON");
  });
});
