// The single source of truth for bar/beat/step math — both audio/playbackController.js (what
// a step actually sounds like) and the grid's vertical legend (what a step looks like) read
// these same constants, so the legend can never drift from playback timing.
export const STEPS_PER_BEAT = 4; // one tracker row = a 16th note at 4/4
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR; // 16

export const MAX_BARS = 8;

export function rowCountForBars(bars) {
  return bars * STEPS_PER_BAR;
}

export function barsForRowCount(rowCount) {
  return rowCount / STEPS_PER_BAR;
}

// 1-based bar/beat (tracker convention); tick is the row's position within its beat (0 means
// "first row of the beat" — the grid legend only labels those rows).
export function rowToBarBeat(rowIndex) {
  const bar = Math.floor(rowIndex / STEPS_PER_BAR) + 1;
  const beat = Math.floor((rowIndex % STEPS_PER_BAR) / STEPS_PER_BEAT) + 1;
  const tick = rowIndex % STEPS_PER_BEAT;
  return { bar, beat, tick };
}

export function formatBarBeat(rowIndex) {
  const { bar, beat } = rowToBarBeat(rowIndex);
  return `${bar}.${beat}`;
}
