import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { trackLocalStep } from "../src/model/pattern.js";
import { isEmptyEvent, cloneEvent } from "../src/model/event.js";
import { getEvent, getSelectedPattern, getPattern, isAnyTrackSoloed, getPatternQueueEntries } from "../src/model/query.js";
import {
  setEventField,
  clearEvent,
  setTrackChannelMuted,
  setTrackChannelSolo,
  setTrackChannelVolume,
  setTrackChannelVoiceMode,
  setTrackChannelMaxVoices,
  setTrackFxParam,
  setMasterFxParam,
  setCellFxParam,
  addTrackFx,
  removeTrackFx,
  setTrackFxBypass,
  addMasterFx,
  removeMasterFx,
  setMasterFxBypass,
  selectPattern,
  setPatternRowCount,
  setTrackLength,
  addPattern,
  appendPatternToQueue,
  removeFromPatternQueue,
  duplicatePattern,
  deletePattern,
  renamePattern,
} from "../src/model/mutations.js";
import { noteNumberToName, parseNoteName, toHex } from "../src/model/notes.js";

describe("createSong", () => {
  it("builds the MVP shape: 8 tracks, 64 rows, one starting pattern that is queued and selected", () => {
    const song = createSong();
    expect(song.trackChannels).toHaveLength(8);
    expect(song.patterns).toHaveLength(1);
    expect(song.patternQueue).toEqual([song.patterns[0].id]);
    expect(song.selectedPatternId).toBe(song.patterns[0].id);
    expect(song.patterns[0].tracks).toHaveLength(8);
    expect(song.patterns[0].tracks[0].events).toHaveLength(64);
  });

  it("every track's playback length defaults to the pattern's rowCount — no project is polymetric by default", () => {
    const song = createSong();
    song.patterns[0].tracks.forEach((track) => expect(track.length).toBe(64));
  });

  it("every track channel defaults to poly with a modest voice ceiling, not unlimited", () => {
    const song = createSong();
    song.trackChannels.forEach((channel) => {
      expect(channel.voiceMode).toBe("poly");
      expect(channel.maxVoices).toBe(4);
    });
  });

  it("starts every cell empty", () => {
    const song = createSong();
    const event = getEvent(song, song.patterns[0].id, 0, 0);
    expect(isEmptyEvent(event)).toBe(true);
  });
});

describe("mutations", () => {
  it("setEventField mutates only the targeted cell", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 2, rowIndex: 5 }, "note", 60);
    expect(getEvent(song, patternId, 2, 5).note).toBe(60);
    expect(isEmptyEvent(getEvent(song, patternId, 2, 6))).toBe(true);
  });

  it("clearEvent resets a cell to empty", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    clearEvent(song, { patternId, trackIndex: 0, rowIndex: 0 });
    expect(isEmptyEvent(getEvent(song, patternId, 0, 0))).toBe(true);
  });

  it("track channel mute/solo/volume persist independently of pattern switches", () => {
    const song = createSong();
    setTrackChannelMuted(song, 1, true);
    setTrackChannelSolo(song, 2, true);
    setTrackChannelVolume(song, 3, 0.5);
    expect(song.trackChannels[1].muted).toBe(true);
    expect(isAnyTrackSoloed(song)).toBe(true);
    expect(song.trackChannels[3].volume).toBe(0.5);

    selectPattern(song, song.patterns[0].id); // no-op, only one pattern exists by default
    expect(song.trackChannels[1].muted).toBe(true);
  });

  it("setTrackChannelVoiceMode stores poly/mono and rejects anything else", () => {
    const song = createSong();
    setTrackChannelVoiceMode(song, 0, "mono");
    expect(song.trackChannels[0].voiceMode).toBe("mono");

    setTrackChannelVoiceMode(song, 0, "nonsense");
    expect(song.trackChannels[0].voiceMode).toBe("mono"); // unchanged — invalid mode refused
  });

  it("setTrackChannelMaxVoices rounds and clamps to a minimum of 1, but not to any particular maximum", () => {
    const song = createSong();
    setTrackChannelMaxVoices(song, 0, 2.6);
    expect(song.trackChannels[0].maxVoices).toBe(3);

    setTrackChannelMaxVoices(song, 0, 0);
    expect(song.trackChannels[0].maxVoices).toBe(1);

    setTrackChannelMaxVoices(song, 0, 32);
    expect(song.trackChannels[0].maxVoices).toBe(32);
  });

  it("switching a track to mono doesn't touch its stored maxVoices", () => {
    const song = createSong();
    setTrackChannelMaxVoices(song, 0, 8);
    setTrackChannelVoiceMode(song, 0, "mono");
    expect(song.trackChannels[0].maxVoices).toBe(8);
  });

  it("selectPattern only accepts a patternId that exists", () => {
    const song = createSong();
    selectPattern(song, 999); // out of range — only one pattern exists by default
    expect(song.selectedPatternId).toBe(song.patterns[0].id);
  });
});

