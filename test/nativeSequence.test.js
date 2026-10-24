import { describe, expect, it, vi } from "vitest";
import { compileNativeSequence } from "../src/audio/nativeSequence.js";
import { createNativeSequenceSync } from "../src/audio/nativeSequenceSync.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";
import { getPatternQueueEntries } from "../src/model/query.js";

function setup({ swing = 0 } = {}) {
  const song = createSong({ rowCount: 16, trackCount: 2, swing });
  const patternId = song.patterns[0].id;
  const put = (trackIndex, rowIndex, note) => {
    setEventField(song, { patternId, trackIndex, rowIndex }, "note", note);
    setEventField(song, { patternId, trackIndex, rowIndex }, "instrument", 0);
  };
  const instruments = [createInstrumentSlot({ id: 0, name: "Kick", sampleId: 1, rootNote: 60 })];
  const compile = (over = {}) =>
    compileNativeSequence({
      entries: getPatternQueueEntries(song),
      trackChannels: song.trackChannels,
      instruments,
      trackBusIds: [10, 11],
      swing: song.swing,
      hasSample: () => true,
      paramContext: { trackBusIds: [10, 11], instruments, effectId: () => undefined, nodeParam: () => undefined, instrumentParam: () => undefined, sampleParam: () => undefined },
      ...over,
    });
  return { song, put, compile, instruments };
}

describe("compileNativeSequence", () => {
  it("is null with nothing to play", () => {
    expect(setup().compile()).toBeNull();
  });

  it("puts the rows on the quarter-note timeline (four rows to a quarter) and routes to the track's bus", () => {
    const { put, compile } = setup();
    put(0, 0, 60);
    put(1, 6, 62);
    const seq = compile();
    expect(seq.lengthBeats).toBe(4); // 16 rows
    expect(seq.events.map((e) => [e.kind, e.sample, e.beat, e.bus])).toEqual([
      ["sample", 1, 0, 10],
      ["sample", 1, 1.5, 11],
    ]);
    expect(seq.events[1].pitch).toBe(2);
  });

  it("applies swing to odd rows only", () => {
    const { put, compile } = setup({ swing: 60 });
    put(0, 0, 60);
    put(0, 1, 60);
    const [a, b] = compile().events;
    expect(a.beat).toBe(0);
    expect(b.beat).toBeGreaterThan(0.25);
  });

  it("leaves out a sample the engine does not have", () => {
    const { put, compile } = setup();
    put(0, 0, 60);
    expect(compile({ hasSample: () => false })).toBeNull();
  });
});

describe("createNativeSequenceSync", () => {
  it("sends once per distinct result, re-sends a changed one, and starts over on a new runtime", () => {
    vi.useFakeTimers();
    const { song, put, instruments } = setup();
    put(0, 0, 60);
    const runtime = { getCapabilities: () => ({ nativeSequence: true }), getSample: () => ({}), setSequence: vi.fn() };
    let current = runtime;
    const sync = createNativeSequenceSync({ getRuntime: () => current, getState: () => ({ song, instruments }), getTrackBusIds: () => [10, 11] });
    sync.start();
    vi.advanceTimersByTime(200);
    expect(runtime.setSequence).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000); // the slow check finds nothing new
    expect(runtime.setSequence).toHaveBeenCalledTimes(1);

    put(0, 4, 60);
    sync.schedule();
    sync.schedule(); // a burst is one send
    vi.advanceTimersByTime(200);
    expect(runtime.setSequence).toHaveBeenCalledTimes(2);
    expect(runtime.setSequence.mock.calls[1][0].events).toHaveLength(2);

    current = { ...runtime, setSequence: vi.fn() };
    vi.advanceTimersByTime(1100);
    expect(current.setSequence).toHaveBeenCalledTimes(1); // a fresh engine gets the song again
    vi.useRealTimers();
  });

  it("does nothing when the host cannot play a sequence", () => {
    const { song, instruments } = setup();
    const runtime = { getCapabilities: () => ({}), getSample: () => ({}), setSequence: vi.fn() };
    const sync = createNativeSequenceSync({ getRuntime: () => runtime, getState: () => ({ song, instruments }), getTrackBusIds: () => [] });
    sync.sync();
    expect(runtime.setSequence).not.toHaveBeenCalled();
  });
});
