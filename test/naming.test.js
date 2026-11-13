import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { createStore } from "../src/state/store.js";
import { createInstrumentSlot, instrumentDisplayName } from "../src/model/instrument.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";
import * as events from "../src/state/events.js";

function makeStore() {
  return createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0, name: "kick.wav" })] });
}

describe("track names", () => {
  it("renames a track, trims it, and emits TRACK_CHANNEL_CHANGED", () => {
    const store = makeStore();
    let emitted = 0;
    store.subscribe(events.TRACK_CHANNEL_CHANGED, () => emitted++);
    store.setTrackChannelName(1, "  Bass  ");
    expect(store.getState().song.trackChannels[1].name).toBe("Bass");
    expect(emitted).toBe(1);
  });

  it("restores the default name when blanked", () => {
    const store = makeStore();
    store.setTrackChannelName(2, "Lead");
    store.setTrackChannelName(2, "   ");
    expect(store.getState().song.trackChannels[2].name).toBe("TRK 3");
  });

  it("persists in the song", async () => {
    const store = makeStore();
    store.setTrackChannelName(0, "Kick");
    const { song, instruments } = store.getState();
    const restored = await deserializeProject(JSON.parse(JSON.stringify(serializeProject({ song, instruments, ui: {} }))), {
      loadSampleBytes: async () => "id",
    });
    expect(restored.song.trackChannels[0].name).toBe("Kick");
  });
});

describe("instrument label and color", () => {
  it("label overrides the sample-derived name and survives loading another sample", () => {
    const store = makeStore();
    store.setInstrumentLabel(0, "Big Kick");
    expect(instrumentDisplayName(store.getState().instruments[0])).toBe("Big Kick");
    store.setInstrumentSample(0, "s1", "other.wav", undefined);
    expect(instrumentDisplayName(store.getState().instruments[0])).toBe("Big Kick");
    store.setInstrumentLabel(0, "");
    expect(instrumentDisplayName(store.getState().instruments[0])).toBe("other.wav");
  });

  it("wraps colors into 0-359 and clears with null", () => {
    const store = makeStore();
    store.setInstrumentColor(0, 370);
    expect(store.getState().instruments[0].color).toBe(10);
    store.setInstrumentColor(0, null);
    expect(store.getState().instruments[0].color).toBe(null);
  });

  it("round-trips through the project file; absent fields load as unset", async () => {
    const store = makeStore();
    store.setInstrumentLabel(0, "Snare");
    store.setInstrumentColor(0, 210);
    const { song, instruments } = store.getState();
    const serialized = JSON.parse(JSON.stringify(serializeProject({ song, instruments, ui: {} })));
    const opts = { loadSampleBytes: async () => "id" };
    const restored = await deserializeProject(serialized, opts);
    expect(restored.instruments[0].label).toBe("Snare");
    expect(restored.instruments[0].color).toBe(210);

    delete serialized.instruments[0].label;
    delete serialized.instruments[0].color;
    const old = await deserializeProject(serialized, opts);
    expect(old.instruments[0].label).toBe(null);
    expect(old.instruments[0].color).toBe(null);
  });
});
