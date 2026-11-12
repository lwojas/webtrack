import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { createStore } from "../src/state/store.js";
import { compileRow } from "../src/audio/compile.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { addTrackFx } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { routeForAudition } from "../src/audio/midiRoute.js";

function makeStore() {
  const slot = createInstrumentSlot({ id: 0, name: "Kick", sampleId: 1, rootNote: 60 });
  return createStore({ song: createSong(), instruments: [slot] });
}

describe("FX send track", () => {
  it("locks an empty track and refuses while it holds notes in any pattern", () => {
    const store = makeStore();
    store.setCell(2, 0, "note", 60);
    expect(store.setTrackChannelFxSend(2, true)).toBe(false);
    expect(store.getState().song.trackChannels[2].fxSend).toBeUndefined();
    expect(store.setTrackChannelFxSend(3, true)).toBe(true);
    expect(store.getState().song.trackChannels[3].fxSend).toBe(true);
    expect(store.setTrackChannelFxSend(3, false)).toBe(true);
    expect(store.getState().song.trackChannels[3].fxSend).toBeUndefined();
  });

  it("blocks note, instrument and other field writes but keeps FX automation and FX chain editing", () => {
    const store = makeStore();
    store.setTrackChannelFxSend(1, true);
    store.setCell(1, 0, "note", 60);
    store.setCell(1, 0, "instrument", 0);
    const event = getSelectedPattern(store.getState().song).tracks[1].events[0];
    expect(event.note).toBeNull();
    expect(event.instrument).toBeNull();
    addTrackFx(store.getState().song, 1, "filter");
    expect(store.getState().song.trackChannels[1].fxChain.length).toBe(1);
    store.setCellFx(1, 0, "bus.gain", 0.5);
    expect(event.fx["bus.gain"]).toBe(0.5);
  });

  it("strips notes but keeps FX automation when pasting into a send track", () => {
    const store = makeStore();
    store.setTrackChannelFxSend(1, true);
    store.setCell(0, 0, "note", 60);
    store.setCell(0, 0, "instrument", 0);
    store.setCellFx(0, 0, "bus.gain", 0.25);
    store.selectCell(0, 0, "note");
    store.copySelection();
    store.selectCell(1, 0, "note");
    store.pasteSelection();
    const event = getSelectedPattern(store.getState().song).tracks[1].events[0];
    expect(event.note).toBeNull();
    expect(event.instrument).toBeNull();
    expect(event.fx["bus.gain"]).toBe(0.25);
  });

  it("never compiles triggers for a send track and is silent on audition", () => {
    const store = makeStore();
    const { song, instruments } = store.getState();
    store.setCell(0, 0, "note", 60);
    store.setCell(0, 0, "instrument", 0);
    const pattern = getSelectedPattern(song);
    // A project hand-edited to hold a note on a send track still plays nothing from it.
    pattern.tracks[1].events[0] = { ...pattern.tracks[0].events[0] };
    song.trackChannels[1].fxSend = true;
    const tracks = compileRow(pattern, song.trackChannels, instruments, 0, 0, 0.125).map((e) => e.trackIndex);
    expect(tracks).toEqual([0]);
    expect(routeForAudition({ song, instruments, selectedInstrumentIndex: 0, trackChannel: song.trackChannels[1], resampleStatus: "idle", knowsSample: () => true })).toBeNull();
  });
});
