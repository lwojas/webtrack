import { afterEach, describe, expect, it, vi } from "vitest";
import { createSong } from "../src/model/song.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { addTrackFx, setCellAutomation } from "../src/model/mutations.js";
import { fxKey, instKey } from "../src/model/cellAutomation.js";

// The real playback controller + lookahead player + automation bridge, against a faked runtime and
// faked engine-facing modules: what is scheduled on the audio clock, and what stop restores.
const runtime = {
  getCurrentTime: () => 0,
  schedule: vi.fn(() => []),
  release: vi.fn(),
  cancelScheduled: vi.fn(),
  instrumentNoteOn: vi.fn(),
  setTempo: vi.fn(),
  scheduleParams: vi.fn(),
};
const fx = {
  setTrackFxParam: vi.fn(),
  setTrackFxInstanceParam: vi.fn(),
  getTrackEffectId: vi.fn((trackIndex, instanceId) => 1000 + instanceId),
  resolveNodeParam: vi.fn((id) => (id === "utility.gain" ? 41 : undefined)),
};
const instrumentBridge = {
  resolveInstrumentParam: vi.fn((kind, id) => (kind === "bass" && id === "cutoff" ? 3 : undefined)),
  setSynthInstrumentParam: vi.fn(),
};

vi.mock("../src/audio/runtime.js", () => ({
  initRuntime: async () => runtime,
  getRuntime: async () => runtime,
  ensureTrackBuses: async (n) => Array.from({ length: n }, (_, i) => 20 + i),
}));
vi.mock("../src/audio/fx.js", () => fx);
vi.mock("../src/audio/instrument.js", () => instrumentBridge);
vi.mock("../src/audio/instrumentEnvelope.js", () => ({ resolveEnvelopeParam: (id) => ({ release: 4 })[id], setInstrumentEnvelope: vi.fn() }));
vi.mock("../src/audio/resampleController.js", () => ({ createResampleController: () => ({ onStepScheduled: vi.fn(), cancel: vi.fn(), arm: vi.fn(), getStatus: () => "idle" }) }));

const { createPlaybackController } = await import("../src/audio/playbackController.js");

afterEach(() => vi.clearAllMocks());

function setup() {
  const song = createSong({ rowCount: 16 });
  const bass = createInstrumentSlot({ id: 0, output: { type: "instrument", channel: null, kind: "bass", track: null } });
  bass.engineInstrumentId = 5;
  bass.instrumentParams = { cutoff: 400 };
  const instruments = [bass];
  const patternId = song.patterns[0].id;
  const id = addTrackFx(song, 0, "utility");
  const at = (row, key, value, opts) => setCellAutomation(song, instruments, { patternId, trackIndex: 0, rowIndex: row }, key, value, opts);
  const controller = createPlaybackController({
    getSong: () => song,
    getTrackChannels: () => song.trackChannels,
    getInstruments: () => instruments,
    getBpm: () => 120,
    getSwing: () => 0,
  });
  return { song, instruments, id, at, controller };
}

describe("cell automation through the playback controller", () => {
  it("schedules FX and instrument steps and a glide ramp on the audio clock", async () => {
    const { id, at, controller } = setup();
    at(0, fxKey(id, "utility.gain"), -6, { glide: true });
    at(4, fxKey(id, "utility.gain"), -30);
    at(0, instKey(0, "cutoff"), 900);
    await controller.play();

    const batches = runtime.scheduleParams.mock.calls.map((c) => c[0]);
    const first = batches[0];
    expect(first).toHaveLength(2);
    const gain = first.find((e) => e.param === 41);
    expect(gain).toMatchObject({ target: { effect: { bus: 20, effect: 1000 + id } }, from: -6, value: -30 });
    expect(gain.ramp).toBeCloseTo(4 * (60 / 120 / 4)); // four steps at 120 BPM
    expect(first.find((e) => e.param === 3)).toMatchObject({ target: { instrument: 5 }, value: 900 });
    expect(first.find((e) => e.param === 3).ramp).toBeUndefined();
    controller.stop();
  });

  it("does not write FX instance or instrument automation into the engine's immediate setters while playing", async () => {
    const { id, at, controller } = setup();
    at(0, fxKey(id, "utility.gain"), -6);
    at(0, instKey(0, "cutoff"), 900);
    await controller.play();
    expect(fx.setTrackFxInstanceParam).not.toHaveBeenCalled();
    expect(instrumentBridge.setSynthInstrumentParam).not.toHaveBeenCalled();
    controller.stop();
  });

  it("on stop, cancels queued events and restores the authored value of every parameter automation moved", async () => {
    const { id, at, controller } = setup();
    at(0, fxKey(id, "utility.gain"), -6);
    at(0, instKey(0, "cutoff"), 900);
    await controller.play();
    controller.stop();
    expect(runtime.cancelScheduled).toHaveBeenCalled();
    expect(fx.setTrackFxInstanceParam).toHaveBeenCalledWith(0, id, "utility.gain", 0); // the FX's authored base
    expect(instrumentBridge.setSynthInstrumentParam).toHaveBeenCalledWith(expect.objectContaining({ engineInstrumentId: 5 }), "bass", "cutoff", 400);
    // nothing left to restore on a second stop
    fx.setTrackFxInstanceParam.mockClear();
    controller.stop();
    expect(fx.setTrackFxInstanceParam).not.toHaveBeenCalled();
  });

  it("bus gain keeps its immediate path and is not scheduled", async () => {
    const { at, controller } = setup();
    at(0, "bus.gain", 0.5);
    await controller.play();
    expect(fx.setTrackFxParam).toHaveBeenCalledWith(0, "bus.gain", 0.5);
    expect(runtime.scheduleParams).not.toHaveBeenCalled();
    controller.stop();
  });
});
