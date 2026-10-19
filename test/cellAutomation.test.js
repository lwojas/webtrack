import { describe, expect, it, vi } from "vitest";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { cloneEvent, isEmptyEvent } from "../src/model/event.js";
import { getSelectedPattern } from "../src/model/query.js";
import { addTrackFx, removeTrackFx, setCellAutomation, replaceTrackAutomationRange, purgeInstrumentAutomation, setTrackLength } from "../src/model/mutations.js";
import { BUS_GAIN_KEY, fxKey, instKey, parseKey, getAutomationParam, getBaseValue, getInstrumentAutomationParams, getCellValue, listCellEntries, trackPoints, trackKeys, nextPoint } from "../src/model/cellAutomation.js";
import { compileRowAutomation, compileRowFx } from "../src/audio/compile.js";
import { createLookaheadPlayer } from "../src/audio/lookaheadPlayer.js";
import { createAutomationScheduler, toScheduledParam } from "../src/audio/automation.js";

function setup() {
  const song = createSong({ rowCount: 16 });
  const bass = createInstrumentSlot({ id: 0, output: { type: "instrument", channel: null, kind: "bass", track: null } });
  bass.instrumentParams = { cutoff: 400, tune: 55 };
  const sample = createInstrumentSlot({ id: 1, sampleId: 9 });
  const instruments = [bass, sample];
  const patternId = song.patterns[0].id;
  const ref = (trackIndex, rowIndex) => ({ patternId, trackIndex, rowIndex });
  return { song, instruments, patternId, ref, pattern: () => getSelectedPattern(song) };
}

describe("keys", () => {
  it("parses and builds every kind", () => {
    expect(parseKey(BUS_GAIN_KEY)).toEqual({ kind: "bus", paramId: "bus.gain" });
    expect(parseKey(fxKey(7, "filter.cutoff"))).toEqual({ kind: "fx", instanceId: 7, paramId: "filter.cutoff" });
    expect(parseKey(instKey(3, "cutoff"))).toEqual({ kind: "inst", slot: 3, paramId: "cutoff" });
    expect(parseKey("nonsense")).toBeNull();
    expect(parseKey("fx:x:cutoff")).toBeNull();
  });
});

describe("setCellAutomation", () => {
  it("writes FX, instrument and bus entries, clamps to the parameter's range, and reads them back", () => {
    const { song, instruments, ref, pattern } = setup();
    const id = addTrackFx(song, 0, "utility");
    expect(setCellAutomation(song, instruments, ref(0, 2), fxKey(id, "utility.gain"), -200)).toBe(true);
    expect(getCellValue(pattern().tracks[0].events[2], fxKey(id, "utility.gain"))).toBe(-60); // clamped
    expect(setCellAutomation(song, instruments, ref(0, 3), instKey(0, "cutoff"), 900)).toBe(true);
    expect(pattern().tracks[0].events[3].fx.instruments[0].cutoff).toBe(900);
    expect(setCellAutomation(song, instruments, ref(0, 4), BUS_GAIN_KEY, 0.5)).toBe(true);
    expect(listCellEntries(pattern().tracks[0].events[4]).map((e) => e.key)).toEqual(["bus.gain"]);
    // a sample slot automates its envelope
    expect(setCellAutomation(song, instruments, ref(1, 0), instKey(1, "release"), 0.8)).toBe(true);
  });

  it("refuses targets that do not exist or cannot be automated", () => {
    const { song, instruments, ref } = setup();
    expect(setCellAutomation(song, instruments, ref(0, 0), fxKey(99, "filter.cutoff"), 1000)).toBe(false); // no such instance
    expect(setCellAutomation(song, instruments, ref(0, 0), instKey(5, "cutoff"), 1)).toBe(false); // no such slot
    expect(setCellAutomation(song, instruments, ref(0, 0), instKey(0, "nope"), 1)).toBe(false); // not a bass control
    expect(setCellAutomation(song, instruments, ref(0, 0), instKey(0, "legato"), 1)).toBe(false); // stepped switch
    expect(setCellAutomation(song, instruments, ref(0, 0), instKey(1, "cutoff"), 1)).toBe(false); // sample has no cutoff
    expect(setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), NaN)).toBe(false);
    expect(setCellAutomation(song, instruments, ref(0, 0), "garbage", 1)).toBe(false);
  });

  it("glide marks an entry, is ignored for bus gain, and goes away with the value", () => {
    const { song, instruments, ref, pattern } = setup();
    const k = instKey(0, "cutoff");
    setCellAutomation(song, instruments, ref(0, 0), k, 500, { glide: true });
    expect(listCellEntries(pattern().tracks[0].events[0])[0].glide).toBe(true);
    setCellAutomation(song, instruments, ref(0, 0), k, 600, { glide: false });
    expect(listCellEntries(pattern().tracks[0].events[0])[0].glide).toBe(false);
    setCellAutomation(song, instruments, ref(0, 0), BUS_GAIN_KEY, 0.5, { glide: true });
    expect(pattern().tracks[0].events[0].fx.glide?.[BUS_GAIN_KEY]).toBeUndefined();
    setCellAutomation(song, instruments, ref(0, 0), k, 600, { glide: true });
    setCellAutomation(song, instruments, ref(0, 0), k, null);
    expect(pattern().tracks[0].events[0].fx.glide).toBeUndefined(); // no orphan flag
  });

  it("collapses to an empty event once the last entry is removed", () => {
    const { song, instruments, ref, pattern } = setup();
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), 500, { glide: true });
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "tune"), 60);
    expect(isEmptyEvent(pattern().tracks[0].events[0])).toBe(false);
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), null);
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "tune"), null);
    expect(pattern().tracks[0].events[0].fx).toBeNull();
    expect(isEmptyEvent(pattern().tracks[0].events[0])).toBe(true);
  });

  it("cloning an event deep-copies instruments and glide", () => {
    const { song, instruments, ref, pattern } = setup();
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), 500, { glide: true });
    const copy = cloneEvent(pattern().tracks[0].events[0]);
    copy.fx.instruments[0].cutoff = 1;
    copy.fx.glide[instKey(0, "cutoff")] = false;
    expect(pattern().tracks[0].events[0].fx.instruments[0].cutoff).toBe(500);
    expect(pattern().tracks[0].events[0].fx.glide[instKey(0, "cutoff")]).toBe(true);
  });
});

