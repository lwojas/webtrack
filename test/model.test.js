import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
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
  setTrackChannelPan,
  setMasterPan,
  setTrackFxParam,
  setMasterFxParam,
  setTrackFxInstanceParam,
  setMasterFxInstanceParam,
  setCellFxParam,
  setCellFxInstanceParam,
  addTrackFx,
  removeTrackFx,
  setTrackFxBypass,
  moveTrackFx,
  addMasterFx,
  removeMasterFx,
  setMasterFxBypass,
  moveMasterFx,
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
  it("setTrackFxParam sets the flat bus.gain entry, leaving every other track untouched", () => {
    const song = createSong();
    setTrackFxParam(song, 0, "bus.gain", 1.5);
    expect(song.trackChannels[0].fx["bus.gain"]).toBe(1.5);
    expect(song.trackChannels[1].fx["bus.gain"]).toBeUndefined();
  });

  it("setTrackFxParam with value null removes the entry", () => {
    const song = createSong();
    setTrackFxParam(song, 0, "bus.gain", 1.5);
    setTrackFxParam(song, 0, "bus.gain", null);
    expect(song.trackChannels[0].fx["bus.gain"]).toBeUndefined();
  });

  it("setMasterFxParam sets bus.gain on song.masterFx, never on any trackChannel", () => {
    const song = createSong();
    setMasterFxParam(song, "bus.gain", 0.4);
    expect(song.masterFx["bus.gain"]).toBe(0.4);
    expect(song.trackChannels.every((c) => c.fx["bus.gain"] === undefined)).toBe(true);
  });

  it("setCellFxParam adds a sparse bus.gain entry to the cell's fx map without touching other fields — never gated, it isn't part of any FX chain", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);

    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", 0.5);

    const event = getEvent(song, patternId, 0, 0);
    expect(event.note).toBe(60);
    expect(event.fx).toEqual({ "bus.gain": 0.5 });
  });

  it("setCellFxParam with value null removes bus.gain, collapsing back to fx: null once empty", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", 0.5);
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", null);
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
    setCellFxParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, "bus.gain", 0.5);
    expect(isEmptyEvent(getEvent(song, patternId, 0, 0))).toBe(false);
  });

  it("setCellFxInstanceParam adds a sparse entry under the instance's own bag, once that instance is in the track's chain", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    const id = addTrackFx(song, 0, "delay");

    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, id, "delay.mix", 0.25);

    const event = getEvent(song, patternId, 0, 0);
    expect(event.note).toBe(60);
    expect(event.fx).toEqual({ instances: { [id]: { "delay.mix": 0.25 } } });
  });

  it("setCellFxInstanceParam is a no-op if the instance isn't in the track's chain — a cell can never silently reference a removed/nonexistent instance", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, 999, "delay.mix", 0.25);
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
  });

  it("setCellFxInstanceParam with value null removes just that entry, collapsing back to fx: null once empty", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const delayId = addTrackFx(song, 0, "delay");
    const filterId = addTrackFx(song, 0, "filter");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, delayId, "delay.mix", 0.25);
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterId, "filter.cutoff", 1200);

    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, delayId, "delay.mix", null);
    expect(getEvent(song, patternId, 0, 0).fx).toEqual({ instances: { [filterId]: { "filter.cutoff": 1200 } } });

    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterId, "filter.cutoff", null);
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
  });

  it("two instances of the same type keep independent cell automation — editing one never touches the other", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const filterA = addTrackFx(song, 0, "filter");
    const filterB = addTrackFx(song, 0, "filter");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterA, "filter.cutoff", 400);
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, filterB, "filter.cutoff", 4000);

    const event = getEvent(song, patternId, 0, 0);
    expect(event.fx.instances[filterA]["filter.cutoff"]).toBe(400);
    expect(event.fx.instances[filterB]["filter.cutoff"]).toBe(4000);
  });

  it("cloneEvent copies the flat fx map independently — editing one's fx never leaks into the other", () => {
    const original = { note: 60, fx: { "bus.gain": 0.25 } };
    const clone = cloneEvent(original);
    clone.fx["bus.gain"] = 0.9;
    expect(original.fx["bus.gain"]).toBe(0.25);
  });

  it("cloneEvent copies each instance's own bag independently, not just the outer instances container", () => {
    const original = { note: 60, fx: { instances: { 3: { "delay.mix": 0.25 } } } };
    const clone = cloneEvent(original);
    clone.fx.instances[3]["delay.mix"] = 0.9;
    expect(original.fx.instances[3]["delay.mix"]).toBe(0.25);
  });

  it("cloneEvent keeps fx: null as null, not an empty object", () => {
    const clone = cloneEvent({ note: 60, fx: null });
    expect(clone.fx).toBe(null);
  });
});

