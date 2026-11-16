import { describe, expect, it } from "vitest";
import { createSong } from "../src/model/song.js";
import { createStore } from "../src/state/store.js";
import { createInstrumentSlot } from "../src/model/instrument.js";
import { serializeProject, deserializeProject } from "../src/persistence/projectFile.js";
import * as events from "../src/state/events.js";
import {
  addGroup,
  assignControl,
  layoutControls,
  normalizeInstrumentUi,
  removeGroup,
  updateGroup,
} from "../src/model/instrumentUi.js";
import { knobFraction, snapKnobValue } from "../src/ui/Knob.jsx";

describe("instrument control groups (model)", () => {
  it("starts empty and normalizes to null", () => {
    expect(normalizeInstrumentUi(null)).toBe(null);
    expect(normalizeInstrumentUi({ groups: [], assign: {} })).toBe(null);
    expect(removeGroup(addGroup(null), "g1")).toBe(null);
  });

  it("adds, updates (clamping hue/size/name) and removes groups", () => {
    let ui = addGroup(null, "OSC");
    ui = addGroup(ui, "FILTER");
    expect(ui.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    ui = updateGroup(ui, "g1", { hue: 400, size: "xl", name: "  Tone  " });
    expect(ui.groups[0]).toMatchObject({ name: "Tone", hue: 40, size: "m" });
    ui = updateGroup(ui, "g2", { hue: null, size: "l", collapsed: true });
    expect(ui.groups[1]).toMatchObject({ hue: null, size: "l", collapsed: true });
  });

  it("never reuses a live group id after a delete", () => {
    let ui = addGroup(addGroup(null), "B");
    ui = removeGroup(ui, "g1");
    ui = addGroup(ui);
    expect(new Set(ui.groups.map((g) => g.id)).size).toBe(2);
  });

  it("assigns controls and drops assignments when their group is deleted", () => {
    let ui = addGroup(null, "ENV");
    ui = assignControl(ui, "attack", "g1");
    ui = assignControl(ui, "decay", "g1");
    ui = assignControl(ui, "decay", null);
    expect(ui.assign).toEqual({ attack: "g1" });
    ui = addGroup(ui, "X");
    expect(removeGroup(ui, "g1").assign).toEqual({});
  });

  it("lays controls out as ungrouped plus ordered groups, ignoring stale assignments", () => {
    const controls = ["a", "b", "c"].map((id) => ({ id }));
    expect(layoutControls(null, controls)).toEqual({ ungrouped: controls, groups: [] });
    const ui = assignControl(assignControl(addGroup(null), "c", "g1"), "a", "g1");
    const { ungrouped, groups } = layoutControls({ ...ui, assign: { ...ui.assign, gone: "g1" } }, controls);
    expect(ungrouped.map((c) => c.id)).toEqual(["b"]);
    expect(groups[0].controls.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("instrument control groups (store + project file)", () => {
  const makeStore = () => createStore({ song: createSong(), instruments: [createInstrumentSlot({ id: 0, name: "k" })] });

  it("updateInstrumentUi stores the layout and emits INSTRUMENTS_CHANGED", () => {
    const store = makeStore();
    let emitted = 0;
    store.subscribe(events.INSTRUMENTS_CHANGED, () => emitted++);
    store.updateInstrumentUi(0, (ui) => addGroup(ui, "OSC"));
    expect(store.getState().instruments[0].ui.groups[0].name).toBe("OSC");
    expect(emitted).toBe(1);
  });

  it("round-trips through the project file; older projects load with no groups", async () => {
    const store = makeStore();
    store.updateInstrumentUi(0, (ui) => assignControl(updateGroup(addGroup(ui, "ENV"), "g1", { hue: 120, size: "l" }), "attack", "g1"));
    const { song, instruments } = store.getState();
    const saved = JSON.parse(JSON.stringify(serializeProject({ song, instruments, ui: {} })));
    const opts = { loadSampleBytes: async () => "id" };
    const restored = await deserializeProject(saved, opts);
    expect(restored.instruments[0].ui.groups[0]).toMatchObject({ name: "ENV", hue: 120, size: "l" });
    expect(restored.instruments[0].ui.assign).toEqual({ attack: "g1" });

    delete saved.instruments[0].ui;
    expect((await deserializeProject(saved, opts)).instruments[0].ui).toBe(null);
  });
});

describe("knob value math", () => {
  it("maps a value to a 0-1 fraction, clamped", () => {
    expect(knobFraction(5, 0, 10)).toBe(0.5);
    expect(knobFraction(-3, 0, 10)).toBe(0);
    expect(knobFraction(99, 0, 10)).toBe(1);
    expect(knobFraction(1, 5, 5)).toBe(0);
  });

  it("snaps to the step grid inside the range", () => {
    expect(snapKnobValue(0.3333, 0, 1, 0.01)).toBe(0.33);
    expect(snapKnobValue(1.4, 0, 1, 0.01)).toBe(1);
    expect(snapKnobValue(-2, -1, 1, 0.5)).toBe(-1);
    expect(snapKnobValue(0.123456, 0, 1, 0)).toBe(0.123456);
  });
});
