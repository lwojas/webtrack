# Chop mode (sample slicing)

A sample instrument can play its sample as slices instead of transposing it. Built on webdsp's
cue regions (webdsp `docs/sample-chop.md`); nothing is cut — the engine plays a span of the same
audio.

## Model

| | Where | Notes |
| --- | --- | --- |
| Cue points | `Instrument.cues` (`model/instrument.js`) | Sorted interior boundaries as fractions 0..1 of the sample; N cues = N+1 contiguous slices (max 49). Fractions survive a reload at another engine sample rate. Reset to `[]` when a new sample is loaded into the slot. |
| Mode | `Instrument.sampleMode` (`"chromatic"` default, `"chop"`) | Per instrument slot. Older projects lack both fields and load chromatic with no cues, so they play as before. |
| Slice choice | `event.note - instrument.rootNote` | Chop mode: the slot's root note plays slice 1, each semitone up the next (set the root to C-3 for C-3 = slice 1). The note never transposes. A note below the root is skipped; one past the last slice plays nothing. |

Pure logic: `model/chop.js` (`evenCues`, `addCue`, `moveCue` — never crosses neighbours —
`removeCue`, `cueRegions`). Store: `setInstrumentSampleMode`, `setInstrumentCues`,
`setChopEditorOpen` (the open flag is session-only, not saved).

## Audio path

* `audio/compile.js`: a chop slot's event gets `region = note - rootNote` and no `pitch`;
  chromatic slots are unchanged. `lookaheadPlayer` forwards the field to `runtime.schedule`.
* `audio/instrumentRegions.js`: converts cues to frame regions (using the loaded sample's length)
  and calls `runtime.setSampleRegions`. Pushed on every cue edit, when a sample loads into a slot,
  and after a project load / recovery restore (the engine keeps nothing across sessions).

## UI

Instrument panel (sample output): **PITCH: CHROMATIC | CHOP**; in CHOP an **EDIT CHOPS** button
opens `ui/chrome/ChopEditor.jsx` in the tracker column *under the grid* (same flex column, so the
grid host shrinks and scrolls — it is not an overlay). It closes with CLOSE, by leaving CHOP mode,
or when the selected instrument is not a chop sample.

* tap the waveform to add a cue; drag a cue to move it (committed on release); arrow keys nudge a
  focused cue, Delete removes it; REMOVE CUE / CLEAR; 2/4/8/16/32 even splits;
* slices are numbered to match the notes that play them.

Perf: the editor is React-only and never touches the vanilla grid/playhead modules. The playhead
columns are measured once at mount (width-based), so changing the grid's height does not
invalidate them. The canvas draws on peaks/resize only (no rAF loop); a drag keeps a local draft
and commits once. Nothing in the grid scrolls to follow the playhead, so a short grid can hide the
active row — same as any tall pattern.

Tests: `test/chop.test.js`.
