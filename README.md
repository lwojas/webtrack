# webtracker

A browser-based music tracker built on [`webdsp`](https://github.com/lwojas/webdsp) — plain
JavaScript (no TypeScript), React for the app chrome, hand-rolled DOM rendering for the dense
pattern grid. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it's built,
[`docs/EXTENDING.md`](docs/EXTENDING.md) for how to add to it,
[`docs/FX.md`](docs/FX.md) for the track/master FX buses, [`docs/AUTOMATION.md`](docs/AUTOMATION.md) for cell automation, LFOs and the automation editor, and
[`docs/MIDI.md`](docs/MIDI.md) for MIDI I/O and the Ableton Push Mk1 controller integration, and
[`docs/CHOKE_GROUPS.md`](docs/CHOKE_GROUPS.md) for track choke groups (open/closed hi-hat).

## Quick start

```bash
npm install
npm run dev       # http://localhost:5175
```

Click anywhere on the page once, or press Play — that first gesture is what the browser
requires before any audio can start, and it's also when the two bundled demo samples
(`public/samples/kick.wav`, `hat.wav`) load into instrument slots `00`/`01`. The demo song's
one starting pattern already has a simple kick/hat pattern in it, so Play works immediately.

```bash
npm test           # vitest run — model/audio/control-registry unit tests
npm run test:watch
npm run build       # production build
npm run preview      # serve the production build
```

## Using the tracker

### Tracker / Patterns tabs

Two views, switched with the tabs just under the transport bar:

- **Tracker** — the grid, mixer, instrument panel, and note editor (everything below).
- **Patterns** — the Pattern Manager: a two-column view of every pattern that exists (left) and
  the ordered queue of pattern references the project plays/is organized around (right). Click
  a pattern (in either column) to make it the one the Tracker tab edits. **+ NEW PATTERN**
  creates one and appends it to the end of the queue; **+ QUEUE** on a pool entry appends that
  *same* pattern again (the queue can reference one pattern more than once); **✕** removes one
  queue slot, disabled when the queue has only one slot left — it can never be emptied.

### Transport bar (top)

| Control | Does |
|---|---|
| **Play / Stop** | Also toggleable with `Space` |
| **BPM** | Editable tempo |
| **PATTERN** | Read-only — shows the currently selected pattern's name. Change selection from the Patterns tab |
| **LEN** | The selected pattern's length, 1–8 bars. Resizes the grid; existing notes are preserved when growing, and notes past the new boundary are dropped when shrinking |
| **SAVE** | Downloads the current project (song, instruments + loaded samples, mixer/cursor state) as a single `.json` file |
| **LOAD** | Opens a previously saved project file and restores it in place |
| **RESAMPLE** + steps (4/8/16/32/64) | Captures exactly that many tracker steps of whatever's currently playing into a new instrument slot, synced to the tracker grid — see [`docs/RESAMPLE.md`](docs/RESAMPLE.md) |

> **Unsaved work is recovered automatically.** A debounced local cache (separate from SAVE/LOAD)
> offers to restore your latest edits if you reload or reopen the tab without saving — see
> [`docs/RESAMPLE.md`](docs/RESAMPLE.md#the-local-recovery-cache-persistencerecoveryjs).

> **Switching the selected pattern while playing doesn't cut over immediately.** It shows
> "SWITCH QUEUED" and takes effect at the start of the next loop, not mid-pattern — this is
> intentional (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#loop-boundary-deferred-pattern-switching)).
> While stopped, switching is immediate.

### Mixer / FX (below the grid)

The lower panel tabs between **MIXER** and **FX** (same slot, switched in place).

**Mixer**: a compact horizontal row of per-track channel strips — name, a vertical volume
slider (0–1.5×), `M` (mute), `S` (solo). Soloing any track silences every other non-soloed
track. Scrolls horizontally on narrow viewports rather than wrapping.

**FX**: shapes either the selected track's own insert FX chain or the master bus (a TRACK/
MASTER toggle picks which), across Filter/Delay/Reverb/Compressor/Saturation/Chorus-Flanger/
Output. See [`docs/FX.md`](docs/FX.md) for how this reaches `webdsp`'s actual DSP chain and how
it relates to the note editor's CELL FX automation above.

### The grid — mouse or keyboard

Click a cell to select it; click one of its four fields to select that field specifically —
the selected cell and field both get a clear visual highlight, and the note editor (right
column) always follows whichever cell is currently selected, mouse- or keyboard-selected
alike. Each cell shows four fields, left to right:

| Column | Example | Source | Meaning |
|---|---|---|---|
| **Note** | `C-4` | `Event.note` | Pitch |
| **Ins** | `00` | `Event.instrument` | Which instrument slot plays (index into the panel on the right) |
| **Vol** | `7F` | `Event.velocity` | Per-note velocity/loudness, hex 0–127 (`00`–`7F`) — **not** the mixer's volume slider, which is separate per-track state that persists across pattern switches |
| **Fx** | `-00` | `Event.effectCommand` + `Event.effectParam` | An effect command + its parameter. Editable from the note editor (below); currently cosmetic — stored and displayed, but not wired to any actual sound yet (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#7-eventpan-and-effect-commandparam-arent-wired-to-audio)) |

An empty cell shows `---`/`--`/`--`/`-00`. The vertical legend on the left shows bar.beat
position (`1.1`, `1.2`, ...) rather than a raw row number — labeled on each beat's first row.

| Key | Does |
|---|---|
| `↑ / ↓` | Move cursor by row (wraps within the pattern) |
| `← / →` | Move cursor between note/instrument/velocity fields (wraps into the neighboring track) |
| `Esc` | Toggle edit mode (starts **on**) |
| Piano keys, edit mode on, cursor on **note** field | Write a note at the cursor, auto-advance down by the edit step |
| Piano keys, any other time | Audition the note through the currently-selected instrument — doesn't write anything |
| `0-9`, `a-f`, cursor on **instrument**/**velocity** field | Set that field's hex value, 2 digits (`0` then `5` → `05`) |
| `Backspace` / `Delete` | Clear the whole cell under the cursor |

### Note editor (right column, below instruments)

Shows the properties of whichever note is currently selected that don't fit in the compact
grid: **length** (steps the note holds for — blank/"auto" means hold until the next note),
**pan**, the **effect** command + parameter, and **CELL AUTOMATION** — sparse parameter automation
for the track's bus gain, its FX instances and the instrument slots (see
[`docs/AUTOMATION.md`](docs/AUTOMATION.md)): pick a parameter from the "+ ADD" dropdown to set its
value at this cell; it holds from here until the next cell that sets the same parameter, or ramps to
it with glide. The automation editor draws a whole lane across the track's loop. Shows a placeholder when the selected cell has no note, since editing those
properties on an empty cell is meaningless.

**Piano key layout** (mirrors a keyboard's black/white keys, two octaves):
```
 row 2 (octave+1):  Q  2  W  3  E  R  5  T  6  Y  7  U
 row 1 (octave):    Z  S  X  D  C  V  G  B  H  N  J  M
```

### Instrument panel (right)

Click a slot's hex id to select it — new notes you type get stamped with whichever slot is
currently selected. Click **LOAD** to replace that slot's sample with your own audio file.
**+ ADD SLOT** adds another empty instrument slot. A slot created by RESAMPLE (above) shows a
`· R` badge next to its name.

### Debug

`F3` opens a small performance panel: grid DOM node count, how many cells have been patched,
average frame time, current playhead row, and whether playback is running. It exists to make
the rendering-architecture claims below checkable, not just asserted — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#rendering-architecture) for what it's proving.

## Project status

This is an MVP built against Linear issue ECS-156 (8 tracks, 1–8 bars/pattern), since extended
with project save/load, mouse-driven selection, an explicit per-note length, variable sequence
length, a bar/beat legend, a redesigned horizontal mixer, a Pattern Manager that replaced the
original bank-based pattern storage with an explicit pattern pool + queue (see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#data-model)), per-track polymetric playback
length, per-track/master FX buses with sparse cell-level automation (see
[`docs/FX.md`](docs/FX.md)), MIDI I/O including an Ableton Push Mk1 controller surface (see
[`docs/MIDI.md`](docs/MIDI.md)), and resampling the tracker's own playback into a new
instrument with local (IndexedDB-backed) asset storage and a debounced local recovery cache
(see [`docs/RESAMPLE.md`](docs/RESAMPLE.md)). What's explicitly **not** built yet — mostly by design, with
the seams left open rather than closed off — is listed in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#explicitly-out-of-scope): a Canvas renderer,
send/aux buses, playing the pattern queue in order, tracker FX columns consuming the FX
parameter catalog, undo/redo.

## Running inside the WebVST plugin

webtracker also runs, unmodified, inside the [webvst](https://github.com/lwojas/webvst) VST3 plugin (a WebView loading this
app by URL, with the audio engine native). Nothing here is plugin-specific: the app uses webdsp's host seams, which are
`null` / never fire in a browser, so standalone behaviour is unchanged.

- **Develop as usual** (`npm run dev`). To try it in a DAW, load the plugin and point it at your dev server (`WEBVST_URL` in the
  host's environment; default `http://localhost:5174`). Restart the dev server after changing the `webdsp` dependency.
- What the app does when hosted: follows the DAW transport and tempo (`docs/HOST_SYNC.md`); the DAW's MIDI arrives as an
  ordinary Web MIDI input (`docs/MIDI.md`, "In a plugin host"); the project is saved in the DAW session instead of the local
  recovery slot, and the demo kit never overwrites a restored project (`docs/HOST_STATE.md`); SAVE / LOAD use the host's file
  dialogs, because the plugin's WebView has no file input.
- The plugin's build pipeline, protocol and day-to-day workflow live in webvst's `docs/ARCHITECTURE.md`.

## Repository layout

```
src/
  model/        musical data — Song/Pattern/Track/Row/Event/timing, framework-agnostic
  audio/        webdsp integration — compiling the model into playback
  state/        the pub/sub store both React and vanilla DOM code read from
  input/        keyboard/MIDI → musical events, transport keys
  midi/push/    Ableton Push Mk1 controller surface — see docs/MIDI.md
  ui/grid/      the hand-rolled tracker grid (not React) — mouse + keyboard selection
  ui/chrome/    the React app chrome (transport bar, mixer, instrument panel, note editor, pattern manager)
  ui/debug/     the F3 perf panel
  control/      a small external control-surface contract (not yet consumed by anything)
  debug/        render/mutation instrumentation
  demo/         the bundled demo song
  persistence/  project save/load (explicit versioned format + browser file I/O), local asset
                storage, and the debounced recovery cache — see docs/RESAMPLE.md
public/samples/  the two synthesized demo WAVs
test/            vitest suites for model/, audio/compile.js, control/registry.js, persistence/
```
