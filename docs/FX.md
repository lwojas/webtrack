# FX: track/master buses and cell automation

How webtracker's FX panel, cell-level automation, and `webdsp`'s bus/DSP-chain engine fit
together. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this assumes you
know the module map and the Song/Event data model.

## What this is

Every track gets its own insert FX bus, and so does the master bus. The signal path is:

```
track voices -> track's own insert bus (FX chain) -> MASTER_BUS (its own FX chain) -> output
```

There's exactly one bus per track plus the master bus — no sends, no aux buses, no routing
matrix. A tracker cell can automate its *own* track's bus only; it can never reach the master
bus.

webdsp's DSP nodes (filter, delay, reverb, compressor, saturation, chorus/flanger) are always
present on every bus at the engine level — there's no real "instantiate an FX" primitive. What
webtrack adds on top is the notion of a track (or the master bus) *choosing* which of those six
to actually use: an **active FX chain**, per track/master, distinct from the catalog of FX the
DSP merely knows how to provide. A track with nothing in its chain shows an empty FX panel, not
six disabled modules — see "The model" below for the three-layer shape this is built from.

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

Each entry also carries a `type` (which `FX_TYPES` entry it belongs to — see below — or `null`
for `bus.gain`, which isn't one of the six toggleable nodes) and an optional `cellAutomatable:
false` for the handful of setup/gain-staging params that aren't natural step-automation targets
(`comp.knee`/`comp.makeup`, `sat.asymmetry`/`sat.outputGain`, `chorus.delay`/`chorus.stereoPhase`
— still editable from the FX panel, just left out of the cell editor's "+ ADD FX" list).

`FX_TYPES` is the catalog of FX a track/master bus can actually enable or disable — one entry
per toggleable node (`filter`, `delay`, `reverb`, `compressor`, `saturation`, `chorus`), each
with a `bypassValues` map: that node's own documented "neutral"/no-op value (`mix: 0` for
Delay/Reverb/Saturation/Chorus, `ratio: 1` for Compressor, `cutoff: 20000`/`resonance: 0.707` for
Filter — webdsp's own `NodeParam` doc comments call these out as each node's bypass convention,
and they're also each param's `default` above). `bus.gain` isn't in `FX_TYPES` — it's the bus's
own always-present output stage, not a toggleable effect, so it's exempt from chain-gating
everywhere that's checked.

Helpers: `getFxParam(id)`, `getFxType(id)`, `getFxParamsForType(typeId)` (a type's own params, in
declaration order — what the FX panel renders one enabled chain module's sliders from),
`getFxTypeForParam(paramId)`, `formatFxValue(value, param)` (shared formatting, same precedent as
`model/notes.js`'s `toHex`/`noteNumberToName`).

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

## The model: a track's FX, in three layers

1. **What the DSP can provide** — `FX_TYPES`/`FX_PARAMS` (above). A fixed catalog, not
   per-track; unaffected by anything a track does.
2. **What's actually enabled** — `trackChannel.fxChain` / `song.masterFxChain`: an ordered array
   of `{ type, bypassed }`, one entry per `FX_TYPES` id this track (or the master bus) currently
   has turned on. This is the new concept: before it existed, every FX was implicitly "present"
   everywhere, just resting at its own neutral value if the user never touched it — there was no
   way to tell "unused" apart from "deliberately bypassed," and the FX panel/cell editor had no
   way to show only what a track actually uses. `model/mutations.js#addTrackFx`/`removeTrackFx`/
   `setTrackFxBypass` (and the `*MasterFx*` equivalents) are the only way to change this.
3. **Current parameter values of what's enabled** — `trackChannel.fx` / `song.masterFx`, `{
   [paramId]: value }`, same shape as before this feature existed. `webdsp` has no getter for
   `setNodeParameter` — the engine is write-only from the host's side — so this is the model's
   own canonical copy of "what value is this bus's parameter at right now." The FX panel's
   TRACK/MASTER views read/write this; cell automation during playback latches onto it too (see
   "Playback semantics" below). Not cleared when an FX is removed from `fxChain` — the values
   just sit there unused, so re-enabling the same FX later picks back up where it left off
   instead of resetting to defaults.

`Event.fx` (`model/event.js`) is a fourth, distinct layer — a cell's own *sparse* automation
map, `{ [paramId]: value }` or `null`. Only the parameters actually set at that cell are
present; everything else is untouched. `model/mutations.js#setCellFxParam` is the only way to
write to it, and it now validates against layer 2: a new entry is refused outright if that
param's FX type isn't in the track's `fxChain` (`bus.gain`, which has no type, is exempt — it's
always on). Symmetrically, `removeTrackFx` purges every matching `Event.fx` entry across every
pattern on that track the moment an FX is disabled. Together, these two mean a cell can never
reference an FX the track doesn't have enabled — enforced at the model layer, not as a
defensive check threaded through playback.

### Bypass