describe("FX mutations", () => {
  it("setTrackFxParam sets one entry on the track's own fx bag, leaving every other track untouched", () => {
    const song = createSong();
    setTrackFxParam(song, 0, "filter.cutoff", 1200);
    expect(song.trackChannels[0].fx).toEqual({ "filter.cutoff": 1200 });
  });

  it("setTrackFxParam with value null removes the entry", () => {
    const song = createSong();
    setTrackFxParam(song, 0, "filter.cutoff", 1200);
    setTrackFxParam(song, 0, "filter.cutoff", null);
    expect(song.trackChannels[0].fx).toEqual({});
  });

  it("setMasterFxParam sets an entry on song.masterFx, never on any trackChannel", () => {
    const song = createSong();
    setMasterFxParam(song, "reverb.mix", 0.4);
    expect(song.masterFx).toEqual({ "reverb.mix": 0.4 });
    expect(song.trackChannels.every((c) => Object.keys(c.fx).length === 0)).toBe(true);
  });

  it("setCellFxParam adds a sparse entry to the cell's fx map without touching other fields, once that FX is enabled on the track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    addTrackFx(song, 0, "delay");

    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", 0.25);

    const event = getEvent(song, patternId, 0, 0);
    expect(event.note).toBe(60);
    expect(event.fx).toEqual({ "delay.mix": 0.25 });
  });

  it("setCellFxParam is a no-op if the track doesn't have that param's FX enabled — a cell can never silently activate a disabled FX", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", 0.25);
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
  });

  it("setCellFxParam is never gated for bus.gain — it isn't part of any FX chain", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", 0.5);
    expect(getEvent(song, patternId, 0, 0).fx).toEqual({ "bus.gain": 0.5 });
  });

  it("setCellFxParam with value null removes just that key, collapsing back to fx: null once empty", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    addTrackFx(song, 0, "delay");
    addTrackFx(song, 0, "filter");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", 0.25);
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "filter.cutoff", 1200);

    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", null);
    expect(getEvent(song, patternId, 0, 0).fx).toEqual({ "filter.cutoff": 1200 });

    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "filter.cutoff", null);
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
  });

  it("a cell with no fx entries is still an empty cell (isEmptyEvent)", () => {
    const song = createSong();
    const event = getEvent(song, song.patterns[0].id, 0, 0);
    expect(isEmptyEvent(event)).toBe(true);
  });

  it("a cell with an fx entry set is not an empty cell", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    addTrackFx(song, 0, "delay");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", 0.25);
    expect(isEmptyEvent(getEvent(song, patternId, 0, 0))).toBe(false);
  });

  it("cloneEvent copies the fx map independently — editing one's fx never leaks into the other", () => {
    const original = { note: 60, fx: { "delay.mix": 0.25 } };
    const clone = cloneEvent(original);
    clone.fx["delay.mix"] = 0.9;
    expect(original.fx["delay.mix"]).toBe(0.25);
  });

  it("cloneEvent keeps fx: null as null, not an empty object", () => {
    const clone = cloneEvent({ note: 60, fx: null });
    expect(clone.fx).toBe(null);
  });
});

