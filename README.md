# webtracker

A browser-based music tracker built on [`webdsp`](https://github.com/lwojas/webdsp) — plain
JavaScript (no TypeScript), React for the app chrome, hand-rolled DOM rendering for the dense
pattern grid. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it's built,
[`docs/EXTENDING.md`](docs/EXTENDING.md) for how to add to it,
[`docs/FX.md`](docs/FX.md) for the track/master FX buses and cell automation, and
[`docs/MIDI.md`](docs/MIDI.md) for MIDI I/O and the Ableton Push Mk1 controller integration.

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
**pan**, the **effect** command + parameter, and **CELL FX** — sparse FX automation (see
[`docs/FX.md`](docs/FX.md)): pick a parameter from the "+ ADD FX" dropdown to set its value at
this cell; it holds from here until the next cell that sets the same parameter, or the end of
playback. Shows a placeholder when the selected cell has no note, since editing those
properties on an empty cell is meaningless.

**Piano key layout** (mirrors a keyboard's black/white keys, two octaves):
```
 row 2 (octave+1):  Q  2  W  3  E  R  5  T  6  Y  7  U
 row 1 (octave):    Z  S  X  D  C  V  G  B  H  N  J  M
```

### Instrument panel (right)

Click a slot's hex id to select it — new notes you type get stamped with whichever slot is
currently selected. Click **LOAD** to replace that slot's sample with your own audio file.
**+ ADD SLOT** adds another empty instrument slot.

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
[`docs/FX.md`](docs/FX.md)), and MIDI I/O including an Ableton Push Mk1 controller surface (see
[`docs/MIDI.md`](docs/MIDI.md)). What's explicitly **not** built yet — mostly by design, with
the seams left open rather than closed off — is listed in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#explicitly-out-of-scope): a Canvas renderer,
send/aux buses, playing the pattern queue in order, tracker FX columns consuming the FX
parameter catalog, undo/redo.

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
  persistence/  project save/load — explicit versioned format + browser file I/O
public/samples/  the two synthesized demo WAVs
test/            vitest suites for model/, audio/compile.js, control/registry.js, persistence/
```
