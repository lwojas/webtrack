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

export const SWING_MIN = 0;
export const SWING_MAX = 100;

// Swing is a scheduling-time adjustment, not a change to logical position (see
// docs/ARCHITECTURE.md's "Audio / timing architecture" — the logical step/row a track is on,
// and everything derived from it, stays untouched; only the *moment* a step's events actually
// fire moves). It delays the "off" half of each on/off step pair — the same 2:1-ratio
// definition hardware (MPC) and software (Ableton, FL Studio) swing use: at swingAmount 0 the
// pair is split evenly (each half one full step), and at 100 it's split into a full triplet
// ratio (4/3 step, 2/3 step) — i.e. the off step is pushed as much as a third of a step late.
// stepIndex is the shared transport step (lookaheadPlayer's stepCounter), not a pattern- or
// track-relative row — its parity alone decides on/off, so the swing phase never shifts at a
// pattern boundary or a track's own polymetric wrap, and downbeats (even-indexed steps) are
// never delayed, which is what keeps overall beat duration/BPM correct.
export function swingDelaySeconds(stepIndex, stepDurationSeconds, swingAmount) {
  if (stepIndex % 2 === 0 || !swingAmount) return 0;
  return stepDurationSeconds * (swingAmount / 300);
}
