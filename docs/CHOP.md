# Chop mode (sample slicing)

A sample instrument can play its sample as slices instead of transposing it. Built on webdsp's
cue regions (webdsp `docs/sample-chop.md`); nothing is cut — the engine plays a span of the same
audio.

## Model

| | Where | Notes |
| --- | --- | --- |
| Cue points | `Instrument.cues` (`model/instrument.js`) | Sorted interior boundaries as fractions 0..1 of the sample; N cues = N+1 contiguous slices (max 49). Fractions survive a reload at another engine sample rate. Reset to `[]` when a new sample is loaded into the slot. |
| Chop start | `Instrument.chopStart` | Fraction 0..1 where slice 1 begins (default 0), to skip leading silence. Always before the first cue (`setInstrumentChopStart` clamps; cues at/before it are dropped). Slices are `[chopStart, ...cues, 1]`; even splits span start..end. Reset to 0 when a new sample is loaded. Drag the start handle in the chop editor, or RESET START. |
| Mode | `Instrument.sampleMode` (`"chromatic"` default, `"chop"`) | Per instrument slot. Older projects lack both fields and load chromatic with no cues, so they play as before. |
| Pitch ratchet | `Event.ratchetPitch` (semitones per hit, null = 0) and `Event.ratchetPattern` (preset id from `RATCHET_PATTERNS`, wins over the step) | Only with a ratchet > 1 (note editor R-PITCH / R-PAT bars). Hit i adds `ratchetPitchOffset(event, i)` to the compiled `pitch`, on top of chop pitch; the slice is unchanged. Also applies to sample and synth slots; MIDI notes are untouched. |
| Pitch | `Instrument.chopPitch` (integer semitones, -24..24, default 0) and `Event.chopTranspose` (per note, null = 0) | Chop mode only. Compile sends `pitch = chopPitch + chopTranspose` next to `region` (omitted when 0). Slices are source-frame spans, so pitch never moves a slice: pitched up it plays faster and ends sooner, pitched down it runs longer but still stops at the slice end. |
| Slice choice | `event.note - instrument.rootNote` | Chop mode: the slot's root note plays slice 1, each semitone up the next (set the root to C-3 for C-3 = slice 1). The note never transposes. A note below the root is skipped; one past the last slice plays nothing. |

The cue maths itself (`addCue`, `moveCue`, `cueRegions`, `computePeaks`, ...) is webdsp's; `model/chop.js` wraps it with webtracker's 49-slice cap and `noteForSlice`. Pure logic: `model/chop.js` (`evenCues`, `addCue`, `moveCue` — never crosses neighbours —
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
* **ROOT** stepper (±1 / ±12 semitones) sets the note that plays slice 1 (`Instrument.rootNote`);
* **PITCH** stepper (±1 / ±12, RESET PITCH) transposes the whole sample; pad auditions use it. A chop note's **PITCH (st)** field in the note editor adds a per-note offset on top;
* a row of **slice pads** shows each slice's number and the note that plays it (`--` and dimmed when
  beyond note 127); tapping a pad auditions that slice independent of the sequence
  (`audio/preview.js#auditionSlice` -> `trigger({ region })` to the master bus; a new pad cuts the
  previous one). Slice labels on the waveform also show the note.

Perf: the editor is React-only and never touches the vanilla grid/playhead modules. The playhead
columns are measured once at mount (width-based), so changing the grid's height does not
invalidate them. The canvas draws on peaks/resize only (no rAF loop); a drag keeps a local draft
and commits once. Nothing in the grid scrolls to follow the playhead, so a short grid can hide the
active row — same as any tall pattern.

The Selection panel's **CHOP TOOLS** (Fill / Randomise with Chops) have a **SPACING** select — 16th, 8th, 1/4, 1/2, 1 bar (1/2/4/8/16 rows, since a row is a 16th). Rows between notes are cleared; slices count up once per note.

Tests: `test/chop.test.js`.