describe("purges", () => {
  it("removing an FX instance drops its entries and glide flags everywhere on the track", () => {
    const { song, instruments, ref, pattern } = setup();
    const id = addTrackFx(song, 0, "filter");
    setCellAutomation(song, instruments, ref(0, 1), fxKey(id, "filter.cutoff"), 900, { glide: true });
    setCellAutomation(song, instruments, ref(0, 1), instKey(0, "cutoff"), 500);
    removeTrackFx(song, 0, id);
    const e = pattern().tracks[0].events[1];
    expect(e.fx.instances).toBeUndefined();
    expect(e.fx.glide).toBeUndefined();
    expect(e.fx.instruments[0].cutoff).toBe(500); // unrelated entry untouched
  });

  it("purgeInstrumentAutomation drops one slot's entries in every track and pattern, nothing else", () => {
    const { song, instruments, ref, pattern } = setup();
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), 500);
    setCellAutomation(song, instruments, ref(2, 5), instKey(0, "tune"), 60);
    setCellAutomation(song, instruments, ref(1, 0), instKey(1, "release"), 0.5);
    purgeInstrumentAutomation(song, 0);
    expect(pattern().tracks[0].events[0].fx).toBeNull();
    expect(pattern().tracks[2].events[5].fx).toBeNull();
    expect(pattern().tracks[1].events[0].fx.instruments[1].release).toBe(0.5);
  });
});

describe("lane helpers", () => {
  it("lists a track's points inside its loop, finds the next point, and ignores rows past the loop", () => {
    const { song, instruments, ref, pattern } = setup();
    const k = instKey(0, "cutoff");
    for (const [row, v] of [[0, 300], [4, 800], [12, 1200]]) setCellAutomation(song, instruments, ref(0, row), k, v);
    setTrackLength(song, song.patterns[0].id, 0, 8);
    const track = pattern().tracks[0];
    expect(trackPoints(track, k)).toEqual([{ row: 0, value: 300, glide: false }, { row: 4, value: 800, glide: false }]);
    expect(trackKeys(track)).toEqual([k]);
    expect(nextPoint(track, 0, k)).toEqual({ row: 4, value: 800 });
    expect(nextPoint(track, 4, k)).toBeNull(); // row 12 is past the loop point: no wrap, no reach
  });

  it("replaceTrackAutomationRange replaces only the range, one lane", () => {
    const { song, instruments, ref, pattern } = setup();
    const k = instKey(0, "cutoff");
    for (const row of [0, 4, 8, 12]) setCellAutomation(song, instruments, ref(0, row), k, 100 + row);
    setCellAutomation(song, instruments, ref(0, 4), instKey(0, "tune"), 60);
    const rows = replaceTrackAutomationRange(song, instruments, { patternId: song.patterns[0].id, trackIndex: 0 }, k, 4, 8, [{ row: 6, value: 999, glide: true }]);
    expect(rows.sort((a, b) => a - b)).toEqual([4, 6, 8]);
    expect(trackPoints(pattern().tracks[0], k).map((p) => [p.row, p.value, p.glide])).toEqual([[0, 100, false], [6, 999, true], [12, 112, false]]);
    expect(getCellValue(pattern().tracks[0].events[4], instKey(0, "tune"))).toBe(60); // other lane kept
  });

  it("knows each target's parameters and current base", () => {
    const { song, instruments } = setup();
    const id = addTrackFx(song, 0, "filter");
    const channel = song.trackChannels[0];
    expect(getAutomationParam(fxKey(id, "filter.cutoff"), channel, instruments).max).toBe(20000);
    expect(getBaseValue(fxKey(id, "filter.cutoff"), channel, instruments)).toBe(20000);
    expect(getBaseValue(instKey(0, "cutoff"), channel, instruments)).toBe(400);
    expect(getBaseValue(instKey(1, "release"), channel, instruments)).toBe(0.01);
    expect(getInstrumentAutomationParams(instruments[0]).some((p) => p.id === "legato")).toBe(false);
    expect(getInstrumentAutomationParams(instruments[1]).map((p) => p.id)).toEqual(["attack", "decay", "sustain", "release"]);
    expect(getInstrumentAutomationParams(createInstrumentSlot({ id: 2, output: { type: "midi", channel: 0, kind: null, track: null } }))).toEqual([]);
  });
});

