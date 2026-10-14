import { describe, expect, it, vi, afterEach } from "vitest";
import { createRecoveryScheduler, restoreRecoveryState } from "../src/persistence/recovery.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";

afterEach(() => {
  vi.useRealTimers();
});

function makeSnapshotInputs(overrides = {}) {
  return {
    projectId: "proj-1",
    projectName: "My Song",
    song: createSong(),
    instruments: [],
    ui: { selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } },
    ...overrides,
  };
}

describe("createRecoveryScheduler", () => {
  it("doesn't write until the debounce window elapses", () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 1500 });

    scheduler.schedule(makeSnapshotInputs());
    vi.advanceTimersByTime(1499);
    expect(writeRecoveryState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(writeRecoveryState).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of schedule() calls into a single write (one per edit, not one per keystroke)", () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 1500 });

    for (let i = 0; i < 20; i++) {
      scheduler.schedule(makeSnapshotInputs());
      vi.advanceTimersByTime(100); // well under the debounce window each time
    }
    vi.advanceTimersByTime(1500);

    expect(writeRecoveryState).toHaveBeenCalledTimes(1);
  });

  it("writes a project snapshot with embedSampleBytes:false (sample bytes referenced, not embedded)", () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 1500, getNow: () => 12345 });

    const song = createSong();
    setEventField(song, { patternId: song.selectedPatternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Kick",
        localAssetId: "local-kick",
        sampleAsset: { buffer: new ArrayBuffer(4), mimeType: "audio/wav", fileName: "kick.wav" },
      }),
    ];
    scheduler.schedule(makeSnapshotInputs({ song, instruments }));
    vi.advanceTimersByTime(1500);

    expect(writeRecoveryState).toHaveBeenCalledTimes(1);
    const record = writeRecoveryState.mock.calls[0][0];
    expect(record.projectId).toBe("proj-1");
    expect(record.projectName).toBe("My Song");
    expect(record.savedAt).toBe(12345);
    expect(record.project.instruments[0].sample).not.toHaveProperty("dataBase64");
    expect(record.project.instruments[0].sample.localAssetId).toBe("local-kick");
    expect(record.project.song.patterns[0].tracks[0].events[0].note).toBe(60);
  });

  it("cancel() drops a pending write before it fires", () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 1500 });

    scheduler.schedule(makeSnapshotInputs());
    scheduler.cancel();
    vi.advanceTimersByTime(5000);

    expect(writeRecoveryState).not.toHaveBeenCalled();
  });

  it("a failed write is swallowed rather than rejecting/throwing", async () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 1500 });

    scheduler.schedule(makeSnapshotInputs());
    expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    // Let the already-rejected promise's .catch() microtask run before asserting.
    await vi.waitFor(() => expect(writeRecoveryState).toHaveBeenCalledTimes(1));
  });
});

describe("restoreRecoveryState", () => {
  it("resolves a recovery record back into {song, instruments, ui}, resolving referenced samples via getLocalAssetBytes", async () => {
    const song = createSong();
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Resample 16st-01",
        origin: "resample",
        localAssetId: "local-r1",
        sampleAsset: { buffer: new ArrayBuffer(8), mimeType: "audio/wav", fileName: "r.wav" },
      }),
    ];
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    let written;
    writeRecoveryState.mockImplementation((record) => {
      written = record;
      return Promise.resolve();
    });
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 0, getNow: () => 1 });
    scheduler.schedule(makeSnapshotInputs({ song, instruments }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const getLocalAssetBytes = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const restored = await restoreRecoveryState(written, {
      loadSampleBytes: async () => "fresh-id",
      getLocalAssetBytes,
    });

    expect(getLocalAssetBytes).toHaveBeenCalledWith("local-r1");
    expect(restored.instruments[0].origin).toBe("resample");
    expect(restored.instruments[0].sampleId).toBe("fresh-id");
  });
});
