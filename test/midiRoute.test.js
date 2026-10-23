import { describe, expect, it, vi } from "vitest";
import { createMidiRouteSync, routeForAudition } from "../src/audio/midiRoute.js";
import { createMidiNoteSource } from "../src/input/midiInputSource.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { createSong } from "../src/model/song.js";
import { createTrackChannel } from "../src/model/trackChannel.js";

const channel = (overrides = {}) => createTrackChannel({ index: 0, ...overrides });
const sample = (overrides = {}) => createInstrumentSlot({ id: 0, sampleId: 5, ...overrides });
const base = (overrides = {}) => ({
  song: createSong(),
  instruments: [sample()],
  selectedInstrumentIndex: 0,
  trackChannel: channel(),
  resampleStatus: "idle",
  knowsSample: () => true,
  ...overrides,
});

describe("routeForAudition (what the audition of the selected instrument on the cursor's track plays)", () => {
  it("a sample plays chromatically from its root note, scaled by the track volume", () => {
    expect(routeForAudition(base({ instruments: [sample({ rootNote: 48 })], trackChannel: channel({ volume: 0.5 }) }))).toEqual({
      kind: "sample",
      id: 5,
      unityNote: 48,
      gain: 0.5,
    });
  });

  it("chop picks a slice per key, a mono track is monophonic, a choke group is carried", () => {
    const route = routeForAudition(base({ instruments: [sample({ sampleMode: "chop" })], trackChannel: channel({ voiceMode: "mono", chokeGroup: 3 }) }));
    expect(route).toMatchObject({ kind: "sample", chop: true, mono: true, chokeGroup: 3 });
  });

  it("a synth plays from its root note; only a sustained kind is released on key-up", () => {
    const kick = createInstrumentSlot({ id: 0, rootNote: 60, engineInstrumentId: 9, output: { type: "instrument", kind: "kick", channel: null, track: null } });
    expect(routeForAudition(base({ instruments: [kick] }))).toEqual({ kind: "instrument", id: 9, unityNote: 60, gain: 1 });
    const bass = createInstrumentSlot({ id: 0, rootNote: 36, engineInstrumentId: 4, output: { type: "instrument", kind: "bass", channel: null, track: null } });
    expect(routeForAudition(base({ instruments: [bass] }))).toEqual({ kind: "instrument", id: 4, unityNote: 36, gain: 1, holdUntilKeyUp: true });
  });

  it("is null when the page has to play it or nothing plays", () => {
    expect(routeForAudition(base({ trackChannel: undefined }))).toBeNull();
    expect(routeForAudition(base({ trackChannel: channel({ muted: true }) }))).toBeNull();
    expect(routeForAudition(base({ instruments: [] }))).toBeNull();
    expect(routeForAudition(base({ instruments: [sample({ sampleId: null })] }))).toBeNull(); // nothing loaded
    expect(routeForAudition(base({ knowsSample: () => false }))).toBeNull(); // the engine does not have it yet
    expect(routeForAudition(base({ resampleStatus: "armed" }))).toBeNull();
    expect(routeForAudition(base({ resampleStatus: "processing" }))).toBeNull();
    const midiOut = createInstrumentSlot({ id: 0, output: { type: "midi", channel: 2, kind: null, track: null } });
    expect(routeForAudition(base({ instruments: [midiOut] }))).toBeNull(); // sends MIDI out: only the page can
    const noEngine = createInstrumentSlot({ id: 0, engineInstrumentId: null, output: { type: "instrument", kind: "kick", channel: null, track: null } });
    expect(routeForAudition(base({ instruments: [noEngine] }))).toBeNull();
    const snapping = createSong();
    snapping.scale = { root: 0, scale: "major", snap: true, preset: null };
    expect(routeForAudition(base({ song: snapping }))).toBeNull(); // the page snaps the played note to the scale; a raw key would not be
  });
});

describe("createMidiRouteSync", () => {
  function setup(capable = true) {
    const song = createSong();
    const state = { song, instruments: [sample()], selectedInstrumentIndex: 0, cursor: { trackIndex: 0 }, resampleStatus: "idle" };
    const runtime = {
      getCapabilities: () => ({ midiRouting: capable }),
      getSample: (id) => (id === 5 ? { id } : undefined),
      setMidiRoute: vi.fn(),
    };
    let current = runtime;
    const sync = createMidiRouteSync({ getRuntime: () => current, getState: () => state });
    return { sync, state, runtime, setRuntime: (r) => (current = r) };
  }

  it("sends the route once, only again when it changes, and says whether the host is playing", () => {
    const { sync, state, runtime } = setup();
    expect(sync.isRouted()).toBe(false);
    sync.sync();
    sync.sync();
    expect(runtime.setMidiRoute).toHaveBeenCalledTimes(1);
    expect(runtime.setMidiRoute.mock.calls[0][0]).toMatchObject({ kind: "sample", id: 5 });
    expect(sync.isRouted()).toBe(true);

    state.song.trackChannels[0].muted = true; // now nothing plays: the route is withdrawn, and the page is back in charge
    sync.sync();
    expect(runtime.setMidiRoute).toHaveBeenLastCalledWith(null);
    expect(sync.isRouted()).toBe(false);
  });

  it("does nothing without a runtime or when the host cannot route (a browser, an older plugin)", () => {
    const none = setup();
    none.setRuntime(null);
    none.sync.sync();
    expect(none.sync.isRouted()).toBe(false);

    const incapable = setup(false);
    incapable.sync.sync();
    expect(incapable.runtime.setMidiRoute).not.toHaveBeenCalled();
    expect(incapable.sync.isRouted()).toBe(false);
  });
});

describe("the MIDI note source flags notes the host is already playing", () => {
  function inputAndSource(isRouted) {
    const listeners = new Map();
    const input = { type: "input", state: "connected", addEventListener: (t, fn) => listeners.set(t, fn), removeEventListener() {} };
    const access = { inputs: { forEach: (fn) => [input].forEach(fn) }, addEventListener() {}, removeEventListener() {} };
    const source = createMidiNoteSource({ requestMIDIAccess: async () => access, isRouted });
    const notes = [];
    source.onNoteOn((n) => notes.push(n));
    source.attach();
    return { notes, fire: (data) => listeners.get("midimessage")({ data }), ready: () => new Promise((r) => setTimeout(r, 0)) };
  }

  it("routed is present only while the host plays, per note", async () => {
    let routed = false;
    const { notes, fire, ready } = inputAndSource(() => routed);
    await ready();
    fire([0x90, 60, 100]);
    routed = true;
    fire([0x90, 62, 100]);
    expect(notes.map((n) => [n.note, Boolean(n.routed)])).toEqual([[60, false], [62, true]]);
    expect(notes[0]).toEqual({ note: 60, velocity: 100, channel: 0 }); // unchanged when the page plays
  });
});
