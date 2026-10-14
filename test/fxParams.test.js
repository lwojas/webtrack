import { describe, expect, it } from "vitest";
import { FX_TYPES, getFxParam, getFxParamsForType, getFxInstanceLabel, formatFxValue, isFxBooleanOn } from "../src/model/fxParams.js";

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

describe("filter.slope — the boolean 12dB/24dB filter FX parameter (webdsp's FilterSlope)", () => {
  it("is catalogued under the filter type, independent of the filter's bypass values", () => {
    const param = getFxParam("filter.slope");
    expect(param).toBeTruthy();
    expect(param.kind).toBe("boolean");
    expect(param.type).toBe("filter");
    expect(param.nodeParam).toBe("FilterSlope");
    expect(param.default).toBe(12);
    expect(param.cellAutomatable).toBe(false); // same reasoning as filter.mode
    expect(getFxParamsForType("filter").map((p) => p.id)).toContain("filter.slope");
  });

  it("formatFxValue renders webdsp's own 12/24 values as their on/off labels, not a numeric string", () => {
    const param = getFxParam("filter.slope");
    expect(formatFxValue(12, param)).toBe("12dB");
    expect(formatFxValue(24, param)).toBe("24dB");
  });
});

describe("Phaser / Bitcrusher catalog entries", () => {
  it("FX_TYPES includes phaser and bitcrusher, with no bypassValues field (real per-instance enable/disable replaced it)", () => {
    const phaser = FX_TYPES.find((t) => t.id === "phaser");
    const bitcrusher = FX_TYPES.find((t) => t.id === "bitcrusher");
    expect(phaser).toEqual({ id: "phaser", label: "Phaser" });
    expect(bitcrusher).toEqual({ id: "bitcrusher", label: "Bitcrusher" });
  });

  it("getFxParamsForType('phaser') returns every PhaserX param, phaser.stages marked non-cell-automatable", () => {
    const ids = getFxParamsForType("phaser").map((p) => p.id);
    expect(ids).toEqual(["phaser.rate", "phaser.depth", "phaser.center", "phaser.feedback", "phaser.stages", "phaser.mix"]);
    expect(getFxParam("phaser.stages").cellAutomatable).toBe(false);
  });

  it("getFxParamsForType('bitcrusher') returns every CrushX param", () => {
    expect(getFxParamsForType("bitcrusher").map((p) => p.id)).toEqual(["crush.bits", "crush.downsample", "crush.mix"]);
  });
});

describe("getFxInstanceLabel — disambiguates stacked instances of the same kind", () => {
  it("numbers same-kind instances by chain position, always including the ordinal", () => {
    const chain = [
      { id: 1, type: "filter", bypassed: false },
      { id: 2, type: "delay", bypassed: false },
      { id: 3, type: "filter", bypassed: false },
    ];
    expect(getFxInstanceLabel(chain, 1)).toBe("Filter #1");
    expect(getFxInstanceLabel(chain, 2)).toBe("Delay #1");
    expect(getFxInstanceLabel(chain, 3)).toBe("Filter #2");
  });

  it("returns an empty string for an id not in the chain", () => {
    expect(getFxInstanceLabel([], 99)).toBe("");
  });
});

describe("isFxBooleanOn — generalizes beyond a 0/1 value space", () => {
  it("reads filter.mode's 0/1 values correctly", () => {
    const param = getFxParam("filter.mode");
    expect(isFxBooleanOn(0, param)).toBe(false);
    expect(isFxBooleanOn(1, param)).toBe(true);
  });

  it("reads filter.slope's 12/24 values correctly, not assuming 0/1", () => {
    const param = getFxParam("filter.slope");
    expect(isFxBooleanOn(12, param)).toBe(false);
    expect(isFxBooleanOn(24, param)).toBe(true);
  });

  it("falls back to a 0/1 midpoint when a param defines no min/max", () => {
    const param = { kind: "boolean", default: 0 };
    expect(isFxBooleanOn(0, param)).toBe(false);
    expect(isFxBooleanOn(1, param)).toBe(true);
  });
});
