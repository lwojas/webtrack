import { describe, expect, it, vi } from "vitest";
import { createPushNoteEntryMode } from "../src/midi/push/noteEntryMode.js";
import { padNote, PUSH_CHANNEL, CC_ARROW_LEFT, CC_ARROW_RIGHT, CC_ARROW_UP, CC_ARROW_DOWN } from "../src/midi/push/constants.js";
import { PALETTE, RAW } from "../src/midi/push/colors.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { getSelectedPattern } from "../src/model/query.js";

function createFakeDevice() {
  return { send: vi.fn() };
}

// Mirrors trackerGridMode.js's own padRowForStep (and noteEntryMode.js's own copy of it) so
// the write-mode cursor overlay tests read the same way the module itself computes a cursor
// pad's physical row, rather than re-deriving it ad hoc per test.
function padRowForStep(stepWithinWindow) {
  return 7 - stepWithinWindow;
}

describe("createPushNoteEntryMode", () => {
  it("onPadOn emits the exact note the hardware assigned that pad, through noteInputSource.js's contract", () => {
    const mode = createPushNoteEntryMode();
    const onNoteOn = vi.fn();
    mode.onNoteOn(onNoteOn);

    mode.onPadOn(2, 3, 100);

    expect(onNoteOn).toHaveBeenCalledWith({ note: padNote(2, 3), velocity: 100, channel: PUSH_CHANNEL });
  });

  it("onPadOff emits a matching noteOff for the same pad", () => {
    const mode = createPushNoteEntryMode();
    const onNoteOff = vi.fn();
    mode.onNoteOff(onNoteOff);

    mode.onPadOff(0, 0);

    expect(onNoteOff).toHaveBeenCalledWith({ note: padNote(0, 0), channel: PUSH_CHANNEL });
  });

  it("attach() is a no-op satisfying noteInputSource.js's full contract shape", () => {
    const mode = createPushNoteEntryMode();
    expect(() => mode.attach()()).not.toThrow();
  });
});

describe("createPushNoteEntryMode — pad colors (point 7: a deliberate Note Mode color scheme)", () => {
  it("onEnter paints every pad to the configured base color", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });

    mode.onEnter();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(0, 0), PALETTE.NOTE_MODE_BASE]);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(7, 7), PALETTE.NOTE_MODE_BASE]);
    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("onPadOn lights the pressed color, onPadOff reverts it to the base color", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.onPadOn(2, 3, 100);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(2, 3), PALETTE.NOTE_MODE_PRESSED]);

    device.send.mockClear();
    mode.onPadOff(2, 3);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(2, 3), PALETTE.NOTE_MODE_BASE]);
  });

  it("onExit darkens every pad", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.onExit();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(0, 0), RAW.OFF]);
    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("a redundant repaint sends nothing — same diff-cache discipline trackerGridMode.js uses", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.paint();

    expect(device.send).not.toHaveBeenCalled();
  });

  it("refresh() resets the diff cache so a full repaint is sent again", () => {
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device });
    mode.onEnter();
    device.send.mockClear();

    mode.refresh();

    expect(device.send).toHaveBeenCalledTimes(64);
  });

  it("works without a device at all (the existing no-arg construction) — every send is a safe no-op", () => {
    const mode = createPushNoteEntryMode();
    expect(() => {
      mode.onEnter();
      mode.onPadOn(0, 0, 100);
      mode.onPadOff(0, 0);
      mode.onExit();
    }).not.toThrow();
  });
});

function createFakeWriteMode(active) {
  return { isActive: () => active };
}

describe("createPushNoteEntryMode — write mode: writing a note into the selected cell", () => {
  it("while write mode is off, a pad press never touches the model", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(false) });

    mode.onPadOn(2, 3, 100);

    const event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).toBe(null);
  });

  it("while write mode is on, a pad press writes the pad's note/velocity and the selected instrument into the selected cell", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectInstrument(5);
    store.selectCell(3, 7, "note");
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    mode.onPadOn(2, 3, 100); // padNote(2, 3)

    const event = getSelectedPattern(store.getState().song).tracks[3].events[7];
    expect(event.note).toBe(padNote(2, 3));
    expect(event.velocity).toBe(100);
    expect(event.instrument).toBe(5);
  });

  it("still emits the plain note-input-source event for audition, same as write mode off", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });
    const onNoteOn = vi.fn();
    mode.onNoteOn(onNoteOn);

    mode.onPadOn(2, 3, 100);

    expect(onNoteOn).toHaveBeenCalledWith({ note: padNote(2, 3), velocity: 100, channel: PUSH_CHANNEL });
  });

  it("auto-advances the cursor by editStep after writing, mirroring keyboard note entry", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.setEditStep(2);
    store.selectCell(0, 0, "note");
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    mode.onPadOn(0, 0, 100);

    expect(store.getState().cursor.rowIndex).toBe(2);
  });
});