Each `fxChain` entry's `bypassed` flag mutes that one FX without removing it from the chain or
touching its stored values in `fx`/`masterFx` — a temporary "turn this off for now," as opposed
to `removeTrackFx`'s "this track doesn't use this FX" (which also purges cell automation; bypass
doesn't). Since `webdsp` has no generic per-node bypass primitive, bypassing one works by pushing
that `FX_TYPES` entry's `bypassValues` to the engine instead of the stored values, and
un-bypassing re-pushes whatever's currently stored — `audio/fx.js#setTrackFxTypeState`/
`setMasterFxTypeState` is the one place both chain add/remove and the bypass toggle reach the
engine. While a type is bypassed (or simply not enabled), a parameter write for one of its
params — from the FX panel or from cell automation — only ever updates the model
(`trackChannel.fx`); the live engine call is skipped until it's un-bypassed, so the "intended"
value isn't lost, it's just not audible yet (`audio/fx.js#isFxBypassed`, checked by
`appContext.js`'s `applyTrackFxParam`/`applyMasterFxParam` and by
`audio/playbackController.js`'s cell-automation wiring).

All of `trackChannel.fx`/`fxChain` and `song.masterFx`/`masterFxChain` are plain, additive
fields on objects the project format already serializes as JSON — no persistence-format changes
were needed (see `persistence/projectFile.js#ensureFxDefaults`/`ensureFxChains`, which default
them on load for a project saved before this feature existed, same pattern `ensureTrackLengths`
already set for per-track length. A pre-`fxChain` project has no way to say "this FX is
enabled," so the migration derives it: any `FX_TYPES` id with a non-default value already
sitting in `fx`/`masterFx`, or referenced by a cell's `Event.fx` anywhere in the song, is
unioned into that track's/master's `fxChain` — the project sounds and edits identically to how
it did before `fxChain` existed, just with its already-in-use FX now showing as enabled instead
of invisibly present).

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

Both targets render the same chain-based view (`ui/chrome/FxPanel.jsx`), not a dump of every
`FX_PARAMS` entry:

- A pinned **Output** module for `bus.gain` — always present, no remove/bypass controls (it
  isn't a toggleable FX — see "The parameter catalog" above).
- One module per `fxChain` entry actually enabled on this target, each with a bypass toggle and
  a remove button in its header, and sliders underneath for just that type's own params
  (`getFxParamsForType`).
- A **"+ ADD FX"** dropdown listing whichever `FX_TYPES` aren't already enabled.
- Nothing else — a track/master with no FX enabled shows only Output and the add control, not
  six disabled module cards.

## Editing cell FX

`ui/chrome/NoteEditor.jsx`'s "CELL FX" section lists whatever parameters the selected cell
already has set, each with its own slider, value readout, and a remove button, plus an "+ ADD
FX" dropdown to add a new entry. That dropdown is scoped twice over: only params belonging to an
FX the current track actually has enabled (`fxChain`), and only those marked `cellAutomatable`
(not every param of an enabled FX is a good automation target — see "The parameter catalog").
`bus.gain` is always offered, chain or no chain. Picking one seeds it at that parameter's
current value (`trackChannel.fx`), the same value already playing, not the catalog default — a
newly-added cell entry is a continuation of "whatever's already there," never a jump back to a
neutral baseline. Trying to add automation for an FX the track doesn't have enabled isn't
possible from this dropdown in the first place, and `model/mutations.js#setCellFxParam` refuses
it anyway even if called directly.

## Adding a new FX parameter

If `webdsp` adds a new `NodeParam` (or you want to expose one that already exists but isn't in
the catalog yet):

1. Add one entry to `FX_PARAMS` in `model/fxParams.js` — `id`, `nodeParam` (the enum member's
   *name*, as a string), `type` (an existing `FX_TYPES` id, or `null` if this is a bus.gain-like
   always-on control), `group`, `label`, `min`/`max`/`default`/`step`/`unit`, and
   `cellAutomatable: false` if it's a setup/gain-staging param rather than a step-automation
   target.
2. That's it for the FX panel and the cell editor — both already render from `FX_PARAMS`/
   `getFxParamsForType` generically; nothing else needs to change. `audio/fx.js`'s
   `NODE_PARAM_BY_ID` map is built from `FX_PARAMS` directly, so the new id resolves
   automatically.
3. If it's genuinely a new node (not a new parameter on an existing one), confirm `webdsp`'s
   `NodeParam` enum actually has it (`node_modules/webdsp/lib/index.d.ts`) before wiring it up —
   this file only bridges ids that already exist on the engine side; it never invents new DSP
   behavior. Add a matching `FX_TYPES` entry too, with that node's own documented neutral/bypass
   value(s) as `bypassValues`, so it can be enabled/disabled/bypassed the same way the existing
   six are.

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
  panel does, but neither exists today — see `ARCHITECTURE.md`'s "Explicitly out of scope." The
  bypass flag in particular is a plain boolean per `(track, type)`, the same shape
  `trackChannel.muted`/`solo` already have — deliberately easy to wire into `contract.js` later,
  even though this plan doesn't add an entry for it yet.
