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
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);

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
    const ui = { selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } };

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

    expect(restored.song.patterns[0].tracks[0].events[0].note).toBe(60);
    expect(restored.song.selectedPatternId).toBe(patternId);
    expect(restored.song.patternQueue).toEqual([patternId]);
    expect(loadedSampleCalls).toEqual(["kick.wav"]);
    expect(restored.instruments[0].sampleId).toBe("fresh-id-for-kick.wav");
    expect(new Uint8Array(restored.instruments[0].sampleAsset.buffer)).toEqual(new Uint8Array(sampleBuffer));
    expect(restored.instruments[1].sampleId).toBe(null);
    expect(restored.ui).toEqual(ui);
  });

  it("defaults a pre-existing track's playback length to its pattern's rowCount (v2 file saved before per-track length existed)", async () => {
    const song = createSong();
    delete song.patterns[0].tracks[0].length; // simulate a v2 file saved before this field existed
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.patterns[0].tracks[0].length).toBe(64);
    expect(restored.song.patterns[0].tracks[1].length).toBe(64); // untouched track, already had it
  });

  it("defaults trackChannel.fx / song.masterFx on a project saved before the FX feature existed", async () => {
    const song = createSong();
    delete song.trackChannels[0].fx; // simulate a v2 file saved before trackChannel.fx existed
    delete song.masterFx; // simulate a v2 file saved before song.masterFx existed
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].fx).toEqual({});
    expect(restored.song.masterFx).toEqual({});
  });

  it("derives fxChain/masterFxChain for a project saved before FX chains existed, from whatever FX it already used", async () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    // Simulate a v2 file saved before fxChain existed at all: a non-default fx bag value (the
    // old implicit "enabled" signal) on track 0's delay, and a cell automating track 1's
    // compressor directly, with no fxChain/masterFxChain field anywhere.
    song.trackChannels[0].fx = { "delay.mix": 0.4 };
    delete song.trackChannels[0].fxChain;
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "note", 60);
    song.patterns[0].tracks[1].events[0].fx = { "comp.threshold": -12 };
    delete song.trackChannels[1].fxChain;
    delete song.trackChannels[2].fxChain;
    song.masterFx = { "reverb.mix": 0.3 };
    delete song.masterFxChain;

    const serialized = serializeProject({ song, instruments: [], ui: {} });
    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].fxChain).toEqual([{ type: "delay", bypassed: false }]);
    expect(restored.song.trackChannels[1].fxChain).toEqual([{ type: "compressor", bypassed: false }]);
    expect(restored.song.trackChannels[2].fxChain).toEqual([]);
    expect(restored.song.masterFxChain).toEqual([{ type: "reverb", bypassed: false }]);
  });

  it("rejects an unsupported format version", async () => {
    await expect(deserializeProject({ formatVersion: 999, instruments: [] }, { loadSampleBytes: async () => null })).rejects.toThrow();
  });

  it("migrates a v1 (bank-based) project into the v2 pattern pool/queue shape", async () => {
    const oldProject = {
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      song: {
        name: "Old Song",
        bpm: 120,
        trackCount: 2,
        rowCount: 4,
        trackChannels: [],
        banks: [
          {
            id: 0,
            name: "Bank A",
            activePatternIndex: 1,
            patterns: [
              { name: "A1", rowCount: 4, tracks: [{ events: [] }, { events: [] }] },
              { name: "A2", rowCount: 4, tracks: [{ events: [] }, { events: [] }] },
            ],
          },
          {
            id: 1,
            name: "Bank B",
            activePatternIndex: 0,
            patterns: [{ name: "B1", rowCount: 4, tracks: [{ events: [] }, { events: [] }] }],
          },
        ],
      },
      instruments: [],
      ui: { activeBankIndex: 0, selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } },
    };

    const restored = await deserializeProject(oldProject, { loadSampleBytes: async () => null });

    // All three patterns survive, flattened into one pool/queue in bank order.
    expect(restored.song.patterns.map((p) => p.name)).toEqual(["A1", "A2", "B1"]);
    expect(restored.song.patternQueue).toHaveLength(3);
    // Bank A's activePatternIndex (1) was the previously-active bank (0) — A2 becomes selected.
    const selected = restored.song.patterns.find((p) => p.id === restored.song.selectedPatternId);
    expect(selected.name).toBe("A2");
  });
});
