import { describe, expect, it } from "vitest";
import { createEditController } from "../src/input/editController.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getSelectedPattern } from "../src/model/query.js";

// A minimal fake noteInputSource.js implementation — just enough for editController.js's
// attach() to subscribe to and for a test to trigger a note-on through.
function createFakeNoteSource() {
  const onListeners = new Set();
  return {
    onNoteOn(fn) {
      onListeners.add(fn);
      return () => onListeners.delete(fn);
    },
    onNoteOff() {
      return () => {};
    },
    emitNoteOn(payload) {
      onListeners.forEach((fn) => fn(payload));
    },
  };
}

// A fake keydown target — editController.js's attach() only needs addEventListener/
// removeEventListener for "keydown"; this also lets a test count how many listeners actually
// got attached.
function createFakeTarget() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}

function createTestContext() {
  const song = createSong();
  const store = createStore({ song, instruments: [] });
  const noteSourceA = createFakeNoteSource();
  const noteSourceB = createFakeNoteSource();
  const editController = createEditController({ store, noteSources: [noteSourceA, noteSourceB] });
  return { store, noteSourceA, noteSourceB, editController };
}

describe("createEditController — multiple note sources", () => {
  it("writes a note from either source into the cell under the cursor identically", () => {
    const { store, noteSourceA, noteSourceB, editController } = createTestContext();
    editController.attach(createFakeTarget());

    noteSourceA.emitNoteOn({ note: 60, velocity: 100 });
    let event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).toBe(60);
    expect(event.velocity).toBe(100);

    // handleNoteOn already auto-advanced the cursor to row 1 (editStep defaults to 1) after
    // the first note-on above — no extra moveCursor needed before the second one.
    noteSourceB.emitNoteOn({ note: 64, velocity: 90, channel: 3 }); // a MIDI-shaped payload
    event = getSelectedPattern(store.getState().song).tracks[0].events[1];
    expect(event.note).toBe(64);
    expect(event.velocity).toBe(90);
  });

  it("attaches the keydown listener exactly once, regardless of how many note sources exist", () => {
    const { editController } = createTestContext();
    const target = createFakeTarget();
    editController.attach(target);
    expect(target.listenerCount("keydown")).toBe(1);
  });

  it("detach() unsubscribes from every source — a later note-on has no effect", () => {
    const { store, noteSourceA, noteSourceB, editController } = createTestContext();
    const detach = editController.attach(createFakeTarget());
    detach();

    noteSourceA.emitNoteOn({ note: 60, velocity: 100 });
    noteSourceB.emitNoteOn({ note: 64, velocity: 90 });

    const event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).toBe(null);
  });
});
