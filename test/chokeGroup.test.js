import { describe, expect, it } from "vitest";
import { compileEvent, compileRow, dropSimultaneousChokeLosers } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { effectiveChokeGroup } from "../src/model/trackChannel.js";
import { setEventField, setTrackChannelChokeGroup } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

function songWithNotes(trackIndexes) {
  const song = createSong();
  const patternId = song.patterns[0].id;
  for (const trackIndex of trackIndexes) {
    setEventField(song, { patternId, trackIndex, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex, rowIndex: 0 }, "instrument", 0);
  }
  return song;
}
const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60 })];

describe("track choke group model", () => {
  it("new channels default to none; only a positive integer is a group", () => {
    const song = createSong();
    expect(song.trackChannels[0].chokeGroup).toBeNull();
    for (const bad of [0, -1, 1.5, NaN, undefined, null, "2"]) expect(effectiveChokeGroup({ chokeGroup: bad })).toBeNull();
    expect(effectiveChokeGroup({ chokeGroup: 3 })).toBe(3);
  });

  it("is set and cleared through the mutation; invalid values store none", () => {
    const song = createSong();
    setTrackChannelChokeGroup(song, 1, 2);
    expect(song.trackChannels[1].chokeGroup).toBe(2);
    setTrackChannelChokeGroup(song, 1, 0);
    expect(song.trackChannels[1].chokeGroup).toBeNull();
    setTrackChannelChokeGroup(song, 1, 4);
    setTrackChannelChokeGroup(song, 1, null);
    expect(song.trackChannels[1].chokeGroup).toBeNull();
  });

  it("persists, and an older project without the field loads as none", async () => {
    const song = createSong();
    setTrackChannelChokeGroup(song, 0, 5);
    delete song.trackChannels[1].chokeGroup;
    const restored = await deserializeProject(serializeProject({ song, instruments: [], ui: {} }), { loadSampleBytes: async () => null });
    expect(restored.song.trackChannels[0].chokeGroup).toBe(5);
    expect(restored.song.trackChannels[1].chokeGroup).toBeNull();
  });
});

describe("choke group compile", () => {
  it("stamps the group on a sample event and omits it without one", () => {
    const song = songWithNotes([0]);
    const event = getSelectedPattern(song).tracks[0].events[0];
    expect(compileEvent(event, song.trackChannels[0], instruments, 1, 0.5).chokeGroup).toBeUndefined();
    setTrackChannelChokeGroup(song, 0, 2);
    expect(compileEvent(event, song.trackChannels[0], instruments, 1, 0.5).chokeGroup).toBe(2);
  });

  it("stamps the group on a synth instrument event", () => {
    const song = songWithNotes([0]);
    setTrackChannelChokeGroup(song, 0, 1);
    const synth = [createInstrumentSlot({ id: 0, rootNote: 60, output: { type: "instrument", kind: "hihat" }, engineInstrumentId: 7 })];
    const event = getSelectedPattern(song).tracks[0].events[0];
    const compiled = compileEvent(event, song.trackChannels[0], synth, 1, 0.5);
    expect(compiled.kind).toBe("instrument");
    expect(compiled.chokeGroup).toBe(1);
  });

  it("simultaneous notes of one group: the later track wins, the earlier is dropped", () => {
    const song = songWithNotes([0, 1, 2]);
    setTrackChannelChokeGroup(song, 0, 1);
    setTrackChannelChokeGroup(song, 1, 1);
    // track 2 has no group: never involved
    const events = compileRow(getSelectedPattern(song), song.trackChannels, instruments, 0, 1, 0.125);
    expect(events.map((e) => e.trackIndex).sort()).toEqual([1, 2]);
  });

  it("different groups, and notes at different times, are not ties", () => {
    const events = [
      { trackIndex: 0, chokeGroup: 1, time: 1 },
      { trackIndex: 1, chokeGroup: 2, time: 1 },
      { trackIndex: 2, chokeGroup: 1, time: 1.01 },
      { trackIndex: 3, time: 1 },
    ];
    expect(dropSimultaneousChokeLosers(events)).toBe(events);
  });

  it("one track's own simultaneous notes (arp chord) never drop each other", () => {
    const events = [
      { trackIndex: 0, chokeGroup: 1, time: 1 },
      { trackIndex: 0, chokeGroup: 1, time: 1 },
    ];
    expect(dropSimultaneousChokeLosers(events)).toHaveLength(2);
  });
});
