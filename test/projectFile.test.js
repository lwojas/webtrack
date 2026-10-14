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

  it("defaults song.swing to 0 (neutral) on a project saved before swing existed", async () => {
    const song = createSong();
    delete song.swing; // simulate a v2 file saved before swing existed
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.swing).toBe(0);
  });

  it("defaults trackChannel.voiceMode/maxVoices on a project saved before track voice limits existed", async () => {
    const song = createSong();
    delete song.trackChannels[0].voiceMode; // simulate a v2 file saved before this feature existed
    delete song.trackChannels[0].maxVoices;
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    // Defaults to poly/DEFAULT_MAX_VOICES — i.e. the same modest ceiling a brand-new track
    // gets, not unlimited, but every pre-existing track's own setting is left untouched.
    expect(restored.song.trackChannels[0].voiceMode).toBe("poly");
    expect(restored.song.trackChannels[0].maxVoices).toBe(4);
    expect(restored.song.trackChannels[1].voiceMode).toBe("poly");
    expect(restored.song.trackChannels[1].maxVoices).toBe(4);
  });

  it("defaults trackChannel.fx / song.masterFx on a project saved before the FX feature existed", async () => {
    const song = createSong();
    delete song.trackChannels[0].fx; // simulate a v2 file saved before trackChannel.fx existed
    delete song.masterFx; // simulate a v2 file saved before song.masterFx existed
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].fx).toEqual({ instances: {} });
    expect(restored.song.masterFx).toEqual({ instances: {} });
  });

  it("derives fxChain/masterFxChain for a project saved before FX chains existed, from whatever FX it already used, assigning each a fresh instance id and moving its values into fx.instances", async () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    // Simulate a v2 file saved before fxChain (and its per-instance ids) existed at all: a
    // non-default flat fx bag value (the old implicit "enabled" signal) on track 0's delay, and
    // a cell automating track 1's compressor directly via the old flat shape, with no
    // fxChain/masterFxChain field anywhere.
    song.trackChannels[0].fx = { "delay.mix": 0.4 };
    delete song.trackChannels[0].fxChain;
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "note", 60);
    song.patterns[0].tracks[1].events[0].fx = { "comp.threshold": -12 };
    delete song.trackChannels[1].fxChain;
    delete song.trackChannels[2].fxChain;
    song.masterFx = { "reverb.mix": 0.3 };
    delete song.masterFxChain;
    delete song.nextFxInstanceId;

    const serialized = serializeProject({ song, instruments: [], ui: {} });
    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].fxChain).toHaveLength(1);
    const [delayEntry] = restored.song.trackChannels[0].fxChain;
    expect(delayEntry).toMatchObject({ type: "delay", bypassed: false });
    expect(typeof delayEntry.id).toBe("number");
    expect(restored.song.trackChannels[0].fx.instances[delayEntry.id]).toEqual({ "delay.mix": 0.4 });

    expect(restored.song.trackChannels[1].fxChain).toHaveLength(1);
    const [compEntry] = restored.song.trackChannels[1].fxChain;
    expect(compEntry).toMatchObject({ type: "compressor", bypassed: false });
    // The cell's own flat Event.fx automation moved to the same freshly-assigned instance id.
    expect(restored.song.patterns[0].tracks[1].events[0].fx).toEqual({ instances: { [compEntry.id]: { "comp.threshold": -12 } } });

    expect(restored.song.trackChannels[2].fxChain).toEqual([]);

    expect(restored.song.masterFxChain).toHaveLength(1);
    const [reverbEntry] = restored.song.masterFxChain;
    expect(reverbEntry).toMatchObject({ type: "reverb", bypassed: false });
    expect(restored.song.masterFx.instances[reverbEntry.id]).toEqual({ "reverb.mix": 0.3 });

    // Every migrated instance across both tracks and master got a distinct id.
    const allIds = [delayEntry.id, compEntry.id, reverbEntry.id];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("leaves an already-id-based fxChain/fx untouched (new-format project, nothing to migrate)", async () => {
    const song = createSong();
    song.trackChannels[0].fxChain = [{ id: 7, type: "filter", bypassed: false }];
    song.trackChannels[0].fx = { instances: { 7: { "filter.cutoff": 900 } } };
    song.nextFxInstanceId = 8;
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].fxChain).toEqual([{ id: 7, type: "filter", bypassed: false }]);
    expect(restored.song.trackChannels[0].fx.instances[7]).toEqual({ "filter.cutoff": 900 });
  });

  it("round-trips a MIDI-output instrument's output type and channel", async () => {
    const instruments = [createInstrumentSlot({ id: 0, name: "Synth", output: { type: "midi", channel: 3 } })];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.instruments[0].output).toEqual({ type: "midi", channel: 3 });
  });

  it("defaults output to sample on a project saved before MIDI output existed", async () => {
    const instruments = [createInstrumentSlot({ id: 0, name: "Kick", sampleId: "x" })];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });
    delete serialized.instruments[0].output; // simulate a file saved before Instrument.output existed

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh-id" });

    expect(restored.instruments[0].output).toEqual({ type: "sample", channel: null });
  });

  it("embeds a resample-origin instrument's bytes on an explicit save, exactly like an import", async () => {
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Resample 16st-01",
        origin: "resample",
        localAssetId: "local-abc",
        sampleAsset: { buffer: makeBuffer([9, 9, 9]), mimeType: "audio/wav", fileName: "Resample 16st-01.wav" },
      }),
    ];

    const serialized = serializeProject({ song: createSong(), instruments, ui: {} }, { embedSampleBytes: true });

    expect(serialized.instruments[0].origin).toBe("resample");
    expect(serialized.instruments[0].sample.dataBase64).toBeTruthy();
    expect(serialized.instruments[0].sample).not.toHaveProperty("localAssetId");

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh-id" });

    expect(restored.instruments[0].origin).toBe("resample");
    expect(restored.instruments[0].sampleId).toBe("fresh-id");
    expect(new Uint8Array(restored.instruments[0].sampleAsset.buffer)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("references either origin's instrument by localAssetId instead of embedding it when embedSampleBytes is false (persistence/recovery.js's snapshot)", async () => {
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Kick",
        origin: "import",
        localAssetId: "local-kick",
        sampleAsset: { buffer: makeBuffer([1, 2]), mimeType: "audio/wav", fileName: "kick.wav" },
      }),
      createInstrumentSlot({
        id: 1,
        name: "Resample 16st-01",
        origin: "resample",
        localAssetId: "local-resample",
        sampleAsset: { buffer: makeBuffer([9, 9]), mimeType: "audio/wav", fileName: "r.wav" },
      }),
    ];

    const serialized = serializeProject({ song: createSong(), instruments, ui: {} }, { embedSampleBytes: false });

    expect(serialized.instruments[0].sample).not.toHaveProperty("dataBase64");
    expect(serialized.instruments[0].sample.localAssetId).toBe("local-kick");
    expect(serialized.instruments[1].sample).not.toHaveProperty("dataBase64");
    expect(serialized.instruments[1].sample.localAssetId).toBe("local-resample");

    const loadLocalAssetCalls = [];
    const restored = await deserializeProject(serialized, {
      loadSampleBytes: async () => "fresh-id",
      loadLocalAssetBytes: async (id) => {
        loadLocalAssetCalls.push(id);
        return makeBuffer([9]);
      },
    });

    expect(loadLocalAssetCalls).toEqual(["local-kick", "local-resample"]);
    expect(restored.instruments[0].sampleId).toBe("fresh-id");
    expect(restored.instruments[1].sampleId).toBe("fresh-id");
  });

  it("degrades to an empty-but-named slot when a referenced local asset isn't in this browser's storage", async () => {
    const instruments = [
      createInstrumentSlot({
        id: 0,
        name: "Resample 16st-01",
        origin: "resample",
        localAssetId: "local-missing",
        sampleAsset: { buffer: makeBuffer([9]), mimeType: "audio/wav", fileName: "r.wav" },
      }),
    ];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} }, { embedSampleBytes: false });

    const restored = await deserializeProject(serialized, {
      loadSampleBytes: async () => "should-not-be-called",
      loadLocalAssetBytes: async () => undefined, // not found in this browser's IndexedDB
    });

    expect(restored.instruments[0].name).toBe("Resample 16st-01");
    expect(restored.instruments[0].sampleId).toBe(null);
    expect(restored.instruments[0].localAssetId).toBe("local-missing");
  });

  it("defaults origin to import on a project saved before resample existed", async () => {
    const instruments = [createInstrumentSlot({ id: 0, name: "Kick", sampleId: "x" })];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });
    delete serialized.instruments[0].origin; // simulate a file saved before Instrument.origin existed

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh-id" });

    expect(restored.instruments[0].origin).toBe("import");
  });

  it("round-trips an instrument's ADSR envelope", async () => {
    const instruments = [
      createInstrumentSlot({ id: 0, name: "Kick", sampleId: "x", envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 } }),
    ];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh-id" });

    expect(restored.instruments[0].envelope).toEqual({ attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 });
  });

  it("defaults an instrument's envelope to webdsp's own pre-envelope-equivalent values on a project saved before envelopes existed", async () => {
    const instruments = [createInstrumentSlot({ id: 0, name: "Kick", sampleId: "x" })];
    const serialized = serializeProject({ song: createSong(), instruments, ui: {} });
    delete serialized.instruments[0].envelope; // simulate a file saved before Instrument.envelope existed

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => "fresh-id" });

    expect(restored.instruments[0].envelope).toEqual({ attack: 0, decay: 0, sustain: 1, release: 0.01 });
  });

  it("round-trips track/master pan", async () => {
    const song = createSong();
    song.trackChannels[0].pan = -0.6;
    song.masterPan = 0.3;
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].pan).toBe(-0.6);
    expect(restored.song.masterPan).toBe(0.3);
  });

  it("defaults track/master pan to centre (0) on a project saved before panning existed", async () => {
    const song = createSong();
    delete song.trackChannels[0].pan;
    delete song.masterPan;
    const serialized = serializeProject({ song, instruments: [], ui: {} });

    const restored = await deserializeProject(serialized, { loadSampleBytes: async () => null });

    expect(restored.song.trackChannels[0].pan).toBe(0);
    expect(restored.song.masterPan).toBe(0);
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
