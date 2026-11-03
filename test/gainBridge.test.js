import { describe, expect, it } from "vitest";
import { InstrumentCommonParam, MatrixIn, MatrixOut, matrixAmountParam } from "webdsp";
import { resolveInstrumentParam } from "../src/audio/instrument.js";
import { MATRIX_PARAMS, SYNTH_KINDS, getSynthParams } from "../src/model/instrumentParams.js";

// The Gain control has no per-kind enum member: audio/instrument.js must send it to webdsp's shared
// instrument parameter id (1000), for every kind, and must not disturb any kind's own controls.
describe("synth source gain bridge", () => {
  it("resolves 'gain' to webdsp's shared InstrumentCommonParam.Gain for every kind", () => {
    expect(InstrumentCommonParam.Gain).toBe(1000);
    for (const kind of SYNTH_KINDS) expect(resolveInstrumentParam(kind.id, "gain")).toBe(InstrumentCommonParam.Gain);
  });

  it("still resolves every other control of every kind to its own enum id (none to the shared id)", () => {
    for (const kind of SYNTH_KINDS) {
      for (const param of getSynthParams(kind.id).filter((p) => p.id !== "gain")) {
        const id = resolveInstrumentParam(kind.id, param.id);
        expect(typeof id, `${kind.id}.${param.id}`).toBe("number");
        expect(id).not.toBe(InstrumentCommonParam.Gain);
      }
    }
  });

  it("resolves every Matrix control to its engine id: the knobs by enum, each cable by matrixAmountParam", () => {
    MATRIX_PARAMS.slice(0, 21).forEach((param, i) => expect(resolveInstrumentParam("matrix", param.id), param.id).toBe(i));
    MATRIX_PARAMS.slice(21).forEach((param, i) => {
      const out = Math.floor(i / 11);
      const input = i % 11;
      expect(param.webdspParam).toBe(`${MatrixOut[out]}${MatrixIn[input]}`);
      expect(resolveInstrumentParam("matrix", param.id), param.id).toBe(matrixAmountParam(out, input));
      expect(resolveInstrumentParam("matrix", param.id)).toBe(21 + i);
    });
  });
});