describe("compileRowAutomation", () => {
  it("emits steps for FX and instrument entries, not bus gain, and leaves bus gain to compileRowFx", () => {
    const { song, instruments, ref, pattern } = setup();
    const id = addTrackFx(song, 0, "utility");
    setCellAutomation(song, instruments, ref(0, 0), fxKey(id, "utility.gain"), -6);
    setCellAutomation(song, instruments, ref(0, 0), instKey(0, "cutoff"), 900);
    setCellAutomation(song, instruments, ref(0, 0), BUS_GAIN_KEY, 0.5);
    const items = compileRowAutomation(pattern(), 0, 0.125);
    expect(items).toEqual(
      expect.arrayContaining([
        { trackIndex: 0, kind: "fx", instanceId: id, paramId: "utility.gain", value: -6 },
        { trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 900 },
      ]),
    );
    expect(items).toHaveLength(2);
    const fx = compileRowFx(pattern(), 0);
    expect(fx.map((c) => c.paramId).sort()).toEqual(["bus.gain", "utility.gain"]); // never the instrument key
  });

  it("a glide entry becomes a ramp from its value to the next point, over that many steps", () => {
    const { song, instruments, ref, pattern } = setup();
    const k = instKey(0, "cutoff");
    setCellAutomation(song, instruments, ref(0, 2), k, 200, { glide: true });
    setCellAutomation(song, instruments, ref(0, 6), k, 1000);
    const [item] = compileRowAutomation(pattern(), 2, 0.125);
    expect(item).toMatchObject({ from: 200, value: 1000, kind: "inst", slot: 0 });
    expect(item.ramp).toBeCloseTo(4 * 0.125);
    expect(compileRowAutomation(pattern(), 6, 0.125)[0]).toEqual({ trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 1000 }); // the next cell just steps
  });

  it("a glide with no later point in the loop holds as a plain step; polymeter folds per track", () => {
    const { song, instruments, ref, pattern } = setup();
    const k = instKey(0, "cutoff");
    setCellAutomation(song, instruments, ref(0, 4), k, 200, { glide: true });
    expect(compileRowAutomation(pattern(), 4, 0.125)[0]).toEqual({ trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 200 });
    setTrackLength(song, song.patterns[0].id, 0, 6);
    setCellAutomation(song, instruments, ref(0, 0), k, 50);
    expect(compileRowAutomation(pattern(), 6, 0.125)[0].value).toBe(50); // transport step 6 -> local row 0
  });
});

