import { describe, expect, it } from "vitest";
import { copyCurrentCellToClipboard, pasteClipboardIntoCell } from "../src/midi/push/selectCopyPaste.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getSelectedPattern } from "../src/model/query.js";

// selectCopyPaste.js — shared by noteEntryMode.js and trackerGridMode.js for Push's Select
// (CC48) copy/paste (docs/MIDI.md). Pure functions over state/store.js's own existing
// copySelection/pasteSelection, never a second Push-only clipboard — these tests exercise that
// contract directly, independent of either Push grid content.
describe("copyCurrentCellToClipboard", () => {
  it("collapses any active range selection and copies exactly the cursor's own cell", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.setCell(1, 1, "note", 64);
    store.selectCell(0, 0, "note");
    store.extendSelectionTo(1, 1); // an active 2x2 range selection

    const ok = copyCurrentCellToClipboard(store);

    expect(ok).toBe(true);
    expect(store.getSelectionRect()).toEqual({ trackStart: 1, trackEnd: 1, rowStart: 1, rowEnd: 1 }); // collapsed onto the cursor
    expect(store.getState().clipboard.width).toBe(1);
    expect(store.getState().clipboard.height).toBe(1);
  });

  it("copies the cell's full editable state (note, velocity, length, ...), not just the note", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.setCell(0, 0, "velocity", 100);
    store.setCell(0, 0, "length", 4);
    store.selectCell(0, 0, "note");

    copyCurrentCellToClipboard(store);
    store.selectCell(3, 3, "note");
    store.pasteSelection();

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[3].events[3].note).toBe(60);
    expect(pattern.tracks[3].events[3].velocity).toBe(100);
    expect(pattern.tracks[3].events[3].length).toBe(4);
  });

  it("returns false and leaves the clipboard untouched when there is no valid cell under the cursor", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.selectCell(0, 0, "note");
    copyCurrentCellToClipboard(store); // a real, prior copy
    const clipboardBefore = store.getState().clipboard;

    // An out-of-range cursor (shouldn't normally happen, but copyCurrentCellToClipboard must
    // guard it rather than trust the caller).
    store.getState().cursor.trackIndex = 999;

    const ok = copyCurrentCellToClipboard(store);

    expect(ok).toBe(false);
    expect(store.getState().clipboard).toBe(clipboardBefore); // untouched, not overwritten with garbage
  });
});

describe("pasteClipboardIntoCell", () => {
  it("pastes the clipboard into the destination cell and selects it", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.selectCell(0, 0, "note");
    store.copySelection();

    pasteClipboardIntoCell(store, 2, 5, "note");

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[2].events[5].note).toBe(60);
    expect(store.getState().cursor).toEqual({ trackIndex: 2, rowIndex: 5, field: "note" });
  });

  it("is a no-op when there is no clipboard", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    expect(store.getState().clipboard).toBe(null);

    pasteClipboardIntoCell(store, 2, 5, "note");

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[2].events[5].note).toBe(null);
    // Nothing selected either — the cursor stays wherever it already was.
    expect(store.getState().cursor).toEqual({ trackIndex: 0, rowIndex: 0, field: "note" });
  });

  it("allows pasting onto the source cell itself", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.selectCell(0, 0, "note");
    store.copySelection();

    expect(() => pasteClipboardIntoCell(store, 0, 0, "note")).not.toThrow();
    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[0].events[0].note).toBe(60);
  });
});
