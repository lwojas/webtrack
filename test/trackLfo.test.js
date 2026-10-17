import { describe, expect, it, vi } from "vitest";
import { compileEvent, compileRow } from "../src/audio/compile.js";
import { createLookaheadPlayer } from "../src/audio/lookaheadPlayer.js";
import { effectiveVelocity } from "../src/audio/trackLfo.js";
import { createEmptyEvent, isEmptyEvent } from "../src/model/event.js";
import { createEventLfo, normalizeParticipation } from "../src/model/eventLfo.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { createSong } from "../src/model/song.js";
import { createStore } from "../src/state/store.js";
import { setEventField, setTrackChannelEventLfo, setTrackStepsLfo } from "../src/model/mutations.js";
import { getSelectedPattern } from "../src/model/query.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";

// A square LFO is exactly +1 (first half of a cycle) or -1 (second half), so the expected
// velocities are exact. Synced to 1/4 at 120 BPM a cycle is 0.5 s; the anchor is t = 10.
const lfo = (patch = {}) => ({ ...createEventLfo(), enabled: true, waveform: "square", sync: true, division: "1/4", depth: 0.2, ...patch });
const channel = (eventLfo) => ({ muted: false, volume: 1, eventLfo });
const event = (patch = {}) => ({ ...createEmptyEvent(), note: 60, instrument: 0, velocity: 100, lfo: 1, ...patch });
const clock = { anchorTime: 10, bpm: 120 };
const HIGH = 10.1; // LFO = +1
const LOW = 10.3; // LFO = -1
const depth127 = 0.2 * 127; // 25.4

