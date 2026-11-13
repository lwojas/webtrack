import { describe, expect, it, vi } from "vitest";
import { createCcController } from "../src/midi/cc/ccController.js";
import { CC_CONTROLS } from "../src/midi/cc/ccCatalog.js";
import { buildLookup, defaultBindings, diffFromDefaults, findConflicts, loadOverrides, resolveBindings, STORAGE_KEY } from "../src/midi/cc/ccMap.js";

function memoryStorage(initial) {
  const data = new Map(initial ? [[STORAGE_KEY, JSON.stringify(initial)]] : []);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}

function setup({ overrides, playing = false } = {}) {
  const channels = Array.from({ length: 16 }, () => ({ muted: false, solo: false, volume: 1, pan: 0 }));
  const store = {
    getState: () => ({ song: { trackChannels: channels } }),
    setTrackChannelVolume: vi.fn((i, v) => (channels[i].volume = v)),
    setTrackChannelMuted: vi.fn((i, v) => (channels[i].muted = v)),
    setTrackChannelSolo: vi.fn((i, v) => (channels[i].solo = v)),
    toggleEditMode: vi.fn(),
  };
  const fxController = { setTrackPan: vi.fn() };
  const playbackController = { isPlaying: () => playing, stop: vi.fn() };
  const togglePlayback = vi.fn();
  const queue = [];
  const storage = memoryStorage(overrides);
  const cc = createCcController({ store, fxController, playbackController, togglePlayback, storage, schedule: (fn) => queue.push(fn), requestMIDIAccess: undefined });
  const flush = () => queue.splice(0).forEach((fn) => fn());
  const send = (channel, number, value) => cc.handleMessage([0xb0 | channel, number, value]);
  return { cc, store, fxController, playbackController, togglePlayback, storage, flush, send, channels };
}

describe("default map", () => {
  it("has the documented defaults", () => {
    const b = defaultBindings();
    expect(b["strip.volume"]).toEqual({ cc: 7, channel: null });
    expect(b["strip.pan"].cc).toBe(10);
    expect(b["strip.solo"].cc).toBe(21);
    expect(b["strip.mute"].cc).toBe(20);
    expect(b["transport.play"]).toEqual({ cc: 45, channel: 0 });
    expect(b["transport.record"]).toEqual({ cc: 44, channel: 0 });
    expect(b["transport.stop"]).toEqual({ cc: 46, channel: 0 });
  });

  it("has no shared (channel, cc) between controls", () => {
    expect(findConflicts(defaultBindings())).toEqual({});
  });
});

describe("routing", () => {
  it("CC7 on channel n drives strip n's volume, scaled to the fader's 0..1.5, one write per frame", () => {
    const t = setup();
    t.send(2, 7, 10);
    t.send(2, 7, 64);
    t.send(2, 7, 127);
    expect(t.store.setTrackChannelVolume).not.toHaveBeenCalled();
    t.flush();
    expect(t.store.setTrackChannelVolume).toHaveBeenCalledTimes(1);
    expect(t.store.setTrackChannelVolume).toHaveBeenCalledWith(2, 1.5);
  });

  it("CC10 pans around 64 and clamps at the ends", () => {
    const t = setup();
    t.send(0, 10, 64);
    t.send(1, 10, 0);
    t.send(15, 10, 127);
    t.flush();
    expect(t.fxController.setTrackPan.mock.calls).toEqual([[0, 0], [1, -1], [15, 1]]);
  });

  it("CC20 / CC21 toggle mute and solo on a press and ignore the release", () => {
    const t = setup();
    t.send(3, 20, 127);
    t.send(3, 20, 0);
    expect(t.channels[3].muted).toBe(true);
    t.send(3, 20, 127);
    expect(t.channels[3].muted).toBe(false);
    t.send(4, 21, 127);
    expect(t.channels[4].solo).toBe(true);
    expect(t.store.setTrackChannelSolo).toHaveBeenCalledTimes(1);
  });

  it("transport: play starts only when stopped, stop stops, record toggles; channel 1 only", () => {
    const t = setup();
    t.send(0, 45, 127);
    expect(t.togglePlayback).toHaveBeenCalledTimes(1);
    t.send(0, 45, 0);
    t.send(0, 46, 127);
    expect(t.playbackController.stop).toHaveBeenCalledTimes(1);
    t.send(0, 44, 127);
    expect(t.store.toggleEditMode).toHaveBeenCalledTimes(1);
    t.send(1, 45, 127);
    expect(t.togglePlayback).toHaveBeenCalledTimes(1);

    const playing = setup({ playing: true });
    playing.send(0, 45, 127);
    expect(playing.togglePlayback).not.toHaveBeenCalled();
  });

  it("ignores unbound CCs, non-CC messages and strips past the track count", () => {
    const t = setup();
    t.send(0, 99, 127);
    t.cc.handleMessage([0x90, 60, 100]);
    t.cc.handleMessage([0xb0]);
    t.flush();
    expect(t.store.setTrackChannelMuted).not.toHaveBeenCalled();
    t.channels.length = 4;
    t.send(9, 20, 127);
    expect(t.store.setTrackChannelMuted).not.toHaveBeenCalled();
  });
});