describe("FX chain mutations (instance-based stacking)", () => {
  it("addTrackFx adds one new instance, seeding its own param bag to catalog defaults, and returns its id", () => {
    const song = createSong();
    const id = addTrackFx(song, 0, "delay");
    expect(song.trackChannels[0].fxChain).toEqual([{ id, type: "delay", bypassed: false }]);
    expect(song.trackChannels[0].fx.instances[id]).toEqual({ "delay.time": 0.25, "delay.feedback": 0.3, "delay.mix": 0 });
  });

  it("addTrackFx adds a second, independent instance of the same type rather than being a no-op", () => {
    const song = createSong();
    const first = addTrackFx(song, 0, "delay");
    const second = addTrackFx(song, 0, "delay");
    expect(first).not.toBe(second);
    expect(song.trackChannels[0].fxChain).toHaveLength(2);
    expect(song.trackChannels[0].fxChain.every((entry) => entry.type === "delay")).toBe(true);
    expect(song.trackChannels[1].fxChain).toEqual([]);
  });

  it("editing one instance's parameters never touches a sibling instance of the same type", () => {
    const song = createSong();
    const first = addTrackFx(song, 0, "filter");
    const second = addTrackFx(song, 0, "filter");
    setTrackFxInstanceParam(song, 0, first, "filter.cutoff", 400);
    setTrackFxInstanceParam(song, 0, second, "filter.cutoff", 4000);
    expect(song.trackChannels[0].fx.instances[first]["filter.cutoff"]).toBe(400);
    expect(song.trackChannels[0].fx.instances[second]["filter.cutoff"]).toBe(4000);
  });

  it("removeTrackFx removes only the targeted instance and purges matching cell automation across every pattern on that track, leaving a sibling instance of the same type untouched", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    const otherPattern = addPattern(song, { name: "Pattern 2" });
    const toRemove = addTrackFx(song, 0, "delay");
    const sibling = addTrackFx(song, 0, "delay");
    setCellFxInstanceParam(song, { patternId, trackIndex: 0, rowIndex: 0 }, toRemove, "delay.mix", 0.5);
    setCellFxInstanceParam(song, { patternId: otherPattern.id, trackIndex: 0, rowIndex: 1 }, toRemove, "delay.mix", 0.7);

    removeTrackFx(song, 0, toRemove);

    expect(song.trackChannels[0].fxChain).toEqual([{ id: sibling, type: "delay", bypassed: false }]);
    expect(song.trackChannels[0].fx.instances[toRemove]).toBeUndefined();
    expect(getEvent(song, patternId, 0, 0).fx).toBe(null);
    expect(getEvent(song, otherPattern.id, 0, 1).fx).toBe(null);
  });

  it("setTrackFxBypass flips only the matching instance's flag", () => {
    const song = createSong();
    const delayId = addTrackFx(song, 0, "delay");
    const filterId = addTrackFx(song, 0, "filter");
    setTrackFxBypass(song, 0, delayId, true);
    expect(song.trackChannels[0].fxChain).toEqual([
      { id: delayId, type: "delay", bypassed: true },
      { id: filterId, type: "filter", bypassed: false },
    ]);
  });

  it("moveTrackFx reorders one instance within the chain, clamped at either end", () => {
    const song = createSong();
    const a = addTrackFx(song, 0, "filter");
    const b = addTrackFx(song, 0, "delay");
    const c = addTrackFx(song, 0, "reverb");
    expect(song.trackChannels[0].fxChain.map((e) => e.id)).toEqual([a, b, c]);

    moveTrackFx(song, 0, c, -1);
    expect(song.trackChannels[0].fxChain.map((e) => e.id)).toEqual([a, c, b]);

    moveTrackFx(song, 0, a, -1); // already first — clamped, no-op
    expect(song.trackChannels[0].fxChain.map((e) => e.id)).toEqual([a, c, b]);
  });

  it("master FX chain mutations mirror the track ones, independently of every trackChannel", () => {
    const song = createSong();
    const id = addMasterFx(song, "reverb");
    expect(song.masterFxChain).toEqual([{ id, type: "reverb", bypassed: false }]);
    expect(song.masterFx.instances[id]).toEqual({ "reverb.decay": 0.5, "reverb.damping": 0.5, "reverb.mix": 0 });

    setMasterFxBypass(song, id, true);
    expect(song.masterFxChain).toEqual([{ id, type: "reverb", bypassed: true }]);

    const secondId = addMasterFx(song, "reverb");
    moveMasterFx(song, secondId, -1);
    expect(song.masterFxChain.map((e) => e.id)).toEqual([secondId, id]);

    removeMasterFx(song, id);
    expect(song.masterFxChain).toEqual([{ id: secondId, type: "reverb", bypassed: false }]);
    expect(song.trackChannels.every((c) => c.fxChain.length === 0)).toBe(true);
  });

  it("phaser and bitcrusher are addable instances like any other FX kind", () => {
    const song = createSong();
    const phaserId = addTrackFx(song, 0, "phaser");
    const crushId = addTrackFx(song, 0, "bitcrusher");
    expect(song.trackChannels[0].fx.instances[phaserId]).toMatchObject({ "phaser.mix": 0 });
    expect(song.trackChannels[0].fx.instances[crushId]).toMatchObject({ "crush.mix": 0 });
  });
});

