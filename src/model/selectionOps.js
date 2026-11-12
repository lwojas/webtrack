// Phase 1 selection-editing operations (Clear/Repeat/Fill Right/Fill Down — see
// src/ui/chrome/SelectionToolbar.jsx and state/store.js). A selection rect is
// { trackStart, trackEnd, rowStart, rowEnd }, inclusive on both ends — the same rectangle every
// caller derives from the cursor + its anchor (store.js#getSelectionRect), never a second
// selection representation of its own.
import { createEmptyEvent, cloneEvent } from "./event.js";
import { noteForSlice } from "./chop.js";

// Clears every event in rect back to empty, in place — the same per-cell reset
// Backspace/Delete already did for a single cell, just over a whole rect (1x1 for the
// unselected case, so there's no behavior change there).
export function clearRect(pattern, rect) {
  for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
    const track = pattern.tracks[t];
    if (!track) continue;
    for (let r = rect.rowStart; r <= rect.rowEnd && r < track.events.length; r++) {
      track.events[r] = createEmptyEvent();
    }
  }
}

// Captures rect's events as a block[trackOffset][rowOffset] of independent clones — what Copy
// stores as the clipboard, and the shape tileBlockIntoRect below tiles back in. Clones every
// cell so later edits to the source can never leak into a pasted/tiled copy (same reasoning as
// model/event.js#cloneEvent's own doc comment).
export function captureBlock(pattern, rect) {
  const block = [];
  for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
    const track = pattern.tracks[t];
    const column = [];
    for (let r = rect.rowStart; r <= rect.rowEnd; r++) {
      column.push(cloneEvent(track?.events[r] ?? createEmptyEvent()));
    }
    block.push(column);
  }
  return block;
}

// Tiles `block` across rect, wrapping independently on each axis via modulo — the one piece of
// math shared by Repeat, Fill Right, and Fill Down (state/store.js#fillSelection): all three
// hand this the same clipboard block, and differ only in which axis the toolbar considers them
// relevant for (and therefore enables them for), not in how the tiling itself works. A future
// pattern transform (random, Euclidean, rotate, reverse) plugs in the same way — produce a
// block shaped like this one and hand it to this function, or a sibling of it.
export function tileBlockIntoRect(pattern, rect, block) {
  const blockWidth = block.length;
  const blockHeight = block[0]?.length ?? 0;
  if (blockWidth === 0 || blockHeight === 0) return;

  for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
    const track = pattern.tracks[t];
    if (!track) continue;
    const column = block[(t - rect.trackStart) % blockWidth];
    for (let r = rect.rowStart; r <= rect.rowEnd && r < track.events.length; r++) {
      track.events[r] = cloneEvent(column[(r - rect.rowStart) % blockHeight]);
    }
  }
}

// Replaces every cell in rect with a note that plays one chop slice of `instrument` (a chop-mode
// slot, played as note = rootNote + slice — model/chop.js). In order, each track counts slices up
// from slice 1 at the rect's first row and wraps at `slices`; with `random` (a () => 0..1) each
// cell gets a random slice instead. Cells whose slice falls past the note range are left empty.
// `spacing` is the rows between notes (1 = every row); the rows in between are cleared, and the slice
// counter advances once per note, not per row.
export function fillRectWithChops(pattern, rect, instrumentIndex, instrument, slices, random = null, spacing = 1) {
  const n = Math.max(1, slices);
  const step = Math.max(1, Math.floor(spacing));
  for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
    const track = pattern.tracks[t];
    if (!track) continue;
    for (let r = rect.rowStart; r <= rect.rowEnd && r < track.events.length; r++) {
      const offset = r - rect.rowStart;
      const onBeat = offset % step === 0;
      const slice = random ? Math.min(n - 1, Math.floor(random() * n)) : Math.floor(offset / step) % n;
      const note = onBeat ? noteForSlice(instrument.rootNote, slice) : null;
      const event = createEmptyEvent();
      if (note !== null) {
        event.note = note;
        event.instrument = instrumentIndex;
      }
      track.events[r] = event;
    }
  }
}
