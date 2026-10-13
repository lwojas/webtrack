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
};
