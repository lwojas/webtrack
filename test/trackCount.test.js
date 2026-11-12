import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { addPattern, MAX_TRACKS } from "../src/model/mutations.js";
import * as events from "../src/state/events.js";

describe("store.setTrackCount", () => {
  it("grows every pattern and the channel list together, keeping them index-aligned", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    addPattern(store.getState().song);
    expect(store.setTrackCount(16)).toBe(true);
    const { song } = store.getState();
    expect(song.trackCount).toBe(16);
    expect(song.trackChannels).toHaveLength(16);
    expect(song.trackChannels[15].index).toBe(15);
    song.patterns.forEach((p) => {
      expect(p.tracks).toHaveLength(16);
      expect(p.tracks[15].events).toHaveLength(p.rowCount);
      expect(p.tracks[15].length).toBe(p.rowCount);
    });
  });

  it("clamps to MAX_TRACKS and emits TRACK_COUNT_CHANGED", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const handler = vi.fn();
    store.subscribe(events.TRACK_COUNT_CHANGED, handler);
    store.setTrackCount(999);
    expect(store.getState().song.trackCount).toBe(MAX_TRACKS);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.setTrackCount(MAX_TRACKS)).toBe(false); // unchanged: no event
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shrinks empty trailing tracks and clamps the cursor and selection", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(7, 3, "note");
    expect(store.setTrackCount(4)).toBe(true);
    expect(store.getState().song.trackChannels).toHaveLength(4);
    expect(store.getState().cursor.trackIndex).toBe(3);
    expect(store.getState().selectionAnchor.trackIndex).toBe(3);
  });

  it("refuses to shrink over tracks that still hold notes, or an FX chain", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(6, 0, "note", 60);
    expect(store.setTrackCount(4)).toBe(false);
    expect(store.getState().song.trackCount).toBe(8);
    store.setCell(6, 0, "note", null);
    store.getState().song.trackChannels[5].fxChain.push({ id: 0, type: "reverb" });
    expect(store.setTrackCount(4)).toBe(false);
  });

  it("does nothing while playing", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setTransport(true);
    expect(store.setTrackCount(16)).toBe(false);
    expect(store.getState().song.trackCount).toBe(8);
  });

  it("sends instruments routed to a removed track back to the master bus", () => {
    const slot = createInstrumentSlot({ id: 0, name: "A" });
    slot.output = { ...slot.output, track: 6 };
    const store = createStore({ song: createSong(), instruments: [slot] });
    store.setTrackCount(4);
    expect(store.getState().instruments[0].output.track).toBeNull();
  });

  it("loadProject announces the loaded song's track count", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const handler = vi.fn();
    store.subscribe(events.TRACK_COUNT_CHANGED, handler);
    store.loadProject({ song: createSong({ trackCount: 12 }), instruments: [], ui: {} });
    expect(handler).toHaveBeenCalledWith({ trackCount: 12 });
  });
});