describe("FX chain mutations", () => {
  it("addTrackFx enables one FX_TYPES id, seeding its params to their catalog defaults", () => {
    const song = createSong();
    addTrackFx(song, 0, "delay");
    expect(song.trackChannels[0].fxChain).toEqual([{ type: "delay", bypassed: false }]);
    expect(song.trackChannels[0].fx).toEqual({ "delay.time": 0.25, "delay.feedback": 0.3, "delay.mix": 0 });
  });

  it("addTrackFx is a no-op if that type is already enabled, and never touches other tracks", () => {
    const song = createSong();
    addTrackFx(song, 0, "delay");
    addTrackFx(song, 0, "delay");
    expect(song.trackChannels[0].fxChain).toHaveLength(1);
    expect(song.trackChannels[1].fxChain).toEqual([]);
  });

  it("removeTrackFx disables an FX and purges matching cell automation across every pattern on that track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const otherPattern = addPattern(song, { name: "Pattern 2" });
    addTrackFx(song, 0, "delay");
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "delay.mix", 0.5);
    setCellFxParam(song, { patternId: otherPattern.id, trackIndex: 0, rowIndex: 1 }, "delay.mix", 0.7);

    removeTrackFx(song, 0, "delay");

    expect(song.trackChannels[0].fxChain).toEqual([]);
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
    expect(getEvent(song, otherPattern.id, 0, 1).fx).toBe(null);
  });

  it("re-enabling a removed FX restores its previously stored parameter values, not the defaults", () => {
    const song = createSong();
    addTrackFx(song, 0, "delay");
    setTrackFxParam(song, 0, "delay.mix", 0.6);
    removeTrackFx(song, 0, "delay");

    addTrackFx(song, 0, "delay");
    expect(song.trackChannels[0].fx["delay.mix"]).toBe(0.6);
  });

  it("setTrackFxBypass flips only the matching chain entry's flag", () => {
    const song = createSong();
    addTrackFx(song, 0, "delay");
    addTrackFx(song, 0, "filter");
    setTrackFxBypass(song, 0, "delay", true);
    expect(song.trackChannels[0].fxChain).toEqual([
      { type: "delay", bypassed: true },
      { type: "filter", bypassed: false },
    ]);
  });

  it("master FX chain mutations mirror the track ones, independently of every trackChannel", () => {
    const song = createSong();
    addMasterFx(song, "reverb");
    expect(song.masterFxChain).toEqual([{ type: "reverb", bypassed: false }]);
    expect(song.masterFx).toEqual({ "reverb.decay": 0.5, "reverb.damping": 0.5, "reverb.mix": 0 });

    setMasterFxBypass(song, "reverb", true);
    expect(song.masterFxChain).toEqual([{ type: "reverb", bypassed: true }]);

    removeMasterFx(song, "reverb");
    expect(song.masterFxChain).toEqual([]);
    expect(song.trackChannels.every((c) => c.fxChain.length === 0)).toBe(true);
  });
});

describe("addPattern / appendPatternToQueue / removeFromPatternQueue", () => {
  it("addPattern appends a new pattern to the pool and the end of the queue, and selects it", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;

    const pattern = addPattern(song, { name: "Verse" });

    expect(song.patterns).toHaveLength(2);
    expect(song.patternQueue).toEqual([firstId, pattern.id]);
    expect(song.selectedPatternId).toBe(pattern.id);
    expect(pattern.name).toBe("Verse");
  });

  it("appendPatternToQueue lets the same pattern occupy more than one queue slot", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;

    appendPatternToQueue(song, firstId);

    expect(song.patterns).toHaveLength(1); // no new pattern created
    expect(song.patternQueue).toEqual([firstId, firstId]);
  });

  it("appendPatternToQueue is a no-op for an id that doesn't exist in the pool", () => {
    const song = createSong();
    appendPatternToQueue(song, 999);
    expect(song.patternQueue).toHaveLength(1);
  });

  it("removeFromPatternQueue refuses to empty the queue", () => {
    const song = createSong();
    removeFromPatternQueue(song, 0);
    expect(song.patternQueue).toHaveLength(1);
  });

  it("removeFromPatternQueue removes one slot by position, leaving duplicate references to the same pattern alone", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    appendPatternToQueue(song, firstId);
    const second = addPattern(song, { name: "Verse" });
    // queue is now [first, first, second], selected is second

    removeFromPatternQueue(song, 1);

    expect(song.patternQueue).toEqual([firstId, second.id]);
    expect(song.selectedPatternId).toBe(second.id); // selection untouched, it wasn't the removed slot
  });

  it("removing the only queue slot referencing the selected pattern falls back to the slot now at that position", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const second = addPattern(song, { name: "Verse" }); // queue: [first, second], selected: second
    const third = addPattern(song, { name: "Chorus" }); // queue: [first, second, third], selected: third

    selectPattern(song, second.id); // select the middle slot's pattern
    removeFromPatternQueue(song, 1); // remove the slot that held it

    expect(song.patternQueue).toEqual([firstId, third.id]);
    expect(song.selectedPatternId).toBe(third.id); // index 1 now holds `third`
  });
});

