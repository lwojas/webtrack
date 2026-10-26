import { describe, expect, it } from "vitest";
import {
  ARP_MODES,
  ARP_PATTERNS,
  ARP_RATES,
  arpEventsAtRow,
  arpOf,
  arpPool,
  arpRateSteps,
  arpStepVelocity,
  createArp,
  expandArpGroup,
  isArpActive,
  normalizeArp,
  patchArp,
} from "../src/model/arp.js";
import { compileRow, noteDurationSteps } from "../src/audio/compile.js";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { setEventField, setTrackLength } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { createStore } from "../src/state/store.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

const arp = (patch = {}) => ({ ...createArp(), enabled: true, ...patch });
const chord = () => [
  { start: 0, length: 4, pitch: 0, velocity: 1 },
  { start: 4, length: 4, pitch: 4, velocity: 1 },
  { start: 8, length: 4, pitch: 7, velocity: 1 },
];
const pitches = (steps) => steps.map((s) => s.pitch);
const starts = (steps) => steps.map((s) => s.start);

describe("arp config", () => {
  it("is disabled by default and for a channel that predates it", () => {
    expect(createArp().enabled).toBe(false);
    expect(isArpActive({})).toBe(false);
    expect(arpOf({})).toEqual(createArp());
  });

  it("clamps and defaults partial data", () => {
    const n = normalizeArp({ octaves: 9, gate: 0, rate: "bogus", mode: "bogus", pattern: "bogus", velocity: { mode: "accent", amount: 3, steps: [2, -1] } });
    expect(n).toMatchObject({ octaves: 4, gate: 0.05, rate: "1/16", mode: "up", pattern: "1232" });
    expect(n.velocity).toEqual({ mode: "accent", amount: 1, steps: [1, 0] });
    expect(normalizeArp({ velocity: { steps: [] } }).velocity.steps.length).toBeGreaterThan(0);
  });

  it("patches velocity without losing sibling fields", () => {
    const a = patchArp(createArp(), { velocity: { mode: "pattern" } });
    expect(a.velocity.mode).toBe("pattern");
    expect(a.velocity.steps).toEqual(createArp().velocity.steps);
    const store = createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0 }), createInstrumentSlot({ id: 1 })] });
    store.setInstrumentArp(1, { enabled: true, rate: "1/8" });
    const slots = store.getState().instruments;
    expect(slots[1].arp).toMatchObject({ enabled: true, rate: "1/8" });
    expect(slots[0].arp).toBeNull(); // another instrument is untouched
  });

  it("offers every requested rate and mode", () => {
    for (const id of ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"]) expect(ARP_RATES.some((r) => r.id === id)).toBe(true);
    expect(ARP_MODES.map((m) => m.id)).toEqual(["up", "down", "updown", "downup", "random", "played", "pattern"]);
    expect(ARP_PATTERNS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("arp note order", () => {
  it("up / down / up-down / down-up cycle the pool without repeating the turning points", () => {
    const run = (mode) => pitches(expandArpGroup(arp({ mode, rate: "1/8" }), chord()));
    expect(run("up")).toEqual([0, 4, 7, 0, 4, 7]);
    expect(run("down")).toEqual([7, 4, 0, 7, 4, 0]);
    expect(run("updown")).toEqual([0, 4, 7, 4, 0, 4]);
    expect(run("downup")).toEqual([7, 4, 0, 4, 7, 4]);
  });

  it("plays 'as played' in time order, not pitch order", () => {
    const runs = [7, 0, 4].map((pitch, i) => ({ start: i * 2, length: 2, pitch, velocity: 1 }));
    expect(pitches(expandArpGroup(arp({ mode: "played", rate: "1/16" }), runs))).toEqual([7, 0, 4, 7, 0, 4]);
  });

  it("runs a named pattern over the pool, wrapping indices past it", () => {
    expect(pitches(expandArpGroup(arp({ mode: "pattern", pattern: "1324", rate: "1/8" }), chord()))).toEqual([0, 7, 4, 0, 0, 7]);
  });

  it("treats 0 in a pattern as a rest that still advances the pattern", () => {
    const steps = expandArpGroup(arp({ mode: "pattern", pattern: "push", rate: "1/16" }), [
      { start: 0, length: 8, pitch: 0, velocity: 1 },
      { start: 8, length: 0, pitch: 7, velocity: 1 },
    ]);
    expect(starts(steps).slice(0, 3)).toEqual([0, 2, 3]);
    expect(pitches(steps).slice(0, 3)).toEqual([0, 7, 0]);
  });

  it("is deterministic in random mode and only uses pool pitches", () => {
    const a = expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 3);
    expect(expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 3)).toEqual(a);
    expect(a).toHaveLength(12);
    expect(a.every((s) => [0, 4, 7].includes(s.pitch))).toBe(true);
    expect(pitches(expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 4))).not.toEqual(pitches(a));
  });
});

describe("arp octave range, rhythm, gate", () => {
  it("repeats the pool upward", () => {
    expect(arpPool(arp({ octaves: 2 }), chord())).toEqual([0, 4, 7, 12, 16, 19]);
    const runs = [0, 4, 7].map((pitch, i) => ({ start: i * 2, length: 2, pitch, velocity: 1 }));
    expect(pitches(expandArpGroup(arp({ octaves: 2, rate: "1/16" }), runs))).toEqual([0, 4, 7, 12, 16, 19]);
    expect(arpPool(arp({ octaves: 3, mode: "played" }), [{ start: 0, length: 1, pitch: 5, velocity: 1 }])).toEqual([5, 17, 29]);
  });

  it("subdivides each gate window by the rate, including triplets and dotted values", () => {
    const one = [{ start: 0, length: 4, pitch: 0, velocity: 1 }];
    const count = (rate) => expandArpGroup(arp({ rate }), one).length;
    expect(arpRateSteps("1/32")).toBe(0.5);
    expect([count("1/4"), count("1/8"), count("1/16"), count("1/32"), count("1/1")]).toEqual([1, 2, 4, 8, 1]);
    const t = starts(expandArpGroup(arp({ rate: "1/8T" }), one));
    expect(t).toHaveLength(3);
    expect(t[1]).toBeCloseTo(4 / 3, 9);
    expect(starts(expandArpGroup(arp({ rate: "1/8." }), [{ start: 0, length: 6, pitch: 0, velocity: 1 }]))).toEqual([0, 3]);
    expect(starts(expandArpGroup(arp({ rate: "1/8" }), [{ start: 1, length: 4, pitch: 0, velocity: 1 }]))).toEqual([1, 3]);
  });

  it("scales step length by gate and never runs past the window", () => {
    expect(expandArpGroup(arp({ rate: "1/8", gate: 0.5 }), [{ start: 0, length: 4, pitch: 0, velocity: 1 }]).map((s) => s.length)).toEqual([1, 1]);
    expect(expandArpGroup(arp({ rate: "1/16", gate: 1 }), [{ start: 0, length: 1.5, pitch: 0, velocity: 1 }]).map((s) => s.length)).toEqual([1, 0.5]);
  });
});

describe("arp velocity", () => {
  const steps = [1, 0.5];
  it("source / pattern / accent modes", () => {
    expect(arpStepVelocity(0.8, { mode: "source", amount: 1, steps }, 1)).toBe(0.8);
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 1, steps }, 1)).toBe(0.5);
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 0, steps }, 1)).toBe(0.8);
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 0.5, steps }, 1)).toBeCloseTo(0.65, 9);
    expect(arpStepVelocity(0.8, { mode: "accent", amount: 1, steps }, 1)).toBeCloseTo(0.4, 9);
    expect(arpStepVelocity(0.8, { mode: "accent", amount: 1, steps }, 0)).toBe(0.8);
  });

  it("cycles the pattern per arp step", () => {
    const a = arp({ rate: "1/16", velocity: { mode: "pattern", amount: 1, steps: [1, 0.5, 0.75, 0.25] } });
    expect(expandArpGroup(a, [{ start: 0, length: 6, pitch: 0, velocity: 0.9 }]).map((s) => s.velocity)).toEqual([1, 0.5, 0.75, 0.25, 1, 0.5]);
  });
});

