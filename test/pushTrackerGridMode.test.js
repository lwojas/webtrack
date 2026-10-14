import { describe, expect, it, vi, afterEach } from "vitest";
import { createPushTrackerGridMode } from "../src/midi/push/trackerGridMode.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import {
  padNote,
  MUTE_CC,
  TRACK_SELECT_CC,
  CC_ARROW_UP,
  CC_ARROW_DOWN,
  CC_SHIFT,
  CC_DUPLICATE,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
} from "../src/midi/push/constants.js";
import { PALETTE, RAW } from "../src/midi/push/colors.js";
import { getSelectedPattern } from "../src/model/query.js";

// Track = pad column; step-within-window = pad row, top-to-bottom (row 7 = earliest/top, row 0
// = latest/bottom — padNote's own row is bottom-origin). Mirrors trackerGridMode.js's own
// padRowForStep so tests read the same way the module itself computes a pad's note number.
function padRowForStep(stepWithinWindow) {
  return 7 - stepWithinWindow;
}

function createFakeWriteMode(active) {
  // Mutable via `.active` so a test can flip it mid-flight (e.g. simulating Record being
  // pressed off while a Push-made range selection is still active).
  return { active, isActive() { return this.active; } };
}

function createTestContext({ writeModeActive = false } = {}) {
  const song = createSong(); // 8 tracks, 64 rows, one empty pattern
  const store = createStore({ song, instruments: [] });
  const device = { send: vi.fn() };
  const trackPlayheadRows = new Array(8).fill(-1);
  const playbackController = { getTrackPlayheadRow: (trackIndex) => trackPlayheadRows[trackIndex] };
  const writeMode = createFakeWriteMode(writeModeActive);
  const mode = createPushTrackerGridMode({ device, store, playbackController, writeMode });
  return { store, device, playbackController, trackPlayheadRows, writeMode, mode };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createPushTrackerGridMode — painting (track = column, step = row, top-to-bottom)", () => {
  // modeController.js calls onEnter() and paint() as two separate hooks (see its own doc
  // comment) — every test here drives them the same way to match how the controller actually
  // invokes a gridContent entry.
  it("onEnter+paint paints every pad in the window dark on a fresh empty song", () => {
    const { device, mode } = createTestContext();
    mode.onEnter();
    mode.paint();
    const padSends = device.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90);
    expect(padSends).toHaveLength(64);
    expect(padSends.every(([bytes]) => bytes[2] === RAW.OFF)).toBe(true);
    mode.onExit();
  });

  it("paints the mute strip as audible (no mute/solo anywhere) and the track-select buttons with track 0 selected by default", () => {
    const { device, mode } = createTestContext();
    mode.onEnter();
    mode.paint();
    expect(device.send).toHaveBeenCalledWith([0xb0, MUTE_CC[3], PALETTE.TRACK_AUDIBLE]);
    expect(device.send).toHaveBeenCalledWith([0xb0, TRACK_SELECT_CC[0], PALETTE.TRACK_SELECTED]);
    expect(device.send).toHaveBeenCalledWith([0xb0, TRACK_SELECT_CC[1], PALETTE.TRACK_UNSELECTED]);
    mode.onExit();
  });

  it("a note at step 3 (track 2) paints its column/row correctly, top-to-bottom; a muted/soloed-out track's mute LED turns red", () => {
    const { store, device, mode } = createTestContext();
    store.setCell(2, 3, "note", 60); // track 2, step 3 -> pad column 2, row padRowForStep(3)=4
    store.getState().song.trackChannels[5].muted = true;

    device.send.mockClear();
    mode.onEnter();
    mode.paint();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(3), 2), PALETTE.CELL_HAS_NOTE]);
    expect(device.send).toHaveBeenCalledWith([0xb0, MUTE_CC[5], PALETTE.TRACK_MUTED]);
    mode.onExit();
  });

  it("onExit darkens every pad and both control rows", () => {
    const { device, mode } = createTestContext();
    mode.onEnter();
    device.send.mockClear();

    mode.onExit();

    const padSends = device.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90);
    expect(padSends).toHaveLength(64);
    expect(padSends.every(([bytes]) => bytes[2] === RAW.OFF)).toBe(true);
    expect(device.send).toHaveBeenCalledWith([0xb0, MUTE_CC[0], RAW.OFF]);
    expect(device.send).toHaveBeenCalledWith([0xb0, TRACK_SELECT_CC[0], RAW.OFF]);
  });

  it("onExit only sends OFF for pads that were actually lit — the fix for stale LEDs bleeding into the next mode", () => {
    const { store, device, mode } = createTestContext();
    store.setCell(0, 0, "note", 60); // the only lit pad in an otherwise empty grid
    mode.onEnter();
    mode.paint();
    device.send.mockClear();

    mode.onExit();

    const padSends = device.send.mock.calls.map(([bytes]) => bytes).filter((bytes) => bytes[0] === 0x90);
    // Only the one pad that was actually green needs an OFF — every already-dark pad is a
    // no-op send, same diff discipline as a live repaint.
    expect(padSends).toHaveLength(1);
    expect(padSends[0]).toEqual([0x90, padNote(padRowForStep(0), 0), RAW.OFF]);
  });
});

