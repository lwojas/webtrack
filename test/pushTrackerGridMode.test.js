import { describe, expect, it, vi, afterEach } from "vitest";
import { createPushTrackerGridMode } from "../src/midi/push/trackerGridMode.js";
import { createStore } from "../src/state/store.js";
import { createSong } from "../src/model/song.js";
import { padNote, MUTE_CC, TRACK_SELECT_CC, CC_ARROW_UP, CC_ARROW_DOWN } from "../src/midi/push/constants.js";
import { PALETTE, RAW } from "../src/midi/push/colors.js";
import { getSelectedPattern } from "../src/model/query.js";

// Track = pad column; step-within-window = pad row, top-to-bottom (row 7 = earliest/top, row 0
// = latest/bottom — padNote's own row is bottom-origin). Mirrors trackerGridMode.js's own
// padRowForStep so tests read the same way the module itself computes a pad's note number.
function padRowForStep(stepWithinWindow) {
  return 7 - stepWithinWindow;
}

function createTestContext() {
  const song = createSong(); // 8 tracks, 64 rows, one empty pattern
  const store = createStore({ song, instruments: [] });
  const device = { send: vi.fn() };
  const trackPlayheadRows = new Array(8).fill(-1);
  const playbackController = { getTrackPlayheadRow: (trackIndex) => trackPlayheadRows[trackIndex] };
  const mode = createPushTrackerGridMode({ device, store, playbackController });
  return { store, device, playbackController, trackPlayheadRows, mode };
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
