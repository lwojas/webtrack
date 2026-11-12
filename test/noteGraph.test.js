import { describe, expect, it } from "vitest";
import { barFraction, buildNoteGraph, fieldValue, noteBarValues, stepBarValue, valueAtFraction } from "../src/model/noteGraph.js";
import { createEmptyEvent } from "../src/model/event.js";
import { createScale } from "../src/model/scale.js";

const sampleInst = (extra = {}) => ({ name: "S", rootNote: 60, sampleMode: "chromatic", cues: [], output: { type: "sample" }, ...extra });
const ctx = (over = {}) => ({ instruments: [sampleInst()], scale: createScale(), octave: 4, rowCount: 16, defaultInstrument: 0, ...over });
const bar = (bars, id) => bars.find((b) => b.id === id);

describe("buildNoteGraph", () => {
  it("lays out two rows and leaves out cell automation", () => {
    const bars = buildNoteGraph({ ...createEmptyEvent(), note: 60, instrument: 0 }, ctx());
    expect(new Set(bars.map((b) => b.row))).toEqual(new Set([0, 1]));
    expect(bars.map((b) => b.id)).toEqual(expect.arrayContaining(["note", "length", "ratchet", "velocity", "pan", "lfo", "effectCommand", "effectParam"]));
    expect(bars.some((b) => b.id === "fx")).toBe(false);
  });

  it("gives a chop slot one NOTE step per slice, and the per-note PITCH bar", () => {
    const chop = sampleInst({ sampleMode: "chop", cues: [0.25, 0.5, 0.75] });
    const bars = buildNoteGraph({ ...createEmptyEvent(), note: 61, instrument: 0 }, ctx({ instruments: [chop] }));
    expect(bar(bars, "note").values).toEqual([60, 61, 62, 63]);
    expect(bar(bars, "note").format(61)).toBe("S02");
    expect(bar(bars, "chopTranspose").values).toHaveLength(49);
  });

  it("uses the selected instrument to shape an empty cell", () => {
    const chop = sampleInst({ sampleMode: "chop", cues: [0.5] });
    const bars = buildNoteGraph(createEmptyEvent(), ctx({ instruments: [chop] }));
    expect(bar(bars, "note").values).toEqual([60, 61]);
    expect(bar(bars, "chopTranspose")).toBeUndefined();
  });

  it("offers only the key's notes when the project has a scale, keeping an off-key current note", () => {
    const major = { ...createScale(), root: 0, scale: "major" };
    const { values } = noteBarValues(major, 60, 60);
    expect(values.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(n % 12) || n === 60)).toBe(true);
    expect(noteBarValues(major, 60, 61).values).toContain(61);
  });

  it("leaves instrument to the dropdown above the graph", () => {
    const bars = buildNoteGraph({ ...createEmptyEvent(), note: 60, instrument: 0 }, ctx());
    expect(bar(bars, "instrument")).toBeUndefined();
  });

  it("limits LEN to the pattern's rows", () => {
    const bars = buildNoteGraph(createEmptyEvent(), ctx({ rowCount: 32 }));
    expect(bar(bars, "length").values.at(-1)).toBe(32);
  });
});

describe("note window", () => {
  it("offers notes below the slot's root as well as above it", () => {
    const { values } = bar(buildNoteGraph({ ...createEmptyEvent(), instrument: 0 }, ctx()), "note");
    expect(values).toContain(36);
    expect(values).toContain(83);
  });

  it("moves the window to a current note outside it", () => {
    const { values } = bar(buildNoteGraph({ ...createEmptyEvent(), note: 110, instrument: 0 }, ctx()), "note");
    expect(values).toContain(110);
    expect(values.length).toBeGreaterThan(40);
  });

  it("puts velocity on the first row", () => {
    expect(bar(buildNoteGraph(createEmptyEvent(), ctx()), "velocity").row).toBe(0);
  });
});

describe("bar value mapping", () => {
  const velocity = () => bar(buildNoteGraph(createEmptyEvent(), ctx()), "velocity");
  it("clears a clearable bar at the bottom and reaches the top value at the top", () => {
    const b = velocity();
    expect(valueAtFraction(b, 0)).toBe(null);
    expect(valueAtFraction(b, 1)).toBe(127);
    expect(valueAtFraction(b, 0.5)).toBeGreaterThan(50);
  });

  it("maps a non-clearable bar across its whole range", () => {
    const r = bar(buildNoteGraph(createEmptyEvent(), ctx()), "ratchet");
    expect(valueAtFraction(r, 0)).toBe(1);
    expect(valueAtFraction(r, 1)).toBe(8);
    expect(fieldValue(r, 1)).toBe(null);
    expect(fieldValue(r, 4)).toBe(4);
  });

  it("draws an empty field as zero height and a set one above it", () => {
    const empty = velocity();
    expect(barFraction(empty)).toBe(0);
    expect(barFraction({ ...empty, value: 0 })).toBeGreaterThan(0);
    expect(barFraction({ ...empty, value: 127 })).toBe(1);
  });

  it("steps by one value, clearing below the first on a clearable bar", () => {
    const b = { ...velocity(), value: 0 };
    expect(stepBarValue(b, 1)).toBe(1);
    expect(stepBarValue(b, -1)).toBe(null);
    expect(stepBarValue({ ...velocity(), value: 127 }, 1)).toBe(127);
  });

  it("stores chop pitch 0 as null", () => {
    const chop = sampleInst({ sampleMode: "chop", cues: [0.5] });
    const p = bar(buildNoteGraph({ ...createEmptyEvent(), note: 60, instrument: 0 }, ctx({ instruments: [chop] })), "chopTranspose");
    expect(fieldValue(p, 0)).toBe(null);
    expect(fieldValue(p, -3)).toBe(-3);
  });
});