describe("arp edge cases", () => {
  it("returns nothing for no source material, arpeggiates a single note over its octaves", () => {
    expect(expandArpGroup(arp(), [])).toEqual([]);
    expect(pitches(expandArpGroup(arp({ octaves: 2, rate: "1/16" }), [{ start: 0, length: 4, pitch: 3, velocity: 1 }]))).toEqual([3, 15, 3, 15]);
    expect(expandArpGroup(arp(), [{ start: 0, length: 0, pitch: 0, velocity: 1 }])).toEqual([]);
  });
});

// --- tracker adapter and compileRow ---

// Shared across tests; songWith() resets/sets slot 0's arp each time (the arp lives on the instrument).
const instruments = [createInstrumentSlot({ id: 0, name: "Kick", sampleId: 1, rootNote: 60 }), createInstrumentSlot({ id: 1, name: "Snare", sampleId: 2, rootNote: 60 })];
const STEP = 0.125;

function songWith(notes, { length, arpPatch } = {}) {
  const song = createSong();
  const patternId = song.patterns[0].id;
  for (const [row, note, extra] of notes) {
    setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "note", note);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "instrument", 0);
    for (const [field, value] of Object.entries(extra ?? {})) setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, field, value);
  }
  if (length) setTrackLength(song, patternId, 0, length);
  instruments[0].arp = arpPatch ? patchArp(createArp(), arpPatch) : null;
  instruments[1].arp = null;
  return song;
}
const rowEvents = (song, step, time = 10) => compileRow(getSelectedPattern(song), song.trackChannels, instruments, step, time, STEP);
const stepEvents = (song, from, to) => Array.from({ length: to - from }, (_, i) => rowEvents(song, from + i)).flat();

