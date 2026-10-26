import { describe, expect, it } from "vitest";
import { compileRow } from "../src/audio/compile.js";
import { compileNativeSequence } from "../src/audio/nativeSequence.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";
import { getPatternQueueEntries, getSelectedPattern } from "../src/model/query.js";
import { RATCHET_VALUES, createEmptyEvent, isEmptyEvent, normalizeRatchet, ratchetOf } from "../src/model/event.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const STEP = 0.125;

function setup(ratchet, length = 2) {
  const song = createSong({ rowCount: 16, trackCount: 2 });
  const ref = { patternId: song.patterns[0].id, trackIndex: 0, rowIndex: 0 };
  setEventField(song, ref, "note", 60);
  setEventField(song, ref, "instrument", 0);
  setEventField(song, ref, "length", length);
  if (ratchet !== undefined) setEventField(song, ref, "ratchet", ratchet);
  const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60 })];
  return { song, instruments };
}
const row = ({ song, instruments }, step = STEP, time = 10) =>
  compileRow(getSelectedPattern(song), song.trackChannels, instruments, 0, time, step);

describe("ratchet", () => {
  it("1x, null and absent compile to the single event they always did", () => {
    const plain = row(setup(undefined));
    expect(plain).toHaveLength(1);
    expect(row(setup(null))).toEqual(plain);
    expect(row(setup(1))).toEqual(plain);
    expect(plain[0].time).toBe(10);
    expect(plain[0].duration).toBe(2 * STEP);
    const legacy = setup(undefined);
    delete getSelectedPattern(legacy.song).tracks[0].events[0].ratchet; // a project saved before the field
    expect(row(legacy)).toEqual(plain);
  });

  it.each([2, 3, 4, 6, 8])("%ix: evenly spaced real triggers tiling the note's length", (n) => {
    const events = row(setup(n));
    expect(events).toHaveLength(n);
    events.forEach((e, i) => {
      expect(e.time).toBeCloseTo(10 + (i * 2 * STEP) / n, 9);
      expect(e.duration).toBeCloseTo((2 * STEP) / n, 9);
      expect(e.trackIndex).toBe(0);
    });
    expect(events[n - 1].time + events[n - 1].duration).toBeCloseTo(10 + 2 * STEP, 9);
  });

  it("scales with tempo (the step duration) and with an auto-length note", () => {
    for (const step of [0.0625, 0.5]) {
      const events = row(setup(4, 1), step, 0);
      events.forEach((e, i) => expect(e.time / step).toBeCloseTo(i / 4, 9));
    }
  });

  it("a synth instrument retriggers with its own sustained slot length", () => {
    const s = setup(3);
    s.instruments = [createInstrumentSlot({ id: 0, output: { type: "instrument", channel: null, kind: "bass" }, engineInstrumentId: 7, rootNote: 60 })];
    const events = row(s);
    expect(events.map((e) => e.kind)).toEqual(["instrument", "instrument", "instrument"]);
    events.forEach((e) => expect(e.duration).toBeCloseTo((2 * STEP) / 3, 9));
  });

  it("reaches the native sequence as ordinary events", () => {
    const { song, instruments } = setup(4);
    const seq = compileNativeSequence({
      entries: getPatternQueueEntries(song),
      trackChannels: song.trackChannels,
      instruments,
      trackBusIds: [10, 11],
      swing: 0,
      hasSample: () => true,
      paramContext: { trackBusIds: [10, 11], instruments, effectId: () => undefined, nodeParam: () => undefined, instrumentParam: () => undefined, sampleParam: () => undefined },
    });
    expect(seq.events.map((e) => e.beat)).toEqual([0, 0.125, 0.25, 0.375].map((b) => expect.closeTo(b, 9)));
  });

  it("normalises to the supported counts and is part of what makes an event non-empty", () => {
    expect(RATCHET_VALUES).toEqual([1, 2, 3, 4, 6, 8]);
    expect(normalizeRatchet("4")).toBe(4);
    expect(normalizeRatchet("1")).toBe(null);
    expect(normalizeRatchet(5)).toBe(null);
    expect(ratchetOf({ ratchet: 7 })).toBe(1);
    expect(ratchetOf({})).toBe(1);
    expect(createEmptyEvent().ratchet).toBe(null);
    expect(isEmptyEvent({ ...createEmptyEvent(), ratchet: 2 })).toBe(false);
  });

  it("survives save and load; a project without it loads unchanged", async () => {
    const { song, instruments } = setup(6);
    const restored = await deserializeProject(serializeProject({ song, instruments, ui: {} }), { loadSampleBytes: async () => null });
    expect(restored.song.patterns[0].tracks[0].events[0].ratchet).toBe(6);
    const plain = setup(undefined);
    const again = await deserializeProject(serializeProject({ song: plain.song, instruments: plain.instruments, ui: {} }), { loadSampleBytes: async () => null });
    expect(again.song.patterns[0].tracks[0].events[0].ratchet ?? null).toBe(null);
  });
});
