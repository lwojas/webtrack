import { describe, expect, it } from "vitest";
import { InstrumentCommonParam } from "webdsp";
import { resolveInstrumentParam } from "../src/audio/instrument.js";
import { SYNTH_KINDS, getSynthParams } from "../src/model/instrumentParams.js";

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
});
