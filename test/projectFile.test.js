import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../src/persistence/base64.js";
import { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION } from "../src/persistence/projectFile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField } from "../src/model/mutations.js";

function makeBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

describe("base64 round-trip", () => {
  it("round-trips arbitrary bytes, including a buffer larger than one chunk", () => {
    const bytes = Array.from({ length: 70000 }, (_, i) => i % 256);
    const buffer = makeBuffer(bytes);
    const decoded = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(buffer)));
    expect(Array.from(decoded)).toEqual(bytes);
  });
});

describe("serializeProject / deserializeProject", () => {
  it("round-trips song/instrument/ui state, dropping sampleId and re-loading sample bytes", async () => {
    const song = createSong();
    setEventField(song, { bankIndex: 0, patternIndex: 0, trackIndex: 0, rowIndex: 0 }, "note", 60);

    const sampleBuffer = makeBuffer([1, 2, 3, 4]);
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Kick",
        sampleId: "session-local-id-123",
        sampleAsset: { buffer: sampleBuffer, mimeType: "audio/wav", fileName: "kick.wav" },
      }),
      createInstrumentSlot({ id: 1, name: "Empty" }),
    ];
    const ui = { activeBankIndex: 0, selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } };

    const serialized = serializeProject({ song, instruments, ui });
    expect(serialized.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    // sampleId is session-only and must not be persisted.
    expect(serialized.instruments[0]).not.toHaveProperty("sampleId");
    expect(serialized.instruments[0].sample.fileName).toBe("kick.wav");
    expect(serialized.instruments[1].sample).toBe(null);

    const loadedSampleCalls = [];
    const restored = await deserializeProject(serialized, {
      loadSampleBytes: async (buffer, name) => {
        loadedSampleCalls.push(name);
        return `fresh-id-for-${name}`;
      },
    });

    expect(restored.song.banks[0].patterns[0].tracks[0].events[0].note).toBe(60);
    expect(loadedSampleCalls).toEqual(["kick.wav"]);
    expect(restored.instruments[0].sampleId).toBe("fresh-id-for-kick.wav");
    expect(new Uint8Array(restored.instruments[0].sampleAsset.buffer)).toEqual(new Uint8Array(sampleBuffer));
    expect(restored.instruments[1].sampleId).toBe(null);
    expect(restored.ui).toEqual(ui);
  });

  it("rejects an unsupported format version", async () => {
    await expect(deserializeProject({ formatVersion: 999, instruments: [] }, { loadSampleBytes: async () => null })).rejects.toThrow();
  });
});