describe("arpEventsAtRow", () => {
  it("returns only the steps that start inside the row, with sub-row offsets", () => {
    const song = songWith([[0, 60, { length: 2 }]], { arpPatch: { enabled: true, rate: "1/32", gate: 1 } });
    const track = getSelectedPattern(song).tracks[0];
    const a = arpOf(instruments[0]);
    const row0 = arpEventsAtRow(track, 0, a, noteDurationSteps);
    expect(row0.map((e) => e.offset)).toEqual([0, 0.5]);
    expect(row0[0].durationSteps).toBe(0.5);
    expect(arpEventsAtRow(track, 1, a, noteDurationSteps).map((e) => e.offset)).toEqual([0, 0.5]);
    expect(arpEventsAtRow(track, 2, a, noteDurationSteps)).toEqual([]);
  });

  it("builds the chord from the whole bar and clips runs at the bar line", () => {
    const song = songWith([[0, 60, { length: 2 }], [2, 64, { length: 2 }], [14, 67, { length: 6 }], [16, 72, { length: 2 }]], { arpPatch: { enabled: true, rate: "1/16" } });
    const track = getSelectedPattern(song).tracks[0];
    const a = arpOf(instruments[0]);
    const notesFor = (from, to) => Array.from({ length: to - from }, (_, i) => arpEventsAtRow(track, from + i, a, noteDurationSteps)).flat().map((e) => e.event.note);
    // the bar's pool is {60, 64, 67}; its step counter runs on across the notes: 60 64 | 67 60 ... | 64 67
    expect(notesFor(0, 4)).toEqual([60, 64, 67, 60]);
    expect(notesFor(14, 16)).toEqual([64, 67]);
    expect(notesFor(16, 20).slice(0, 2)).toEqual([72, 72]);
    // row 14's 6-step note carries into bar 2 up to the note at row 16, which cuts it; bar 2 starts a fresh pool
    expect(notesFor(14, 18)).toEqual([64, 67, 72, 72]);
  });
});

describe("arpEventsAtRow long notes", () => {
  it("keeps arpeggiating in every bar a long note covers", () => {
    const song = songWith([[0, 60, { length: 40 }]], { arpPatch: { enabled: true, rate: "1/4", gate: 1 }, length: 48 });
    const track = getSelectedPattern(song).tracks[0];
    const a = arpOf(instruments[0]);
    const starts = [];
    for (let r = 0; r < 48; r++) if (arpEventsAtRow(track, r, a, noteDurationSteps).length) starts.push(r);
    expect(starts).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
  });
});