describe("createPushNoteEntryMode — write mode: CC44-47 cursor navigation", () => {
  it("is a no-op while write mode is off", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(false) });

    mode.onCC(CC_ARROW_RIGHT, 127);

    expect(store.getState().cursor).toEqual({ trackIndex: 0, rowIndex: 0, field: "note" });
  });

  it("ignores a release (value 0)", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    mode.onCC(CC_ARROW_RIGHT, 0);

    expect(store.getState().cursor.trackIndex).toBe(0);
  });

  it("Left/Right move the cursor's track, wrapping at the song's track count", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    mode.onCC(CC_ARROW_LEFT, 127); // wraps from track 0 to the last track (7)
    expect(store.getState().cursor.trackIndex).toBe(7);

    mode.onCC(CC_ARROW_RIGHT, 127);
    mode.onCC(CC_ARROW_RIGHT, 127);
    expect(store.getState().cursor.trackIndex).toBe(1);
  });

  it("Up/Down move the cursor's row, wrapping at the pattern's row count", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    mode.onCC(CC_ARROW_UP, 127); // wraps from row 0 to the last row
    const rowCount = getSelectedPattern(store.getState().song).rowCount;
    expect(store.getState().cursor.rowIndex).toBe(rowCount - 1);

    mode.onCC(CC_ARROW_DOWN, 127);
    expect(store.getState().cursor.rowIndex).toBe(0);
  });

  it("navigation is arbitrary — not constrained to any visible window", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const mode = createPushNoteEntryMode({ store, writeMode: createFakeWriteMode(true) });

    for (let i = 0; i < 20; i++) mode.onCC(CC_ARROW_DOWN, 127);

    expect(store.getState().cursor.rowIndex).toBe(20);
  });
});

// The cursor overlay reuses trackerGridMode.js's own track=column, row=step-within-window
// mapping exactly (rowIndex wraps onto the 8-row grid every 8 rows, since Note Mode has no
// window offset of its own to page with) — so the highlighted pad's position is derived from
// the cursor's (trackIndex, rowIndex), never from what note (if any) happens to be in the cell.
describe("createPushNoteEntryMode — write mode: the selected-cell cursor overlay", () => {
  it("onEnter highlights the pad at the cursor's own (track, row) position", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(3, 2, "note");
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });

    mode.onEnter();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(2), 3), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("highlights the cursor's position even when the cell has no note at all", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(0, 0, "note"); // the default, empty cell
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });

    mode.onEnter();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 0), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("highlights nothing while write mode is off", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(3, 2, "note");
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(false) });

    mode.onEnter();

    expect(device.send).not.toHaveBeenCalledWith([0x90, expect.anything(), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("rowIndex wraps onto the 8-row grid every 8 rows, since Note Mode has no window to page", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(0, 9, "note"); // row 9 -> same physical row as row 1
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });

    mode.onEnter();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(1), 0), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("moves when the selected cell (CURSOR_MOVED) changes — e.g. a webtrack UI selection", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });
    mode.onEnter();
    device.send.mockClear();

    store.selectCell(5, 3, "note"); // the same mutator a grid click uses

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(3), 5), PALETTE.SELECTED_CELL_CURSOR]);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 0), PALETTE.NOTE_MODE_BASE]);
    mode.onExit();
  });

  it("CC44-47 cursor navigation moves the overlay the same way a UI selection does", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_ARROW_RIGHT, 127);

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 1), PALETTE.SELECTED_CELL_CURSOR]);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 0), PALETTE.NOTE_MODE_BASE]);
    mode.onExit();
  });

  it("holding the overlay's own pad down shows PRESSED, not the cursor color, while held", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(3, 2, "note");
    store.setEditStep(0); // disable auto-advance so writing a note doesn't move the overlay
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });
    mode.onEnter();
    device.send.mockClear();
    const overlayRow = padRowForStep(2);
    const overlayNote = padNote(overlayRow, 3);

    mode.onPadOn(overlayRow, 3, 90); // pressing the exact overlay pad

    expect(device.send).toHaveBeenCalledWith([0x90, overlayNote, PALETTE.NOTE_MODE_PRESSED]);
    // The intervening CELL_CHANGED from writing a note back in must not clobber PRESSED while
    // the pad is still physically held — this is the bug repaintRestColors's pressedNotes guard
    // exists to prevent.
    const lastSendForThisPad = device.send.mock.calls.filter(([bytes]) => bytes[1] === overlayNote).pop();
    expect(lastSendForThisPad[0][2]).toBe(PALETTE.NOTE_MODE_PRESSED);
    mode.onExit();
  });

  it("releasing the overlay's own pad restores the cursor color, not the plain base color", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(3, 2, "note");
    store.setEditStep(0); // disable auto-advance so writing a note doesn't move the overlay
    const device = createFakeDevice();
    const mode = createPushNoteEntryMode({ device, store, writeMode: createFakeWriteMode(true) });
    mode.onEnter();
    const overlayRow = padRowForStep(2);
    mode.onPadOn(overlayRow, 3, 90);
    device.send.mockClear();

    mode.onPadOff(overlayRow, 3);

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(overlayRow, 3), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("refresh() repaints the overlay (used when write mode itself is toggled on/off)", () => {
    const store = createStore({ song: createSong(), instruments: [] });
    store.selectCell(3, 2, "note");
    const device = createFakeDevice();
    let active = false;
    const mode = createPushNoteEntryMode({ device, store, writeMode: { isActive: () => active } });
    mode.onEnter();
    device.send.mockClear();

    active = true;
    mode.refresh();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(2), 3), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });
});