describe("editing the map", () => {
  it("a rebind moves the control, persists only the change, and RESET restores the default", () => {
    const t = setup();
    expect(t.cc.setBinding("strip.mute", { cc: 30, channel: 5 })).toBe(true); // channel is ignored for a strip control
    t.send(1, 20, 127);
    expect(t.channels[1].muted).toBe(false);
    t.send(1, 30, 127);
    expect(t.channels[1].muted).toBe(true);
    expect(JSON.parse(t.storage.data.get(STORAGE_KEY))).toEqual({ "strip.mute": { cc: 30, channel: null } });
    t.cc.resetBinding("strip.mute");
    expect(t.storage.data.has(STORAGE_KEY)).toBe(false);
    t.send(1, 20, 127);
    expect(t.channels[1].muted).toBe(false);
  });

  it("a global control takes its channel; invalid bindings are refused", () => {
    const t = setup();
    expect(t.cc.setBinding("transport.stop", { cc: 10, channel: 3 })).toBe(true);
    t.send(3, 10, 127);
    expect(t.playbackController.stop).toHaveBeenCalledTimes(1);
    expect(t.cc.setBinding("transport.stop", { cc: 200, channel: 0 })).toBe(false);
    expect(t.cc.setBinding("transport.stop", { cc: 1, channel: 16 })).toBe(false);
    expect(t.cc.setBinding("nope", { cc: 1, channel: 0 })).toBe(false);
  });

  it("learn takes the next CC (and its channel) instead of routing it, then clears", () => {
    const t = setup();
    t.cc.setLearning("transport.record");
    expect(t.cc.getSnapshot().learning).toBe("transport.record");
    t.send(6, 80, 127);
    expect(t.store.toggleEditMode).not.toHaveBeenCalled();
    expect(t.cc.getSnapshot().learning).toBe(null);
    expect(t.cc.getSnapshot().bindings["transport.record"]).toEqual({ cc: 80, channel: 6 });
    t.send(6, 80, 127);
    expect(t.store.toggleEditMode).toHaveBeenCalledTimes(1);
  });

  it("flags shared CCs but keeps both live; the snapshot is stable until something changes", () => {
    const t = setup();
    const first = t.cc.getSnapshot();
    expect(t.cc.getSnapshot()).toBe(first);
    t.cc.setBinding("transport.stop", { cc: 45, channel: 0 });
    expect(t.cc.getSnapshot().conflicts["transport.stop"]).toEqual(["transport.play"]);
    t.send(0, 45, 127);
    expect(t.togglePlayback).toHaveBeenCalledTimes(1);
    expect(t.playbackController.stop).toHaveBeenCalledTimes(1);
  });

  it("the monitor only does work while someone listens", () => {
    const t = setup();
    t.send(0, 7, 5);
    expect(t.cc.getActivity()).toBe(null);
    const seen = vi.fn();
    const off = t.cc.subscribeActivity(seen);
    t.send(2, 9, 33);
    expect(t.cc.getActivity()).toEqual({ channel: 2, cc: 9, value: 33 });
    off();
    t.send(0, 7, 6);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("saved maps", () => {
  it("apply over the defaults; unknown ids and bad entries are ignored; new catalog entries keep their default", () => {
    const b = resolveBindings({ "strip.volume": { cc: 1 }, "strip.pan": { cc: 300 }, ghost: { cc: 5, channel: 0 }, "transport.play": { cc: 9, channel: 2 } });
    expect(b["strip.volume"].cc).toBe(1);
    expect(b["strip.pan"].cc).toBe(10);
    expect(b["transport.play"]).toEqual({ cc: 9, channel: 2 });
    expect(b["transport.stop"]).toEqual({ cc: 46, channel: 0 });
    expect(Object.keys(diffFromDefaults(b)).sort()).toEqual(["strip.volume", "transport.play"]);
    expect(loadOverrides({ getItem: () => "not json" })).toEqual({});
  });

  it("a controller loads its saved map at start", () => {
    const t = setup({ overrides: { "strip.volume": { cc: 1, channel: null } } });
    t.send(0, 1, 127);
    t.flush();
    expect(t.store.setTrackChannelVolume).toHaveBeenCalledWith(0, 1.5);
  });

  it("the lookup holds one entry per strip per control plus the global ones", () => {
    const lookup = buildLookup(defaultBindings());
    const strips = CC_CONTROLS.filter((d) => d.scope === "strip").length;
    const globals = CC_CONTROLS.length - strips;
    expect(lookup.size).toBe(strips * 16 + globals);
  });
});
