import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getSelectedPattern } from "../src/model/query.js";
import * as events from "../src/state/events.js";

// store.js#duplicateSelection — added for Push's Duplicate button (CC88, docs/MIDI.md), built
// directly from the same captureBlock/tileBlockIntoRect primitives copySelection/fillSelection
// already use, not a second copy/paste implementation.
describe("store.duplicateSelection", () => {
  it("duplicates a single cell directly into the row below it", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.setCell(0, 0, "velocity", 100);
    store.selectCell(0, 0, "note"); // 1x1 selection

    store.duplicateSelection();

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[0].events[1].note).toBe(60);
    expect(pattern.tracks[0].events[1].velocity).toBe(100);
    // The source cell is untouched — this is a copy, not a move.
    expect(pattern.tracks[0].events[0].note).toBe(60);
  });

  it("duplicates a multi-row, multi-track block directly below its own last row", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(1, 2, "note", 60);
    store.setCell(2, 3, "note", 64);
    store.selectCell(1, 2, "note");
    store.extendSelectionTo(2, 3); // rect: tracks 1-2, rows 2-3 (height 2)

    store.duplicateSelection();

    const pattern = getSelectedPattern(store.getState().song);
    // Destination starts right after rowEnd (3) -> rows 4-5.
    expect(pattern.tracks[1].events[4].note).toBe(60);
    expect(pattern.tracks[2].events[5].note).toBe(64);
    // Nothing landed on the row immediately after the destination block.
    expect(pattern.tracks[1].events[6].note).toBe(null);
  });

  it("never touches state.clipboard, unlike copySelection", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.selectCell(0, 0, "note");
    expect(store.getState().clipboard).toBe(null);

    store.duplicateSelection();

    expect(store.getState().clipboard).toBe(null);
  });

  it("clips the destination at the pattern's own last row, same convention pasteSelection uses", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const pattern = getSelectedPattern(store.getState().song);
    const lastRow = pattern.rowCount - 1;
    store.setCell(0, lastRow, "note", 60);
    store.selectCell(0, lastRow, "note");

    expect(() => store.duplicateSelection()).not.toThrow();
  });

  it("fires CELL_CHANGED for the destination rect", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setCell(0, 0, "note", 60);
    store.selectCell(0, 0, "note");
    const onCellChanged = vi.fn();
    store.subscribe(events.CELL_CHANGED, onCellChanged);
    onCellChanged.mockClear();

    store.duplicateSelection();

    expect(onCellChanged).toHaveBeenCalledWith({ trackIndex: 0, rowIndex: 1 });
  });
});
