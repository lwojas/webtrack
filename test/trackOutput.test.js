import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { createStore } from "../src/state/store.js";
import { effectiveOutputTrack, outputTargets, sanitizeOutputTracks } from "../src/model/trackChannel.js";

function makeStore() {
  return createStore({ song: createSong(), instruments: [] });
}

describe("track output routing", () => {
  it("defaults to MASTER and only writes outputTrack when routed", () => {
    const store = makeStore();
    const channels = store.getState().song.trackChannels;
    expect(channels[0].outputTrack).toBeUndefined();
    expect(store.setTrackChannelOutput(0, 3)).toBe(true);
    expect(channels[0].outputTrack).toBe(3);
    expect(store.setTrackChannelOutput(0, null)).toBe(true);
    expect(channels[0].outputTrack).toBeUndefined();
  });

  it("refuses self-routes, unknown tracks and loops", () => {
    const store = makeStore();
    const channels = store.getState().song.trackChannels;
    expect(store.setTrackChannelOutput(1, 1)).toBe(false);
    expect(store.setTrackChannelOutput(1, 99)).toBe(false);
    store.setTrackChannelOutput(0, 1);
    store.setTrackChannelOutput(1, 2);
    expect(store.setTrackChannelOutput(2, 0)).toBe(false);
    expect(outputTargets(channels, 2)).not.toContain(0);
    expect(outputTargets(channels, 2)).not.toContain(1);
    expect(effectiveOutputTrack(channels[2])).toBeNull();
  });

  it("sends a route to MASTER when its target track is removed by a shrink", () => {
    const store = makeStore();
    const channels = store.getState().song.trackChannels;
    store.setTrackChannelOutput(0, 7);
    store.setTrackChannelOutput(1, 2);
    expect(store.setTrackCount(4)).toBe(true);
    expect(channels[0].outputTrack).toBeUndefined();
    expect(channels[1].outputTrack).toBe(2);
  });

  it("sanitizes invalid and looping routes from a loaded project", () => {
    const channels = [{ outputTrack: 1 }, { outputTrack: 0 }, { outputTrack: 2 }, { outputTrack: -1 }, { outputTrack: "x" }, { outputTrack: 3 }];
    // the 0<->1 loop is broken at its first track; 1 -> 0 is then a plain valid route
    expect(sanitizeOutputTracks(channels)).toBe(true);
    expect(channels.map((c) => c.outputTrack)).toEqual([undefined, 0, undefined, undefined, undefined, 3]);
  });
});