describe("effectiveVelocity", () => {
  it("is the base velocity with no LFO, a disabled LFO, or no clock", () => {
    expect(effectiveVelocity(channel(), event(), 100, HIGH, clock)).toBe(100);
    expect(effectiveVelocity(channel(lfo({ enabled: false })), event(), 100, HIGH, clock)).toBe(100);
    expect(effectiveVelocity(channel(lfo()), event(), 100, HIGH, undefined)).toBe(100);
  });

  it("is the base velocity for a step that does not participate", () => {
    expect(effectiveVelocity(channel(lfo()), event({ lfo: null }), 100, HIGH, clock)).toBe(100);
    expect(effectiveVelocity(channel(lfo()), event({ lfo: 0 }), 100, HIGH, clock)).toBe(100);
    expect(effectiveVelocity(channel(lfo()), { note: 60 }, 100, HIGH, clock)).toBe(100); // a cell saved before the field existed
  });

  it("adds the bipolar LFO x depth x participation", () => {
    expect(effectiveVelocity(channel(lfo()), event(), 80, HIGH, clock)).toBe(Math.round(80 + depth127)); // 105
    expect(effectiveVelocity(channel(lfo()), event(), 80, LOW, clock)).toBe(Math.round(80 - depth127)); // 55
    expect(effectiveVelocity(channel(lfo()), event({ lfo: 0.5 }), 80, HIGH, clock)).toBe(Math.round(80 + depth127 / 2)); // 93
  });

  it("clamps to 0..127", () => {
    expect(effectiveVelocity(channel(lfo({ depth: 1 })), event(), 120, HIGH, clock)).toBe(127);
    expect(effectiveVelocity(channel(lfo({ depth: 1 })), event(), 10, LOW, clock)).toBe(0);
  });

  it("free mode runs at its own rate from the anchor; sync follows the tempo", () => {
    const free = channel(lfo({ sync: false, rateHz: 2 })); // 0.5 s cycle
    expect(effectiveVelocity(free, event(), 80, HIGH, clock)).toBe(105);
    expect(effectiveVelocity(free, event(), 80, LOW, { ...clock, bpm: 60 })).toBe(55);
    expect(effectiveVelocity(channel(lfo()), event(), 80, LOW, { ...clock, bpm: 60 })).toBe(105);
  });

  it("is deterministic and never touches the event", () => {
    const e = event();
    const before = JSON.stringify(e);
    const ch = channel(lfo({ waveform: "sine", sync: false, rateHz: 3.7 }));
    expect(effectiveVelocity(ch, e, 90, 12.345, clock)).toBe(effectiveVelocity(ch, e, 90, 12.345, clock));
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("compile integration", () => {
  const instruments = [createInstrumentSlot({ id: 0, sampleId: 1, rootNote: 60 })];

  it("modulates the velocity of sample, synth and midi events from their scheduled time", () => {
    const ch = channel(lfo());
    const sample = compileEvent(event(), ch, instruments, HIGH, 0.1, undefined, clock);
    expect(sample.gain).toBeCloseTo((100 + depth127) / 127, 2);
    const synth = [createInstrumentSlot({ id: 0, output: { type: "instrument", kind: "bass" }, engineInstrumentId: 3 })];
    expect(compileEvent(event(), ch, synth, LOW, 0.1, undefined, clock).velocity).toBeCloseTo((100 - depth127) / 127, 2);
    const midi = [createInstrumentSlot({ id: 0, output: { type: "midi", channel: 0 } })];
    expect(compileEvent(event(), ch, midi, HIGH, 0.1, undefined, clock).velocity).toBe(Math.round(100 + depth127));
  });

  it("uses the event's scheduled time, not 'now': the same cell later in the song gets the later phase", () => {
    const ch = channel(lfo());
    const at = (t) => compileEvent(event(), ch, instruments, t, 0.1, undefined, clock).gain * 127;
    expect(at(10.1)).toBeGreaterThan(at(10.3));
    expect(at(10.6)).toBeCloseTo(at(10.1), 1); // continues the cycle: anchored to the transport, not the step
  });

  it("compileRow passes the clock through and leaves the stored cells alone", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    for (const [field, value] of [["note", 60], ["instrument", 0], ["velocity", 100], ["lfo", 1]]) setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, field, value);
    song.trackChannels[0].eventLfo = lfo();
    const pattern = getSelectedPattern(song);
    const stored = JSON.stringify(pattern);
    const [e] = compileRow(pattern, song.trackChannels, instruments, 0, HIGH, 0.125, undefined, clock);
    expect(e.gain * 127).toBeCloseTo(100 + depth127, 0);
    expect(JSON.stringify(pattern)).toBe(stored);
    expect(pattern.tracks[0].events[0].velocity).toBe(100);
  });

  it("the lookahead player gives the compile step the engine's anchor and tempo (swing aside)", () => {
    vi.useFakeTimers();
    const runtime = { getCurrentTime: () => 0, schedule: vi.fn(), release: vi.fn(), cancelScheduled: vi.fn(), instrumentNoteOn: vi.fn(), setTempo: vi.fn() };
    const clocks = [];
    const compile = vi.fn((...args) => (clocks.push(args[7]), []));
    const player = createLookaheadPlayer({ runtime, compileRow: compile, getStepDurationSeconds: () => 0.125 });
    const pattern = { id: 0, rowCount: 16, tracks: [{ length: 16, events: Array.from({ length: 16 }, () => ({ note: null })) }] };
    player.start({ initialPattern: pattern, initialTrackChannels: [], initialInstruments: [], startAt: 0.05 });
    expect(clocks[0]).toEqual({ anchorTime: 0.05, bpm: 120 }); // 0.125 s/step, 4 steps/beat = 120 BPM
    expect(runtime.setTempo).toHaveBeenCalledWith(120, { anchorTime: 0.05 });
    player.stop();
    vi.useRealTimers();
  });

  it("regression: cells and channels without Track LFO data compile exactly as before", () => {
    const plain = createEmptyEvent();
    plain.note = 62;
    plain.instrument = 0;
    plain.velocity = 90;
    const legacy = { note: 62, instrument: 0, velocity: 90, pan: null, length: null, fx: null }; // saved before `lfo` existed
    const a = compileEvent(plain, channel(undefined), instruments, 3, 0.1);
    expect(compileEvent(legacy, { muted: false, volume: 1 }, instruments, 3, 0.1)).toEqual(a);
    expect(compileEvent(plain, channel(undefined), instruments, 3, 0.1, undefined, clock)).toEqual(a);
    expect(compileEvent(plain, channel(lfo()), instruments, 3, 0.1, undefined, clock)).toEqual(a); // enabled, but the step does not take part
    expect(a.gain).toBeCloseTo(90 / 127, 10);
  });
});

describe("model", () => {
  it("sets the track LFO with clamping, and participation for a track's notes only", () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackChannelEventLfo(song, 0, { enabled: true, depth: 9, rateHz: 999, waveform: "saw" });
    expect(song.trackChannels[0].eventLfo).toMatchObject({ enabled: true, depth: 1, rateHz: 40, waveform: "saw", target: "velocity", sync: true });
    expect(song.trackChannels[1].eventLfo).toBeUndefined();
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 0 }, "note", 60);
    setEventField(song, { patternId, trackIndex: 0, rowIndex: 4 }, "note", 62);
    setEventField(song, { patternId, trackIndex: 1, rowIndex: 0 }, "note", 60);
    setTrackStepsLfo(song, patternId, 0, 1);
    const p = getSelectedPattern(song);
    expect([p.tracks[0].events[0].lfo, p.tracks[0].events[4].lfo, p.tracks[0].events[1].lfo]).toEqual([1, 1, null]);
    expect(p.tracks[1].events[0].lfo).toBeNull();
    setTrackStepsLfo(song, patternId, 0, 0);
    expect(p.tracks[0].events[0].lfo).toBeNull();
  });

  it("participation is part of 'empty', and normalised (0 -> null)", () => {
    expect(isEmptyEvent(createEmptyEvent())).toBe(true);
    expect(isEmptyEvent({ ...createEmptyEvent(), lfo: 0.5 })).toBe(false);
    expect(isEmptyEvent({ note: null, instrument: null, velocity: null, pan: null, effectCommand: null, effectParam: null, length: null, fx: null })).toBe(true); // older cell
    expect(normalizeParticipation(0)).toBeNull();
    expect(normalizeParticipation(0.554)).toBe(0.55);
    expect(normalizeParticipation(7)).toBe(1);
  });

  it("the store edits the LFO and notifies the track channel listeners", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const listener = vi.fn();
    store.subscribe("TRACK_CHANNEL_CHANGED", listener);
    store.setTrackChannelEventLfo(2, { enabled: true });
    expect(listener).toHaveBeenCalled();
    expect(store.getState().song.trackChannels[2].eventLfo.enabled).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips the track LFO and the participating / non-participating steps; velocity stays authored", async () => {
    const song = createSong();
    const patternId = song.patterns[0].id;
    setTrackChannelEventLfo(song, 0, { enabled: true, waveform: "triangle", sync: false, rateHz: 3, depth: 0.4, division: "1/8" });
    for (const [row, lfoValue] of [[0, 0.5], [4, null]]) {
      setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "note", 60);
      setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "velocity", 90);
      setEventField(song, { patternId, trackIndex: 0, rowIndex: row }, "lfo", lfoValue);
    }
    const restored = await deserializeProject(JSON.parse(JSON.stringify(serializeProject({ song, instruments: [], ui: {} }))), { loadSampleBytes: async () => null });
    expect(restored.song.trackChannels[0].eventLfo).toEqual(song.trackChannels[0].eventLfo);
    const events = restored.song.patterns[0].tracks[0].events;
    expect([events[0].lfo, events[4].lfo, events[0].velocity, events[4].velocity]).toEqual([0.5, null, 90, 90]);
  });
});