describe("compileRow with an arp", () => {
  it("an absent, or disabled, arp compiles exactly the stored notes", () => {
    const song = songWith([[0, 60], [4, 64]]);
    const plain = Array.from({ length: 8 }, (_, step) => rowEvents(song, step));
    instruments[0].arp = { ...createArp(), rate: "1/32", octaves: 4 }; // configured, but off
    for (let step = 0; step < 8; step++) expect(rowEvents(song, step)).toEqual(plain[step]);
    expect(plain[0]).toHaveLength(1);
  });

  it("an enabled arp plays generated notes at sub-row times, through the normal compile", () => {
    const song = songWith(
      [[0, 60, { length: 4, velocity: 100 }], [4, 64, { length: 4 }], [8, 67, { length: 4 }]],
      { arpPatch: { enabled: true, rate: "1/32", gate: 1 } },
    );
    const events = stepEvents(song, 0, 4);
    expect(events).toHaveLength(8);
    expect(events.map((e) => e.pitch)).toEqual([0, 4, 7, 0, 4, 7, 0, 4]);
    expect(events[1].time).toBeCloseTo(10 + 0.5 * STEP, 9);
    expect(events[0].duration).toBeCloseTo(0.5 * STEP, 9);
    expect(events[0].gain).toBeCloseTo(100 / 127, 9); // first run's source velocity
    expect(events.every((e) => e.trackIndex === 0 && e.kind === "sample")).toBe(true);
  });

  it("sounds on an empty row inside a gate window, and not outside it", () => {
    const song = songWith([[0, 60, { length: 4 }]], { arpPatch: { enabled: true, rate: "1/16" } });
    expect(rowEvents(song, 2)).toHaveLength(1);
    expect(rowEvents(song, 4)).toHaveLength(0);
  });

  it("applies the velocity pattern and octave range", () => {
    const song = songWith([[0, 60, { length: 4, velocity: 127 }]], {
      arpPatch: { enabled: true, rate: "1/16", octaves: 2, velocity: { mode: "pattern", amount: 1, steps: [1, 0.5] } },
    });
    const events = stepEvents(song, 0, 4);
    expect(events.map((e) => e.pitch)).toEqual([0, 12, 0, 12]);
    expect(events.map((e) => Math.round(e.gain * 127))).toEqual([127, 64, 127, 64]);
  });

  it("is deterministic across calls and across loops", () => {
    const song = songWith([[0, 60, { length: 4 }], [4, 64, { length: 4 }]], { arpPatch: { enabled: true, mode: "random", rate: "1/16" } });
    expect(stepEvents(song, 0, 8)).toEqual(stepEvents(song, 0, 8));
    // a transport step one full pattern loop later folds onto the same row
    expect(rowEvents(song, 64 + 2).map((e) => e.pitch)).toEqual(rowEvents(song, 2).map((e) => e.pitch));
  });

  it("respects a shorter polymetric track length and bar-sized windows", () => {
    const song = songWith([[0, 60, { length: 8 }], [8, 67, { length: 8 }]], { length: 6, arpPatch: { enabled: true, rate: "1/16" } });
    // the loop is 6 steps: the 8-step run is clipped to it and row 8's note never plays
    expect(stepEvents(song, 0, 6)).toHaveLength(6);
    expect(rowEvents(song, 6).map((e) => e.pitch)).toEqual(rowEvents(song, 0).map((e) => e.pitch));
  });

  it("still honours mute and solo", () => {
    const song = songWith([[0, 60, { length: 4 }]], { arpPatch: { enabled: true } });
    song.trackChannels[0].muted = true;
    expect(rowEvents(song, 0)).toEqual([]);
  });

  it("leaves tracks playing other instruments alone", () => {
    const song = songWith([[0, 60, { length: 4 }]], { arpPatch: { enabled: true, rate: "1/32" } });
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "note", 62);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "instrument", 1);
    const events = rowEvents(song, 0);
    expect(events.filter((e) => e.trackIndex === 1)).toHaveLength(1);
    expect(events.filter((e) => e.trackIndex === 0)).toHaveLength(2);
  });
});

describe("per-instrument arps on one track", () => {
  function twoInstrumentSong() {
    const song = songWith([[0, 60, { length: 4 }], [4, 64, { length: 4 }]], { arpPatch: { enabled: true, rate: "1/32", gate: 1 } });
    const patternId = song.patterns[0].id;
    // rows 8 and 12 address the second instrument, whose arp stays off
    for (const row of [8, 12]) {
      setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "note", 67);
      setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "instrument", 1);
    }
    return song;
  }

  it("arpeggiates only the notes of the instrument that has an arp; the others play as written", () => {
    const song = twoInstrumentSong();
    // instrument 0's bar pool is {60, 64} only: instrument 1's 67 never enters it
    const arped = stepEvents(song, 0, 8);
    expect(arped.every((e) => e.pitch === 0 || e.pitch === 4)).toBe(true);
    expect(arped).toHaveLength(16);
    const plain = [8, 12].map((r) => rowEvents(song, r));
    expect(plain.every((evs) => evs.length === 1 && evs[0].pitch === 7)).toBe(true);
    expect(plain.flat().every((e) => e.time === 10)).toBe(true); // no sub-row offsets: not arpeggiated
  });

  it("different instruments on the same track can each have their own arp", () => {
    const song = twoInstrumentSong();
    instruments[1].arp = patchArp(createArp(), { enabled: true, rate: "1/32", gate: 1 });
    const second = stepEvents(song, 8, 16);
    expect(second.every((e) => e.pitch === 7)).toBe(true);
    expect(second.length).toBeGreaterThan(2); // 2 notes x 4 steps x 2 sub-steps, from instrument 1's arp
    expect(stepEvents(song, 0, 8)).toHaveLength(16); // instrument 0 unchanged
  });

  it("an instrument with the arp off leaves its notes untouched when another has it on", () => {
    const song = twoInstrumentSong();
    instruments[0].arp = null;
    instruments[1].arp = patchArp(createArp(), { enabled: true, rate: "1/32" });
    expect(rowEvents(song, 0)).toHaveLength(1);
    expect(rowEvents(song, 0)[0].pitch).toBe(0);
    expect(rowEvents(song, 0)[0].time).toBe(10);
  });
});