describe("lookahead player routing", () => {
  function run(extra) {
    const runtime = { getCurrentTime: () => 0, schedule: vi.fn(), release: vi.fn(), cancelScheduled: vi.fn(), instrumentNoteOn: vi.fn(), setTempo: vi.fn() };
    const pattern = { id: 0, rowCount: 4, tracks: [{ length: 4, events: Array.from({ length: 4 }, () => ({ note: null, instrument: null })) }] };
    const player = createLookaheadPlayer({ runtime, compileRow: () => [], getStepDurationSeconds: () => 1, ...extra });
    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0 });
    player.stop();
  }

  it("with onAutomation, only bus gain reaches onTrackFxChange; automation goes out with the step's time", () => {
    const seen = [];
    const automation = [];
    run({
      compileRowFx: (_p, step) => (step === 0 ? [{ trackIndex: 0, instanceId: null, paramId: "bus.gain", value: 0.5 }, { trackIndex: 0, instanceId: 3, paramId: "x", value: 1 }] : []),
      compileRowAutomation: (_p, step, duration) => (step === 0 ? [{ trackIndex: 0, kind: "fx", instanceId: 3, paramId: "x", value: 1, duration }] : []),
      onTrackFxChange: (t, i, p, v) => seen.push([i, p, v]),
      onAutomation: (items, time) => automation.push({ items, time }),
    });
    expect(seen).toEqual([[null, "bus.gain", 0.5]]);
    expect(automation).toEqual([{ items: [expect.objectContaining({ instanceId: 3, duration: 1 })], time: 0 }]);
  });
});

describe("scheduling bridge", () => {
  const ctx = {
    trackBusIds: [11, 12],
    instruments: [
      { output: { type: "instrument", kind: "bass" }, engineInstrumentId: 5, sampleId: null },
      { output: { type: "sample" }, engineInstrumentId: null, sampleId: 9 },
      { output: { type: "instrument", kind: "bass" }, engineInstrumentId: null, sampleId: null },
    ],
    effectId: (t, i) => (i === 7 ? 70 : undefined),
    nodeParam: (id) => (id === "utility.gain" ? 41 : undefined),
    instrumentParam: (kind, id) => (kind === "bass" && id === "cutoff" ? 3 : undefined),
    sampleParam: (id) => (id === "release" ? 4 : undefined),
  };

  it("resolves FX, synth and sample targets with the engine's ids and passes ramps through", () => {
    expect(toScheduledParam({ trackIndex: 1, kind: "fx", instanceId: 7, paramId: "utility.gain", value: -6, from: 0, ramp: 0.5 }, 2.5, ctx)).toEqual({
      time: 2.5, value: -6, from: 0, ramp: 0.5, target: { effect: { bus: 12, effect: 70 } }, param: 41,
    });
    expect(toScheduledParam({ trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 900 }, 1, ctx)).toEqual({ time: 1, value: 900, target: { instrument: 5 }, param: 3 });
    expect(toScheduledParam({ trackIndex: 0, kind: "inst", slot: 1, paramId: "release", value: 0.4 }, 1, ctx)).toEqual({ time: 1, value: 0.4, target: { sample: 9 }, param: 4 });
  });

  it("drops what has no live engine object or no engine param", () => {
    expect(toScheduledParam({ trackIndex: 0, kind: "fx", instanceId: 8, paramId: "utility.gain", value: 1 }, 0, ctx)).toBeNull(); // no EffectId
    expect(toScheduledParam({ trackIndex: 0, kind: "inst", slot: 2, paramId: "cutoff", value: 1 }, 0, ctx)).toBeNull(); // not created yet
    expect(toScheduledParam({ trackIndex: 0, kind: "inst", slot: 0, paramId: "nope", value: 1 }, 0, ctx)).toBeNull();
    expect(toScheduledParam({ trackIndex: 0, kind: "inst", slot: 9, paramId: "cutoff", value: 1 }, 0, ctx)).toBeNull();
  });

  it("batches a step's events into one scheduleParams call and restores authored values on stop", () => {
    const runtime = { scheduleParams: vi.fn() };
    const restored = [];
    const scheduler = createAutomationScheduler(() => runtime, () => ctx, {
      fx: (...args) => restored.push(["fx", ...args]),
      instrument: (...args) => restored.push(["inst", ...args]),
    });
    scheduler.schedule(
      [
        { trackIndex: 1, kind: "fx", instanceId: 7, paramId: "utility.gain", value: -6 },
        { trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 900 },
        { trackIndex: 0, kind: "inst", slot: 2, paramId: "cutoff", value: 1 }, // unresolvable
      ],
      3,
    );
    expect(runtime.scheduleParams).toHaveBeenCalledTimes(1);
    expect(runtime.scheduleParams.mock.calls[0][0]).toHaveLength(2);
    scheduler.schedule([{ trackIndex: 0, kind: "inst", slot: 0, paramId: "cutoff", value: 950 }], 4); // same parameter again
    scheduler.restoreBase((item) => (item.kind === "fx" ? 0 : 400));
    expect(restored).toEqual([["fx", 1, 7, "utility.gain", 0], ["inst", 0, "cutoff", 400]]); // once each
    restored.length = 0;
    scheduler.restoreBase(() => 1);
    expect(restored).toEqual([]); // cleared: nothing left to restore
  });
});
