# FX: track/master buses and cell automation

How webtracker's FX panel, cell-level automation, and `webdsp`'s bus/DSP-chain engine fit
together. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this assumes you
know the module map and the Song/Event data model.

## What this is

Every track gets its own insert FX chain (filter, delay, reverb, compressor, saturation,
chorus/flanger), and so does the master bus. The signal path is:

```
track voices -> track's own insert bus (FX chain) -> MASTER_BUS (its own FX chain) -> output
```

There's exactly one bus per track plus the master bus — no sends, no aux buses, no routing
matrix. A tracker cell can automate its *own* track's bus only; it can never reach the master
bus.

None of this required an engine change. `webdsp` already shipped `AudioRuntime.createBus()`,
`MASTER_BUS`, and `setNodeParameter(bus, NodeParam, value)` covering all six DSP nodes above —
webtracker just never called any of it before this feature. See
[`ARCHITECTURE.md`'s "FX: track/master buses and cell automation"](ARCHITECTURE.md#fx-trackmaster-buses-and-cell-automation)
section for the short version; this doc is the longer one.

## The parameter catalog (`src/model/fxParams.js`)

`FX_PARAMS` is the single list every FX-parameter-aware UI reads from — the FX panel and the
cell editor both render from it, and nothing else hand-maintains a second copy. Each entry:

```js
{ id: "filter.cutoff", nodeParam: "FilterCutoff", group: "Filter", label: "Cutoff",
  min: 20, max: 20000, default: 20000, step: 1, unit: "Hz" }
```

- `id` is `"<node>.<param>"` — the same shape a cell's automation map uses
  (`{ "filter.cutoff": 1200 }`).
- `nodeParam` is the *name* of a `webdsp` `NodeParam` enum member, not the enum value itself —
  this file deliberately imports nothing from `webdsp` (same rule `model/effects.js` already
  follows: `model/` stays webdsp-free). `src/audio/fx.js` is the only place `nodeParam` gets
  resolved to the real enum value.
- `min`/`max`/`default`/`step`/`unit` are this app's own UI-side musical ranges. `webdsp`'s own
  enum doc comments already give authoritative ranges for Reverb/Compressor/Saturation/
  Chorus-Flanger; Filter/Delay/BusGain aren't range-documented there, so those values are
  reasonable musical defaults, not an engine-mandated scale.

Helpers: `getFxParam(id)`, `getFxParamGroups()` (groups params by node, in declaration order —
what the FX panel renders one module per), `formatFxValue(value, param)` (shared formatting,
same precedent as `model/notes.js`'s `toHex`/`noteNumberToName`).

Currently exposed: Filter (cutoff, resonance), Delay (time, feedback, mix), Reverb (decay,
damping, mix), Compressor (threshold, ratio, attack, release, knee, makeup), Saturation
(drive, asymmetry, output gain, mix), Chorus/Flanger (rate, depth, delay, feedback, stereo
phase, mix), and bus output gain. `FilterMode` (the engine's low-pass/high-pass toggle) is
deliberately left out — every entry here is a plain numeric slider, which keeps cell
automation simple; a discrete on/off mode isn't a great fit for "sparse automation at a cell."

## Bridging to `webdsp` (`src/audio/fx.js`, `src/audio/runtime.js`)

```js
// audio/runtime.js — one bus per track, allocated lazily, exactly once per index
export async function ensureTrackBuses(trackCount) { ... }

// audio/fx.js — the only place NodeParam/MASTER_BUS get imported from webdsp
export async function setTrackFxParam(trackIndex, paramId, value) { ... }
export async function setMasterFxParam(paramId, value) { ... }
```

`ensureTrackBuses` is idempotent/cached the same way `initRuntime()` already is (see
`ARCHITECTURE.md`'s Gotcha #4) — whichever caller asks first, a user dragging an FX slider
before ever pressing Play, or `playbackController.play()` wiring up note routing, wins without
allocating a track's bus twice. Both call sites end up sharing the exact same array.

`audio/compile.js#compileRow` now accepts a `trackBusIds` array and passes each track's bus id
into `compileEvent`, which sets it as the compiled voice's `bus` — this is what actually routes
a track's notes through its own FX chain instead of straight to `MASTER_BUS`. Without this half
of the wiring, the FX panel's sliders would move but change nothing audible.

## The model: where a parameter's "current value" lives

`webdsp` has no getter for `setNodeParameter` — the engine is write-only from the host's side.
So the model keeps its own canonical copy:

- `model/trackChannel.js#fx` — `{ [paramId]: value }`, one per track. The FX panel's TRACK view
  reads/writes this; it's the same mixer-level-persists-across-patterns role `muted`/`solo`/
  `volume` already play on the same object.
- `model/song.js#masterFx` — the same shape, for the master bus. The FX panel's MASTER view.
- `Event.fx` (`model/event.js`) — a cell's own *sparse* automation map, `{ [paramId]: value }`
  or `null`. Only the parameters actually set at that cell are present; everything else is
  untouched. `model/mutations.js#setCellFxParam` is the only way to write to it — it adds,
  updates, or (value `null`) removes one entry, collapsing back to `fx: null` once empty.

Both `trackChannel.fx` and `song.masterFx` are plain, additive fields on objects the project
format already serializes as JSON — no persistence-format changes were needed (see
`persistence/projectFile.js#ensureFxDefaults`, which defaults both on load for a project saved
before this feature existed, same pattern `ensureTrackLengths` already set for per-track
length).

## Playback semantics

```
cell 01: filter.cutoff = 800
cell 02: filter.cutoff = 1200
cell 03: (no cutoff value)
cell 04: filter.cutoff = 2000
```

means the track's cutoff changes at cells 1, 2, and 4; cell 3 leaves it at whatever cell 2 set
(1200) — a cell with no entry for a parameter never resets it.

`audio/compile.js#compileRowFx(pattern, transportStep)` is the pure function behind this: for
every track, fold `transportStep` through that track's own loop length
(`model/pattern.js#trackLocalStep` — the exact same fold `compileRow` and the per-track
playhead already use), look at whatever cell that lands on, and emit one
`{ trackIndex, paramId, value }` per key present in that cell's `fx` map. It's deliberately
**not** gated by mute/solo (unlike note triggers in `compileRow`) — a track's FX automation
keeps latching in even while muted, the same way turning a real mixer knob would.

`audio/lookaheadPlayer.js`'s `tick()` calls `compileRowFx` at the same point it calls
`compileRow` for note scheduling, and reports each change through an `onTrackFxChange`
callback. `audio/playbackController.js` wires that callback to two things every time: the real
engine call (`audio/fx.js#setTrackFxParam`) and, via `appContext.js`, the model update
(`store.setTrackFxParam`) that keeps the FX panel showing the right value live, if it happens
to be open on that track while it's playing.

**Timing caveat**: `setNodeParameter` has no timestamp of its own — unlike `schedule()`'s
sample-accurate `ScheduledEvent.time`, it's just an immediate `postMessage`. Cell FX changes
apply at the same ~25ms tick / 150ms lookahead cadence note scheduling already uses, not
sample-accurately. This is a property of `webdsp`'s current API, not something fixable from
this layer without an engine change — treat it like a live knob turn, not a scored event.

## Using the FX panel

The lower panel under the tracker grid tabs between **MIXER** and **FX**
(`ui/chrome/MixerFxPanel.jsx`). The FX view has its own TRACK/MASTER toggle:

- **TRACK** edits whichever track the grid cursor is currently on — the same notion of
  "current track" `NoteEditor.jsx`'s "TRK n" context line already uses, not a second,
  independent selection. The header names the track so it's unambiguous which bus you're
  shaping.
- **MASTER** edits `MASTER_BUS`, labeled plainly as "MASTER BUS."

Each DSP node (Filter, Delay, Reverb, Compressor, Saturation, Chorus/Flanger, Output) gets its
own module card, grouped from `getFxParamGroups()`.

## Editing cell FX

`ui/chrome/NoteEditor.jsx`'s "CELL FX" section lists whatever parameters the selected cell
already has set, each with its own slider, value readout, and a remove button, plus an "+ ADD
FX" dropdown (only offering parameters not already present on that cell) to add a new entry.
Picking one seeds it at that parameter's default.

## Adding a new FX parameter

If `webdsp` adds a new `NodeParam` (or you want to expose one that already exists but isn't in
the catalog yet):

1. Add one entry to `FX_PARAMS` in `model/fxParams.js` — `id`, `nodeParam` (the enum member's
   *name*, as a string), `group`, `label`, `min`/`max`/`default`/`step`/`unit`.
2. That's it for the FX panel and the cell editor — both already render from `FX_PARAMS`
   generically; nothing else needs to change. `audio/fx.js`'s `NODE_PARAM_BY_ID` map is built
   from `FX_PARAMS` directly, so the new id resolves automatically.
3. If it's genuinely a new node (not a new parameter on an existing one), confirm `webdsp`'s
   `NodeParam` enum actually has it (`node_modules/webdsp/lib/index.d.ts`) before wiring it up —
   this file only bridges ids that already exist on the engine side; it never invents new DSP
   behavior.

## Boundaries (what this deliberately doesn't do)

- **No sends/aux buses/routing matrix.** Only insert FX (per track) and master FX exist. The
  model doesn't hard-code "exactly one bus per track" in a way that would block adding sends
  later — it just isn't built.
- **A tracker cell can never automate the master bus.** `compileRowFx` only ever resolves a
  `trackIndex`; there's no code path from a cell to `MASTER_BUS`.
- **No FX instances per cell.** Cells only ever address parameters on the track's existing
  bus/chain — they never own or instantiate a node.
- **Not wired to tracker FX columns or Push/MIDI yet.** `model/fxParams.js` is written so a
  future grid FX column or `control/contract.js` entry could consume it the same way the FX
  panel does, but neither exists today — see `ARCHITECTURE.md`'s "Explicitly out of scope."