describe("createPushTrackerGridMode — pad toggles a step", () => {
  it("pressing an empty step writes a note at the pad's own velocity, using the selected instrument", () => {
    const { store, mode } = createTestContext();
    store.selectInstrument(3);
    mode.onEnter();

    // column 1 = track 1; row padRowForStep(2) = 5 -> step 2 (stepOffset 0).
    mode.onPadOn(padRowForStep(2), 1, 90);

    const event = getSelectedPattern(store.getState().song).tracks[1].events[2];
    expect(event.note).toBe(60);
    expect(event.instrument).toBe(3);
    expect(event.velocity).toBe(90);
    mode.onExit();
  });

  it("pressing an occupied step clears only note/instrument/velocity, leaving length/fx untouched", () => {
    const { store, mode } = createTestContext();
    store.setCell(0, 0, "note", 64);
    store.setCell(0, 0, "instrument", 1);
    store.setCell(0, 0, "velocity", 100);
    store.setCell(0, 0, "length", 4);
    mode.onEnter();

    mode.onPadOn(padRowForStep(0), 0, 50); // track 0, step 0

    const event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).toBe(null);
    expect(event.instrument).toBe(null);
    expect(event.velocity).toBe(null);
    expect(event.length).toBe(4);
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — onCC: mute, track select, paging", () => {
  it("MUTE_CC toggles that track's muted flag, ignoring a release (value 0)", () => {
    const { store, mode } = createTestContext();
    mode.onEnter();

    mode.onCC(MUTE_CC[4], 0); // release — no-op
    expect(store.getState().song.trackChannels[4].muted).toBe(false);

    mode.onCC(MUTE_CC[4], 127);
    expect(store.getState().song.trackChannels[4].muted).toBe(true);

    mode.onCC(MUTE_CC[4], 127); // toggles back
    expect(store.getState().song.trackChannels[4].muted).toBe(false);
    mode.onExit();
  });

  it("TRACK_SELECT_CC moves the cursor's track, keeping its row/field", () => {
    const { store, mode } = createTestContext();
    store.moveCursor({ row: 5 });
    mode.onEnter();

    mode.onCC(TRACK_SELECT_CC[6], 127);

    expect(store.getState().cursor).toEqual({ trackIndex: 6, rowIndex: 5, field: "note" });
    mode.onExit();
  });

  it("CC_ARROW_DOWN pages the step window forward (to later steps) by 8, repainting; CC_ARROW_UP pages back", () => {
    const { store, device, mode } = createTestContext();
    store.setCell(0, 10, "note", 60); // in the second page (steps 8-15)
    mode.onEnter();
    mode.paint(); // establish the cache for page 1 first, so the page-forward diff is meaningful
    device.send.mockClear();

    mode.onCC(CC_ARROW_DOWN, 127);
    // Step 10 is now step-within-window 2 (10 - stepOffset 8) -> row padRowForStep(2).
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(2), 0), PALETTE.CELL_HAS_NOTE]);

    device.send.mockClear();
    mode.onCC(CC_ARROW_UP, 127);
    // Back on the first page: the physical pad that showed step 10 (row padRowForStep(2),
    // cached green) now shows step 2 instead, which is empty — that's the one pad whose color
    // actually changed, so it's the one (and, given every other pad on this page was already
    // correctly dark from the very first mode.paint() above, the *only* one) the diff cache
    // sends an update for. This is the diffing fix actually doing its job, not a coincidence:
    // step 0's own pad (padRowForStep(0)) never changed color across the whole test and
    // correctly sends nothing.
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(2), 0), RAW.OFF]);
    const padSends = device.send.mock.calls.map(([bytes]) => bytes).filter((bytes) => bytes[0] === 0x90);
    expect(padSends).toHaveLength(1);
    mode.onExit();
  });

  it("CC_ARROW_UP at the first page is a clamped no-op (no repaint)", () => {
    const { device, mode } = createTestContext();
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_ARROW_UP, 127);

    expect(device.send).not.toHaveBeenCalled();
    mode.onExit();
  });

  it("paging only sends messages for pads whose color actually changed (the LED-flood fix)", () => {
    const { device, mode } = createTestContext();
    // Identical content on both pages (both fully empty) — paging should produce zero sends,
    // since every pad's color is unchanged from what was already painted on page 1.
    mode.onEnter();
    mode.paint();
    device.send.mockClear();

    mode.onCC(CC_ARROW_DOWN, 127);

    expect(device.send).not.toHaveBeenCalled();
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — live playhead LEDs", () => {
  it("polls and repaints only the (old, new) cells whose playhead row actually changed", () => {
    vi.useFakeTimers();
    const { device, trackPlayheadRows, mode } = createTestContext();
    mode.onEnter();
    device.send.mockClear();

    trackPlayheadRows[0] = 3; // track 0's playhead moves onto step 3
    vi.advanceTimersByTime(50);

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(3), 0), PALETTE.CELL_PLAYHEAD]);
    // No other track's playhead changed — nothing else should have been repainted.
    const padSends = device.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90);
    expect(padSends).toHaveLength(1);

    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: pad selects a cell instead of toggling it", () => {
  it("a pad press selects the corresponding tracker cell, leaving the event untouched", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();

    mode.onPadOn(padRowForStep(2), 1, 90); // track 1, step 2

    expect(store.getState().cursor).toEqual({ trackIndex: 1, rowIndex: 2, field: "note" });
    const event = getSelectedPattern(store.getState().song).tracks[1].events[2];
    expect(event.note).toBe(null); // no toggle happened — selection only
    mode.onExit();
  });

  it("pressing a pad over an already-occupied cell selects it rather than clearing it", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    store.setCell(0, 0, "note", 64);
    mode.onEnter();

    mode.onPadOn(padRowForStep(0), 0, 50);

    expect(store.getState().cursor).toEqual({ trackIndex: 0, rowIndex: 0, field: "note" });
    const event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).toBe(64);
    mode.onExit();
  });

  it("preserves the cursor's own field, same as TRACK_SELECT_CC selection does", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    store.selectCell(0, 0, "velocity");
    mode.onEnter();

    mode.onPadOn(padRowForStep(5), 3, 90);

    expect(store.getState().cursor).toEqual({ trackIndex: 3, rowIndex: 5, field: "velocity" });
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: selected-cell cursor color", () => {
  it("paints the cursor's own cell with SELECTED_CELL_CURSOR, ahead of has-note coloring", () => {
    const { store, device, mode } = createTestContext({ writeModeActive: true });
    store.setCell(2, 3, "note", 60); // would otherwise paint CELL_HAS_NOTE
    store.selectCell(2, 3, "note");
    device.send.mockClear();

    mode.onEnter();
    mode.paint();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(3), 2), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("wins over the playhead when both coincide", () => {
    const { store, trackPlayheadRows, device, mode } = createTestContext({ writeModeActive: true });
    store.selectCell(4, 2, "note");
    trackPlayheadRows[4] = 2;
    device.send.mockClear();

    mode.onEnter();
    mode.paint();

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(2), 4), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("does not paint the cursor color while write mode is off", () => {
    const { store, device, mode } = createTestContext({ writeModeActive: false });
    store.selectCell(2, 3, "note");
    device.send.mockClear();

    mode.onEnter();
    mode.paint();

    expect(device.send).not.toHaveBeenCalledWith([0x90, padNote(padRowForStep(3), 2), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });

  it("repaints the cursor highlight on CURSOR_MOVED (e.g. a webtrack UI selection)", () => {
    const { store, device, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.paint();
    device.send.mockClear();

    store.selectCell(5, 6, "note"); // the "UI selects a cell" path — same mutator a grid click uses

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(6), 5), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: Shift LED (CC49)", () => {
  it("is dim on entry, full while physically held, dim again on release", () => {
    const { device, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_SHIFT, 127);
    expect(device.send).toHaveBeenCalledWith([0xb0, CC_SHIFT, FEEDBACK_FULL]);

    device.send.mockClear();
    mode.onCC(CC_SHIFT, 0);
    expect(device.send).toHaveBeenCalledWith([0xb0, CC_SHIFT, FEEDBACK_DIM]);
    mode.onExit();
  });

  it("does nothing while write mode is off — normal/inert behaviour", () => {
    const { device, mode } = createTestContext({ writeModeActive: false });
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_SHIFT, 127);

    expect(device.send).not.toHaveBeenCalledWith([0xb0, CC_SHIFT, FEEDBACK_FULL]);
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: grid range selection (Shift + pad)", () => {
  it("Shift + the first pad selects cell 0 only", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();

    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(0), 0, 90); // track 0, step 0 — the tracker's own first cell

    const rect = store.getSelectionRect();
    expect(rect).toEqual({ trackStart: 0, trackEnd: 0, rowStart: 0, rowEnd: 0 });
    mode.onExit();
  });

  it("Shift + a pad further into the grid selects every cell from 0 through that pad", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();

    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(7), 3, 90); // track 3, step 7

    expect(store.getSelectionRect()).toEqual({ trackStart: 0, trackEnd: 3, rowStart: 0, rowEnd: 7 });
    mode.onExit();
  });

  it("a second Shift + pad replaces the previous range rather than extending it", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(7), 7, 90); // a big first selection

    mode.onPadOn(padRowForStep(1), 2, 90); // a second, smaller one, still shift-held

    expect(store.getSelectionRect()).toEqual({ trackStart: 0, trackEnd: 2, rowStart: 0, rowEnd: 1 });
    mode.onExit();
  });

  it("without Shift, a pad press dismisses an existing selection and selects that single cell", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(5), 4, 90);
    mode.onCC(CC_SHIFT, 0);

    mode.onPadOn(padRowForStep(2), 1, 90); // plain press, no shift

    expect(store.getSelectionRect()).toEqual({ trackStart: 1, trackEnd: 1, rowStart: 2, rowEnd: 2 });
    mode.onExit();
  });

  it("the range selection paints every cell within it as GRID_SELECTION", () => {
    const { device, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(1), 1, 90); // rect: tracks 0-1, rows 0-1 — the CURSOR_MOVED this
    // triggers already repaints the grid automatically (same subscription every other cursor
    // move goes through), so there's no separate mode.paint() call needed to see the result.

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 0), PALETTE.GRID_SELECTION]);
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(1), 1), PALETTE.GRID_SELECTION]);
    // Outside the rect: ordinary empty-cell coloring, not the range color.
    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 2), RAW.OFF]);
    mode.onExit();
  });

  it("a 1x1 selection still shows SELECTED_CELL_CURSOR, not GRID_SELECTION", () => {
    const { device, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    device.send.mockClear();

    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(0), 0, 90); // rect collapses to exactly cell (0,0)

    expect(device.send).toHaveBeenCalledWith([0x90, padNote(padRowForStep(0), 0), PALETTE.SELECTED_CELL_CURSOR]);
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: Duplicate (CC88)", () => {
  it("LED is dim without a selection, full once a range selection exists", () => {
    const { device, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.paint();

    expect(device.send).toHaveBeenCalledWith([0xb0, CC_DUPLICATE, FEEDBACK_DIM]);

    device.send.mockClear();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(1), 1, 90);

    expect(device.send).toHaveBeenCalledWith([0xb0, CC_DUPLICATE, FEEDBACK_FULL]);
    mode.onExit();
  });

  it("pressing Duplicate without a selection is a no-op", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();

    expect(() => mode.onCC(CC_DUPLICATE, 127)).not.toThrow();
    expect(store.getState().song.patterns[0].tracks[0].events[1].note).toBe(null);
    mode.onExit();
  });

  it("pressing Duplicate duplicates the selection below itself via the existing store functionality", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    store.setCell(1, 0, "note", 60);
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(0), 1, 90); // selects rect: tracks 0-1, row 0

    mode.onCC(CC_DUPLICATE, 127);

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[1].events[1].note).toBe(60); // duplicated directly below row 0
    mode.onExit();
  });

  it("restores the normal single-cell cursor state and dims Duplicate after duplicating", () => {
    const { store, device, mode } = createTestContext({ writeModeActive: true });
    store.setCell(1, 0, "note", 60);
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(0), 1, 90);
    device.send.mockClear();

    mode.onCC(CC_DUPLICATE, 127);

    const rect = store.getSelectionRect();
    expect(rect).toEqual({ trackStart: 1, trackEnd: 1, rowStart: 0, rowEnd: 0 }); // collapsed to the cursor's own cell
    expect(device.send).toHaveBeenCalledWith([0xb0, CC_DUPLICATE, FEEDBACK_DIM]);
    mode.onExit();
  });

  it("does nothing while write mode is off", () => {
    const { store, mode } = createTestContext({ writeModeActive: false });
    store.selectCell(0, 0, "note");
    store.extendSelectionTo(1, 1);
    mode.onEnter();

    mode.onCC(CC_DUPLICATE, 127);

    const pattern = getSelectedPattern(store.getState().song);
    expect(pattern.tracks[0].events[2].note).toBe(null); // no duplication happened
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — write mode: selection lifecycle across mode/write-mode transitions", () => {
  it("onExit dismisses a Push-made range selection", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(3), 2, 90);

    mode.onExit();

    const rect = store.getSelectionRect();
    expect(rect.trackStart).toBe(rect.trackEnd);
    expect(rect.rowStart).toBe(rect.rowEnd);
  });

  it("onExit never touches a selection the desktop UI made independently of Push", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    store.selectCell(2, 0, "note");
    store.extendSelectionTo(4, 3); // the same pair a mouse shift+click/drag would call
    mode.onEnter();

    mode.onExit();

    expect(store.getSelectionRect()).toEqual({ trackStart: 2, trackEnd: 4, rowStart: 0, rowEnd: 3 });
  });

  it("refresh() dismisses a Push-made selection once write mode has turned off", () => {
    const { store, writeMode, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(3), 2, 90);
    writeMode.active = false; // Record pressed — write mode off, still in this view

    mode.refresh();

    const rect = store.getSelectionRect();
    expect(rect.trackStart).toBe(rect.trackEnd);
    expect(rect.rowStart).toBe(rect.rowEnd);
    mode.onExit();
  });

  it("refresh() leaves a desktop-made selection alone even after write mode turns off", () => {
    const { store, writeMode, mode } = createTestContext({ writeModeActive: true });
    store.selectCell(2, 0, "note");
    store.extendSelectionTo(4, 3);
    mode.onEnter();
    writeMode.active = false;

    mode.refresh();

    expect(store.getSelectionRect()).toEqual({ trackStart: 2, trackEnd: 4, rowStart: 0, rowEnd: 3 });
    mode.onExit();
  });

  it("re-entering with write mode still active has no stale range selection left over", () => {
    const { store, mode } = createTestContext({ writeModeActive: true });
    mode.onEnter();
    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(3), 2, 90);
    mode.onExit(); // leaving the view dismisses the Push-made selection

    mode.onEnter(); // returning, write mode still on

    const rect = store.getSelectionRect();
    expect(rect.trackStart).toBe(rect.trackEnd);
    expect(rect.rowStart).toBe(rect.rowEnd);
    mode.onExit();
  });

  it("existing non-write-mode Session/Grid behaviour is unchanged — Shift/Duplicate stay inert", () => {
    const { store, device, mode } = createTestContext({ writeModeActive: false });
    mode.onEnter();

    mode.onCC(CC_SHIFT, 127);
    mode.onPadOn(padRowForStep(0), 0, 90); // a plain toggle-step press, same as always

    const event = getSelectedPattern(store.getState().song).tracks[0].events[0];
    expect(event.note).not.toBe(null); // toggled on, exactly like before this feature existed
    expect(device.send).not.toHaveBeenCalledWith([0x90, expect.anything(), PALETTE.GRID_SELECTION]);
    mode.onExit();
  });
});

describe("createPushTrackerGridMode — refresh()", () => {
  // Used by modeController.js#refresh() (a Push reconnect, or the Settings modal's manual
  // refresh button) when this is the active content — must reset the diff cache (so a stale
  // cache from before a reconnect can't suppress a send the device actually needs) and
  // repaint, without re-subscribing to the store.
  it("resets the diff cache so a full repaint is sent again, even though nothing changed", () => {
    const { device, mode } = createTestContext();
    mode.onEnter();
    mode.paint();
    device.send.mockClear();

    mode.refresh();

    const padSends = device.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90);
    expect(padSends).toHaveLength(64);
    mode.onExit();
  });
});