describe("arp persistence", () => {
  const ui = { selectedInstrumentIndex: 0, octave: 4, editStep: 1, cursor: { trackIndex: 0, rowIndex: 0, field: "note" } };
  const load = (file) => deserializeProject(JSON.parse(JSON.stringify(file)), { loadSampleBytes: async () => null });
  const slot = (id, extra = {}) => createInstrumentSlot({ id, name: `I${id}`, ...extra });

  it("round-trips each instrument's own arp", async () => {
    const song = createSong();
    const configured = patchArp(createArp(), { enabled: true, mode: "pattern", pattern: "tresillo", octaves: 3, velocity: { mode: "accent", steps: [1, 0.4] } });
    const slots = [slot(0, { arp: configured }), slot(1)];
    const restored = await load(serializeProject({ song, instruments: slots, ui }));
    expect(restored.instruments[0].arp).toEqual(configured);
    expect(restored.instruments[1].arp).toBeNull();
  });

  it("opens a project saved without arps with no arp, playing exactly as before", async () => {
    const song = songWith([[0, 60], [4, 64]]);
    const before = Array.from({ length: 8 }, (_, step) => rowEvents(song, step, 0));
    const file = JSON.parse(JSON.stringify(serializeProject({ song, instruments: [slot(0)], ui })));
    delete file.instruments[0].arp;
    const restored = await load(file);
    expect(restored.instruments[0].arp).toBeNull();
    expect(restored.song.trackChannels.every((c) => c.arp === undefined)).toBe(true);
    for (let step = 0; step < 8; step++) {
      expect(compileRow(getSelectedPattern(restored.song), restored.song.trackChannels, [{ ...instruments[0], arp: null }], step, 0, STEP)).toEqual(before[step]);
    }
  });

  it("normalises a hand-edited instrument arp on load", async () => {
    const file = JSON.parse(JSON.stringify(serializeProject({ song: createSong(), instruments: [slot(0)], ui })));
    file.instruments[0].arp = { enabled: true, octaves: 99, rate: "nope" };
    const restored = await load(file);
    expect(restored.instruments[0].arp).toMatchObject({ enabled: true, octaves: 4, rate: "1/16" });
  });

  it("moves an enabled track-level arp from an older project onto the instruments that track plays", async () => {
    const song = songWith([[0, 60], [4, 64]]);
    const patternId = song.patterns[0].id;
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 8 }, "note", 67);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 8 }, "instrument", 1);
    const file = JSON.parse(JSON.stringify(serializeProject({ song, instruments: [slot(0), slot(1), slot(2)], ui })));
    file.song.trackChannels[0].arp = { ...createArp(), enabled: true, rate: "1/8" };
    file.song.trackChannels[1].arp = { ...createArp(), enabled: false, rate: "1/4" }; // off: nothing to carry over
    const restored = await load(file);
    expect(restored.song.trackChannels.every((c) => c.arp === undefined)).toBe(true);
    expect(restored.instruments[0].arp).toMatchObject({ enabled: true, rate: "1/8" });
    expect(restored.instruments[1].arp).toMatchObject({ enabled: true, rate: "1/8" });
    expect(restored.instruments[2].arp).toBeNull(); // never addressed on that track
  });

  it("an arp already on the instrument wins over a legacy track arp", async () => {
    const song = songWith([[0, 60]]);
    const own = patchArp(createArp(), { enabled: true, rate: "1/4" });
    const file = JSON.parse(JSON.stringify(serializeProject({ song, instruments: [slot(0, { arp: own })], ui })));
    file.song.trackChannels[0].arp = { ...createArp(), enabled: true, rate: "1/8" };
    expect((await load(file)).instruments[0].arp.rate).toBe("1/4");
  });

  it("the store edits one instrument's arp through INSTRUMENTS_CHANGED", () => {
    const store = createStore({ song: createSong(), instruments: [slot(0), slot(1)] });
    let fired = 0;
    store.subscribe("INSTRUMENTS_CHANGED", () => fired++);
    store.setInstrumentArp(0, { enabled: true, rate: "1/8" });
    expect(store.getState().instruments[0].arp).toMatchObject({ enabled: true, rate: "1/8" });
    expect(store.getState().instruments[1].arp).toBeNull();
    expect(fired).toBe(1);
  });
});
