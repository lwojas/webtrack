// Pure text-building helpers for Push's 4x68-char LCD (constants.js#lcdSysex sends the actual
// SysEx; this file only ever builds the plain-ASCII strings passed into it). Kept separate from
// constants.js, which is protocol data only by its own doc comment — this is rendering logic,
// the same split colors.js/trackerGridMode.js already draw between "hardware facts" and "how
// webtrack chooses to use them." Only printable ASCII 32-126 is confirmed to render (constants.js's
// own doc comment), and only `[ ] - =` are sanctioned for level-bar glyphs — never block
// characters.
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

// Joins up to 8 fixed-width columns into one line — constants.js#lcdSysex pads/truncates to its
// own LCD_LINE_LENGTH (68) afterward, so this only needs to produce the 8*width content itself.
export function buildEncoderLine(columns, width = 8) {
  return columns.map((column) => padColumn(column ?? "", width)).join("");
}