describe("pan mutations", () => {
  it("setTrackChannelPan sets one track's pan, clamped to -1..1, leaving every other track untouched", () => {
    const song = createSong();
    setTrackChannelPan(song, 0, 0.5);
    expect(song.trackChannels[0].pan).toBe(0.5);
    expect(song.trackChannels[1].pan).toBe(0);

    setTrackChannelPan(song, 0, 5);
    expect(song.trackChannels[0].pan).toBe(1);
    setTrackChannelPan(song, 0, -5);
    expect(song.trackChannels[0].pan).toBe(-1);
  });

  it("setMasterPan sets song.masterPan, clamped to -1..1", () => {
    const song = createSong();
    setMasterPan(song, -0.3);
    expect(song.masterPan).toBe(-0.3);
    setMasterPan(song, 2);
    expect(song.masterPan).toBe(1);
  });

  it("every track and the master bus default to centre (0)", () => {
    const song = createSong();
    expect(song.masterPan).toBe(0);
    song.trackChannels.forEach((channel) => expect(channel.pan).toBe(0));
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

describe("createInstrumentSlot envelope", () => {
  it("defaults to webdsp's own pre-envelope-equivalent values — attack/decay 0, sustain 1, release 10ms", () => {
    const instrument = createInstrumentSlot({ id: 0 });
    expect(instrument.envelope).toEqual({ attack: 0, decay: 0, sustain: 1, release: 0.01 });
  });

  it("accepts an explicit envelope instead of the default", () => {
    const instrument = createInstrumentSlot({ id: 0, envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 } });
    expect(instrument.envelope).toEqual({ attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 });
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
