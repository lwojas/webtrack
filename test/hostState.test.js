import { describe, expect, it, vi } from "vitest";
import { HOST_STATE_APP, HOST_STATE_FORMAT, collectBlobs, fromHostSnapshot, publishRecord, toHostSnapshot } from "../src/persistence/hostState.js";
import { createRecoveryScheduler } from "../src/persistence/recovery.js";
import { createSong } from "../src/model/song.js";

const buffer = (...bytes) => new Uint8Array(bytes).buffer;
const instruments = () => [
  { localAssetId: "a-1", sampleAsset: { buffer: buffer(1, 2, 3) } },
  { localAssetId: "a-2", sampleAsset: { buffer: buffer(4) } },
  { localAssetId: "a-3", sampleAsset: null }, // no sample
  { sampleAsset: { buffer: buffer(9) } }, // no local id yet
];

describe("host state snapshot", () => {
  it("collects sample bytes by localAssetId, from instruments that have both", () => {
    const list = instruments();
    const blobs = collectBlobs(list);
    expect(Object.keys(blobs)).toEqual(["a-1", "a-2"]);
    expect(blobs["a-1"]).toBe(list[0].sampleAsset.buffer); // the same buffer object, so the host need not resend it
  });

  it("stamps the app and format and carries the record as JSON", () => {
    const record = { projectId: "p", projectName: "Song", savedAt: 1, project: { formatVersion: 2, song: {} } };
    const snapshot = toHostSnapshot(record, { x: buffer(1) });
    expect(snapshot.app).toBe(HOST_STATE_APP);
    expect(snapshot.format).toBe(HOST_STATE_FORMAT);
    expect(JSON.parse(snapshot.data)).toEqual(record);
  });

  it("round-trips through publish and restore", () => {
    const record = { projectId: "p", projectName: "Song", savedAt: 1, project: { formatVersion: 2, song: { bpm: 140 } } };
    const publish = vi.fn();
    publishRecord({ publish }, record, instruments());
    const restored = fromHostSnapshot(publish.mock.calls[0][0]);
    expect(restored.record).toEqual(record);
    expect(Object.keys(restored.blobs)).toEqual(["a-1", "a-2"]);
  });

  it("refuses another app's state, an unknown format, malformed JSON, a non-project record, and null", () => {
    const record = { projectId: "p", project: { formatVersion: 2 } };
    const good = toHostSnapshot(record, {});
    expect(fromHostSnapshot({ ...good, app: "webseq" })).toBeNull();
    expect(fromHostSnapshot({ ...good, format: HOST_STATE_FORMAT + 1 })).toBeNull();
    expect(fromHostSnapshot({ ...good, data: "{nope" })).toBeNull();
    expect(fromHostSnapshot({ ...good, data: JSON.stringify({ projectId: "p" }) })).toBeNull();
    expect(fromHostSnapshot({ ...good, data: JSON.stringify({ project: { song: {} } }) })).toBeNull();
    expect(fromHostSnapshot(null)).toBeNull(); // the host had nothing saved
  });

  it("the record the recovery scheduler builds is publishable and restorable as is", () => {
    vi.useFakeTimers();
    const writeRecoveryState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRecoveryScheduler({ writeRecoveryState, debounceMs: 10 });
    scheduler.schedule({
      projectId: "p-1",
      projectName: "Song",
      song: createSong(),
      instruments: [],
      ui: { selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } },
    });
    vi.advanceTimersByTime(20);
    vi.useRealTimers();
    const record = writeRecoveryState.mock.calls[0][0];
    const restored = fromHostSnapshot(toHostSnapshot(record, {}));
    expect(restored.record.projectId).toBe("p-1");
    expect(restored.record.project.formatVersion).toBeTypeOf("number");
  });
});