describe("duplicatePattern", () => {
  it("creates an independent copy with a new id, placed right after the source and selected", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    setEventField(song, { patternId: firstId, trackIndex: 0, rowIndex: 0 }, "note", 60);

    const duplicate = duplicatePattern(song, firstId);

    expect(duplicate.id).not.toBe(firstId);
    expect(duplicate.name).toBe("Pattern 1 copy");
    expect(song.patterns.map((p) => p.id)).toEqual([firstId, duplicate.id]);
    expect(song.selectedPatternId).toBe(duplicate.id);
    expect(getEvent(song, duplicate.id, 0, 0).note).toBe(60);
  });

  it("does not add the duplicate to the queue — that's a separate operation", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const duplicate = duplicatePattern(song, firstId);
    expect(song.patternQueue).toEqual([firstId]);
    expect(song.patternQueue).not.toContain(duplicate.id);
  });

  it("editing the original after duplicating never touches the duplicate, and vice versa", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const duplicate = duplicatePattern(song, firstId);

    setEventField(song, { patternId: firstId, trackIndex: 0, rowIndex: 1 }, "note", 60);
    setEventField(song, { patternId: duplicate.id, trackIndex: 0, rowIndex: 2 }, "note", 62);

    expect(isEmptyEvent(getEvent(song, duplicate.id, 0, 1))).toBe(true);
    expect(isEmptyEvent(getEvent(song, firstId, 0, 2))).toBe(true);
  });

  it("is a no-op for an id that doesn't exist in the pool", () => {
    const song = createSong();
    expect(duplicatePattern(song, 999)).toBeUndefined();
    expect(song.patterns).toHaveLength(1);
  });

  it("copies each track's playback length along with its events", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    setTrackLength(song, firstId, 0, 16);

    const duplicate = duplicatePattern(song, firstId);

    expect(duplicate.tracks[0].length).toBe(16);
    expect(duplicate.tracks[1].length).toBe(64);
  });
});

describe("deletePattern", () => {
  it("refuses to delete the last remaining pattern", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    deletePattern(song, firstId);
    expect(song.patterns).toHaveLength(1);
    expect(song.patternQueue).toEqual([firstId]);
  });

  it("removes the pattern and every queue slot referencing it, without emptying the queue", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const second = addPattern(song, { name: "Verse" });
    appendPatternToQueue(song, firstId); // queue: [first, second, first]

    deletePattern(song, firstId);

    expect(song.patterns).toEqual([second]);
    expect(song.patternQueue).toEqual([second.id]);
  });

  it("falls back to queuing whatever pattern remains if every slot referenced the deleted one", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const second = addPattern(song, { name: "Verse" });
    removeFromPatternQueue(song, 1); // queue: [first] only (second was never queued otherwise)
    appendPatternToQueue(song, firstId); // queue: [first, first]

    deletePattern(song, firstId);

    expect(song.patterns).toEqual([second]);
    expect(song.patternQueue).toEqual([second.id]);
  });

  it("falls back the selected pattern when the deleted one was selected", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    const second = addPattern(song, { name: "Verse" }); // selects second
    deletePattern(song, second.id);
    expect(song.selectedPatternId).toBe(firstId);
  });

  it("is a no-op for an id that doesn't exist in the pool", () => {
    const song = createSong();
    deletePattern(song, 999);
    expect(song.patterns).toHaveLength(1);
  });
});

describe("renamePattern", () => {
  it("renames a pattern", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    renamePattern(song, firstId, "Intro");
    expect(getPattern(song, firstId).name).toBe("Intro");
  });

  it("trims whitespace", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    renamePattern(song, firstId, "  Chorus  ");
    expect(getPattern(song, firstId).name).toBe("Chorus");
  });

  it("rejects an empty/whitespace-only name, keeping the previous one", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    renamePattern(song, firstId, "   ");
    expect(getPattern(song, firstId).name).toBe("Pattern 1");
  });
});

describe("setPatternRowCount", () => {
  it("growing a pattern preserves existing notes and appends empty rows", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 10 }, "note", 60);

    setPatternRowCount(song, patternId, 96);

    const pattern = getPattern(song, patternId);
    expect(pattern.rowCount).toBe(96);
    expect(pattern.tracks[0].events).toHaveLength(96);
    expect(pattern.tracks[0].events[10].note).toBe(60);
    expect(isEmptyEvent(pattern.tracks[0].events[64])).toBe(true);
  });

  it("shrinking a pattern drops notes past the new boundary and keeps the rest", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 5 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 40 }, "note", 62);

    setPatternRowCount(song, patternId, 16);

    const pattern = getPattern(song, patternId);
    expect(pattern.rowCount).toBe(16);
    expect(pattern.tracks[0].events).toHaveLength(16);
    expect(pattern.tracks[0].events[5].note).toBe(60);
  });

  it("is a no-op when the new row count matches the current one", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setPatternRowCount(song, patternId, 64);
    expect(getPattern(song, patternId).rowCount).toBe(64);
  });

  it("a track still at the pattern's full length is resized right along with the grid (default, non-polymetric behavior)", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;

    setPatternRowCount(song, patternId, 32);
    expect(getPattern(song, patternId).tracks[0].length).toBe(32);

    setPatternRowCount(song, patternId, 96);
    expect(getPattern(song, patternId).tracks[0].length).toBe(96);
  });

  it("an explicitly shortened track keeps its own length when the grid grows", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 16);

    setPatternRowCount(song, patternId, 96);

    expect(getPattern(song, patternId).tracks[0].length).toBe(16);
    expect(getPattern(song, patternId).tracks[1].length).toBe(96); // untouched track still tracks the grid
  });

  it("an explicitly shortened track is clamped down, never left claiming more steps than the shrunk grid has", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 48);

    setPatternRowCount(song, patternId, 32);

    expect(getPattern(song, patternId).tracks[0].length).toBe(32);
  });
});

