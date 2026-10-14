// Push Mk1 LED color constants, in two layers — see the architecture doc's "Color palette"
// section for why.
//
// RAW is the hardware byte layer: the velocity-color-led values Push accepts for a pad/
// mute-strip/select-button LED (sent back as a Note On velocity or CC value on that same
// control — see constants.js). Ported from midi-core's own hardware-validation docs; only
// OFF/DIM_WHITE/RED/GREEN/TEAL are independently hardware-confirmed (teal specifically on
// pads, via the playhead; red/green on the mute strip and select buttons). Nothing outside
// this file should reference a raw byte directly.
export const RAW = {
  OFF: 0,
  DIM_WHITE: 10,
  RED: 6,
  GREEN: 22,
  TEAL: 36,
  AMBER: 29, // unconfirmed on pads in midi-core's own source — provisional, see PALETTE below
};

// PALETTE is the one semantic layer webtrack's own Push rendering code should ever import, for
// every control that's actually in the velocity-color-led family (pads, mute strip, select
// buttons) — re-theming webtrack's Push look (or swapping a provisional byte once
// hardware-checked) is a one-place edit here, never a change scattered across mapping/
// rendering logic.
//
// This does NOT cover every LED on the device: Note/Session/Track/Clip (and Play/Shift/etc.)
// are a different hardware feedback family entirely — monochrome dim/full/blink, not color —
// confirmed the hard way (see this project's git history: an earlier version of
// modeController.js wired the mode buttons to RAW.GREEN/RAW.DIM_WHITE from here, which looked
// plausible in code review but never visibly changed anything on the real device, because
// those bytes (22, 10) are both ≥7 and both just clamp to the monochrome scheme's "full"
// state). Use constants.js's FEEDBACK_OFF/FEEDBACK_FULL/etc. for that family instead — never
// a RAW/PALETTE color.
export const PALETTE = {
  CELL_EMPTY: RAW.OFF,
  CELL_HAS_NOTE: RAW.GREEN,
  CELL_PLAYHEAD: RAW.TEAL,
  // The playhead wins the composite feedback priority rule (playhead > own-step > nothing) —
  // same color whether or not the step under it also has a note, so the playhead is always
  // readable at a glance.
  CELL_PLAYHEAD_HAS_NOTE: RAW.TEAL,
  TRACK_MUTED: RAW.RED,
  TRACK_AUDIBLE: RAW.DIM_WHITE,
  TRACK_SELECTED: RAW.GREEN,
  TRACK_UNSELECTED: RAW.DIM_WHITE,
  // Provisional (built on RAW.AMBER, unconfirmed on pads) — for a future Note Mode's
  // root-note-highlight; re-check against real hardware before relying on it.
  NOTE_KEY_ROOT: RAW.AMBER,
  NOTE_KEY_IN_RANGE: RAW.DIM_WHITE,
  // Note Mode's own resting/pressed pair (noteEntryMode.js) — kept here, centrally, with every
  // other Push color rather than buried in that file, so re-theming is a one-place edit like
  // everything else above. AMBER is provisional (see RAW's own caveat); GREEN is confirmed.
  NOTE_MODE_BASE: RAW.AMBER,
  NOTE_MODE_PRESSED: RAW.GREEN,
  // Write mode's own selected-cell cursor (writeMode.js/trackerGridMode.js/noteEntryMode.js) —
  // marks the pad at the selected cell's own (track, row) position. trackerGridMode.js's
  // Session/Grid view paints it directly, winning its own composite priority rule ahead of
  // both the playhead and has-note coloring (while actively editing, knowing exactly which cell
  // Push is about to write into matters more than briefly seeing the playhead pass through it).
  // noteEntryMode.js's Note Mode reuses the exact same (track, row)-to-pad mapping
  // trackerGridMode.js established (its own doc comment explains why: the two views must put
  // the cursor on the same physical pad for the same selected cell, not two different
  // conventions) rather than, say, highlighting whichever pad matches the *note* already in the
  // cell — that alternative was tried first and didn't move predictably with CC44-47, since two
  // cells rarely hold adjacent note values. RAW.RED, not RAW.AMBER: AMBER is already Note Mode's
  // own resting pad color (NOTE_MODE_BASE above), so using it here would make the overlay
  // invisible against the rest of the grid in exactly the view that most needs it. RED is
  // otherwise only ever sent on the mute strip's CCs, never on a pad's Note On/Off, so there's
  // no ambiguity reusing it here — confirmed hardware byte, unlike AMBER.
  SELECTED_CELL_CURSOR: RAW.RED,
  // Write mode's grid *range* selection (Shift+pad, trackerGridMode.js) — deliberately a
  // different color from SELECTED_CELL_CURSOR above: a single selected cell and a multi-cell
  // range selected for an operation (Duplicate) are two distinct concepts the brief explicitly
  // calls out, so every cell within an active range shows this color uniformly instead of the
  // single-cell cursor color. RAW.DIM_WHITE: every other RAW byte is already claimed somewhere
  // in the Session/Grid pad context (OFF=empty, GREEN=has-note, TEAL=playhead, RED=cursor) —
  // DIM_WHITE is the one byte never painted on a pad today, the same "reuse a confirmed byte in
  // a new context" move SELECTED_CELL_CURSOR's own choice of RED already made.
  GRID_SELECTION: RAW.DIM_WHITE,
};
