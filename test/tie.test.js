import { describe, expect, it } from "vitest";
import { compileRow } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField, setTrackStepsTie } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { isEmptyEvent, createEmptyEvent } from "../src/model/event.js";
import { supportsTieKind } from "../src/model/instrumentParams.js";
import { compileNativeSequence } from "../src/audio/nativeSequence.js";
import { getPatternQueueEntries } from "../src/model/query.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const STEP = 0.125;

function setup({ kind = "bass", tieFirst = true } = {}) {
  const song = createSong({ rowCount: 16, trackCount: 2 });
  const patternId = song.patterns[0].id;
  for (const row of [0, 4, 8]) {
    setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "instrument", 0);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "length", 2);
  }
  if (tieFirst) setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "tie", true);
  const instruments = [createInstrumentSlot({ id: 0, output: { type: "instrument", channel: null, kind }, engineInstrumentId: 7, rootNote: 60 })];
  return { song, instruments };
}
const row = ({ song, instruments }, r) => compileRow(getSelectedPattern(song), song.trackChannels, instruments, r, r * STEP, STEP);

describe("tie", () => {
  it("only synth kinds with a legato mode can tie", () => {
    expect(supportsTieKind("bass")).toBe(true);
    expect(supportsTieKind("fm")).toBe(true);
    expect(supportsTieKind("kick")).toBe(false);
  });

  it("untied notes compile as before", () => {
    const s = setup({ tieFirst: false });
    for (const r of [0, 4, 8]) {
      const [e] = row(s, r);
      expect(e.tie).toBeUndefined();
      expect(e.duration).toBeCloseTo(2 * STEP);
    }
  });

  it("a tied note holds past the next note's start, and only the next note glides in", () => {
    const s = setup();
    const [a] = row(s, 0);
    const [b] = row(s, 4);
    const [c] = row(s, 8);
    expect(a.tie).toBeUndefined();
    expect(a.time + a.duration).toBeGreaterThan(4 * STEP);
    expect(a.time + a.duration).toBeLessThan(5 * STEP);
    expect(b.tie).toBe(true);
    expect(b.duration).toBeCloseTo(2 * STEP);
    expect(c.tie).toBeUndefined();
  });

  it("does nothing on a synth without legato, on the last note, or between different instruments", () => {
    const kick = setup({ kind: "kick" });
    expect(row(kick, 4)[0].tie).toBeUndefined();
    expect(row(kick, 0)[0].duration).toBeUndefined();
    const last = setup({ tieFirst: false });
    setEventField(last.song, { patternId: last.song.patterns[0].id, trackIndex: 0, rowIndex: 8 }, "tie", true);
    expect(row(last, 8)[0].duration).toBeCloseTo(2 * STEP);
    const mixed = setup();
    setEventField(mixed.song, { patternId: mixed.song.patterns[0].id, trackIndex: 0, rowIndex: 4 }, "instrument", 1);
    mixed.instruments.push(createInstrumentSlot({ id: 1, output: { type: "instrument", channel: null, kind: "bass" }, engineInstrumentId: 8, rootNote: 60 }));
    expect(row(mixed, 4)[0].tie).toBeUndefined();
  });

  it("with a ratchet, the last hit holds and the next note still ties in", () => {
    const s = setup();
    setEventField(s.song, { patternId: s.song.patterns[0].id, trackIndex: 0, rowIndex: 0 }, "ratchet", 2);
    const hits = row(s, 0);
    expect(hits).toHaveLength(2);
    expect(hits[0].duration).toBeCloseTo(STEP);
    expect(hits[1].time + hits[1].duration).toBeGreaterThan(4 * STEP);
    expect(row(s, 4)[0].tie).toBe(true);
  });

  it("All steps / None tie only notes whose instrument can tie, and an event with a tie is not empty", () => {
    const { song } = setup({ tieFirst: false });
    const id = song.patterns[0].id;
    setTrackStepsTie(song, id, 0, true, () => true);
    expect(getSelectedPattern(song).tracks[0].events.filter((e) => e.tie)).toHaveLength(3);
    setTrackStepsTie(song, id, 0, false, () => true);
    expect(getSelectedPattern(song).tracks[0].events.filter((e) => e.tie)).toHaveLength(0);
    setTrackStepsTie(song, id, 0, true, () => false);
    expect(getSelectedPattern(song).tracks[0].events.filter((e) => e.tie)).toHaveLength(0);
    expect(isEmptyEvent({ ...createEmptyEvent(), tie: true })).toBe(false);
    expect(createEmptyEvent().tie).toBe(null);
  });

  it("reaches the native sequence as tie: true", () => {
    const { song, instruments } = setup();
    const seq = compileNativeSequence({
      entries: getPatternQueueEntries(song),
      trackChannels: song.trackChannels,
      instruments,
      trackBusIds: [10, 11],
      swing: 0,
      hasSample: () => true,
      paramContext: { trackBusIds: [10, 11], instruments, effectId: () => undefined, nodeParam: () => undefined, instrumentParam: () => undefined, sampleParam: () => undefined },
    });
    expect(seq.events.map((e) => !!e.tie)).toEqual([false, true, false]);
  });

  it("survives save and load", async () => {
    const { song, instruments } = setup();
    const restored = await deserializeProject(serializeProject({ song, instruments, ui: {} }), { loadSampleBytes: async () => null });
    expect(restored.song.patterns[0].tracks[0].events[0].tie).toBe(true);
  });
});