describe("setTrackLength", () => {
  it("sets a single track's playback length, independent of every other track", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;

    setTrackLength(song, patternId, 0, 16);

    expect(getPattern(song, patternId).tracks[0].length).toBe(16);
    expect(getPattern(song, patternId).tracks[1].length).toBe(64);
  });

  it("clamps to at least 1 step", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 0);
    expect(getPattern(song, patternId).tracks[0].length).toBe(1);
  });

  it("clamps to at most however many rows the track actually has", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackLength(song, patternId, 0, 999);
    expect(getPattern(song, patternId).tracks[0].length).toBe(64);
  });

  it("never touches events — shortening then lengthening again brings the same notes back", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 40 }, "note", 60);

    setTrackLength(song, patternId, 0, 8); // the note at row 40 is now outside the playback loop
    expect(getPattern(song, patternId).tracks[0].events[40].note).toBe(60);
    expect(getPattern(song, patternId).tracks[0].events).toHaveLength(64);

    setTrackLength(song, patternId, 0, 64); // lengthen it back
    expect(getPattern(song, patternId).tracks[0].events[40].note).toBe(60);
  });

  it("is a no-op for a pattern/track that doesn't exist", () => {
    const song = createSong();
    expect(() => setTrackLength(song, 999, 0, 16)).not.toThrow();
    expect(() => setTrackLength(song, song.patterns[0].id, 99, 16)).not.toThrow();
  });
});

describe("trackLocalStep", () => {
  it("folds the shared transport step into the track's own length, wrapping independently", () => {
    const trackOf = (length) => ({ length });
    expect(trackLocalStep(trackOf(16), 0)).toBe(0);
    expect(trackLocalStep(trackOf(16), 15)).toBe(15);
    expect(trackLocalStep(trackOf(16), 16)).toBe(0); // wraps
    expect(trackLocalStep(trackOf(12), 16)).toBe(4); // a different track wraps on its own schedule
    expect(trackLocalStep(trackOf(7), 16)).toBe(2);
  });
});

describe("getSelectedPattern / getPatternQueueEntries", () => {
  it("resolves the project's currently selected pattern", () => {
    const song = createSong();
    expect(getSelectedPattern(song)).toBe(song.patterns[0]);
  });

  it("getPatternQueueEntries resolves each queue slot to its pattern, even with duplicates", () => {
    const song = createSong();
    const firstId = song.patterns[0].id;
    appendPatternToQueue(song, firstId);

    const entries = getPatternQueueEntries(song);

    expect(entries).toEqual([
      { queueIndex: 0, patternId: firstId, pattern: song.patterns[0] },
      { queueIndex: 1, patternId: firstId, pattern: song.patterns[0] },
    ]);
  });
});

describe("notes", () => {
  it("round-trips note numbers through display names", () => {
    expect(noteNumberToName(60)).toBe("C-4");
    expect(noteNumberToName(61)).toBe("C#4");
    expect(parseNoteName("C-4")).toBe(60);
    expect(parseNoteName("C#4")).toBe(61);
    expect(parseNoteName(noteNumberToName(72))).toBe(72);
  });

  it("noteNumberToName/parseNoteName handle empty input", () => {
    expect(noteNumberToName(null)).toBe("---");
    expect(parseNoteName("---")).toBe(null);
    expect(parseNoteName(null)).toBe(null);
  });

  it("toHex formats and pads", () => {
    expect(toHex(127)).toBe("7F");
    expect(toHex(1)).toBe("01");
    expect(toHex(null)).toBe("--");
  });
});
