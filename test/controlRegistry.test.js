import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { createControlRegistry } from "../src/control/registry.js";

// A faked playbackController, same convention webdsp's own test suite uses for its
// lookahead-scheduler-shaped logic (drive it against a fake, not a real AudioContext).
function createFakePlaybackController() {
  let playing = false;
  let playheadRow = -1;
  return {
    play: vi.fn(() => {
      playing = true;
    }),
    stop: vi.fn(() => {
      playing = false;
    }),
    isPlaying: () => playing,
    getPlayheadRow: () => playheadRow,
    switchPattern: vi.fn(),
    __setPlayheadRow: (row) => {
      playheadRow = row;
    },
  };
}

function createTestContext() {
  const song = createSong();
  const store = createStore({ song, instruments: [] });
  const playbackController = createFakePlaybackController();
  const registry = createControlRegistry({ store, playbackController });
  return { store, playbackController, registry };
}

describe("control registry — contract.js's table is the only place ids are declared", () => {
  it("builds a control for every id the contract lists", () => {
    const { registry } = createTestContext();
    expect(registry.getControl("transport.playing")).toBeDefined();
    expect(registry.getControl("transport.playheadRow")).toBeDefined();
    expect(registry.getControl("pattern.selected")).toBeDefined();
    expect(registry.getControl("track.0.muted")).toBeDefined();
    expect(registry.getControl("track.7.volume")).toBeDefined();
    expect(registry.getControl("cursor.row")).toBeDefined();
    expect(registry.getControl("cursor.track")).toBeDefined();
    expect(registry.getAction("transport.play")).toBeDefined();
    expect(registry.getAction("transport.stop")).toBeDefined();
  });

  it("getControl for an unknown id is undefined, not a throw", () => {
    const { registry } = createTestContext();
    expect(registry.getControl("nonexistent.id")).toBeUndefined();
  });
});

describe("control registry — reads reflect live store state", () => {
  it("transport.playing reflects store.setTransport", () => {
    const { store, registry } = createTestContext();
    const control = registry.getControl("transport.playing");
    expect(control.getValue()).toBe(false);
    store.setTransport(true);
    expect(control.getValue()).toBe(true);
  });

  it("pattern.selected control roundtrips through store.selectPattern", () => {
    const { store, registry } = createTestContext();
    const firstId = store.getState().song.selectedPatternId;
    const control = registry.getControl("pattern.selected");
    expect(control.getValue()).toBe(firstId);

    const newPattern = store.addPattern("Verse"); // also selects it
    control.setValue(firstId); // roundtrip back to the original pattern
    expect(control.getValue()).toBe(firstId);
    expect(newPattern.id).not.toBe(firstId);
  });

  it("track.<n>.muted/solo/volume controls roundtrip through the store's trackChannel setters", () => {
    const { registry } = createTestContext();
    expect(registry.getControl("track.3.muted").getValue()).toBe(false);
    registry.getControl("track.3.muted").setValue(true);
    expect(registry.getControl("track.3.muted").getValue()).toBe(true);

    registry.getControl("track.3.volume").setValue(0.42);
    expect(registry.getControl("track.3.volume").getValue()).toBeCloseTo(0.42);
  });

  it("cursor.row/cursor.track are feedback-only and reflect store.moveCursor", () => {
    const { store, registry } = createTestContext();
    store.moveCursor({ row: 5 });
    expect(registry.getControl("cursor.row").getValue()).toBe(5);
    expect(registry.getControl("cursor.track").getValue()).toBe(0);
  });

  it("transport.playheadRow reads straight from playbackController, not the store", () => {
    const { playbackController, registry } = createTestContext();
    playbackController.__setPlayheadRow(17);
    expect(registry.getControl("transport.playheadRow").getValue()).toBe(17);
  });
});

describe("control registry — actions actually invoke playback", () => {
  it("transport.play/transport.stop call through to playbackController", () => {
    const { playbackController, registry } = createTestContext();
    registry.getAction("transport.play").invoke();
    expect(playbackController.play).toHaveBeenCalledTimes(1);
    expect(playbackController.isPlaying()).toBe(true);

    registry.getAction("transport.stop").invoke();
    expect(playbackController.stop).toHaveBeenCalledTimes(1);
    expect(playbackController.isPlaying()).toBe(false);
  });
});

describe("control registry — onChange notifications", () => {
  it("track.<n>.muted fires its onChange listener when the store emits TRACK_CHANNEL_CHANGED", () => {
    const { store, registry } = createTestContext();
    const control = registry.getControl("track.0.muted");
    const listener = vi.fn();
    const unsubscribe = control.onChange(listener);

    store.setTrackChannelMuted(0, true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setTrackChannelMuted(0, false);
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribing
  });
});
