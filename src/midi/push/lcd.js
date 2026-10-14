// Pure text-building helpers for Push's 4x68-char LCD (constants.js#lcdSysex sends the actual
// SysEx; this file only ever builds the plain-ASCII strings passed into it). Kept separate from
// constants.js, which is protocol data only by its own doc comment — this is rendering logic,
// the same split colors.js/trackerGridMode.js already draw between "hardware facts" and "how
// webtrack chooses to use them." Only printable ASCII 32-126 is confirmed to render (constants.js's
// own doc comment), and only `[ ] - =` are sanctioned for level-bar glyphs — never block
// characters. buildEncoderLine does read constants.js's LCD_SEGMENT_OFFSETS/LCD_LINE_LENGTH below
// — hardware geometry it positions against, not protocol data it owns.
import { LCD_LINE_LENGTH, LCD_SEGMENT_OFFSETS, LCD_SEGMENT_WIDTH } from "./constants.js";

export function padColumn(text, width) {
  return text.slice(0, width).padEnd(width);
}

export function centerColumn(text, width) {
  const clipped = text.slice(0, width);
  const totalPad = width - clipped.length;
  const left = Math.floor(totalPad / 2);
  return " ".repeat(left) + clipped + " ".repeat(totalPad - left);
}

// A `[===---]`-shaped bar, sized to exactly `width` characters (brackets included) — ratio is
// clamped to [0, 1] so an out-of-range value never produces a malformed glyph count.
export function formatBar(ratio, width = 8) {
  const innerWidth = width - 2;
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * innerWidth);
  return `[${"=".repeat(filled)}${"-".repeat(innerWidth - filled)}]`;
}

// Places up to 8 encoder columns at their actual physical segment offsets
// (constants.js#LCD_SEGMENT_OFFSETS) rather than packing them contiguously. The hardware groups
// the 8 encoder segments into 4 physical display units of 17 characters (two 8-wide segments
// plus one spare column between them), so a naive `index * width` placement works for the first
// pair and then drifts one column further out of alignment with the physical encoder at every
// display-unit boundary crossed — by encoder 7/8 that's visibly offset from its display unit.
// Encoder index beyond LCD_SEGMENT_OFFSETS' length (only ever 8 for this hardware) is dropped
// rather than throwing, the same "extra columns are simply unassigned" convention
// encoderController.js#fxColumns already uses for a too-short param list.
export function buildEncoderLine(columns, width = LCD_SEGMENT_WIDTH) {
  const line = new Array(LCD_LINE_LENGTH).fill(" ");
  columns.forEach((column, index) => {
    const offset = LCD_SEGMENT_OFFSETS[index];
    if (offset === undefined) return;
    const text = padColumn(column ?? "", width);
    for (let i = 0; i < text.length && offset + i < LCD_LINE_LENGTH; i++) {
      line[offset + i] = text[i];
    }
  });
  return line.join("");
}
