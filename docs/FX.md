# FX: track/master buses, stacked FX instances, and cell automation

> Cell automation has grown beyond FX (instrument parameters, ramps, scheduling on the audio clock, an
> editor) and is described in [`AUTOMATION.md`](AUTOMATION.md); where this document says cell FX are
> applied at the ~25 ms tick and latched into the model, that now holds only for `bus.gain`. FX
> instances also have LFOs and there is a Utility kind (nine kinds now).

How webtracker's FX panel, cell-level automation, and `webdsp`'s bus/DSP-chain engine fit
together. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this assumes you
know the module map and the Song/Event data model.

## What this is

Every track gets its own insert FX bus, and so does the master bus. The signal path is:

```
track voices -> track's own insert bus (FX chain -> BusGain -> BusPan)
              -> MASTER_BUS (its own FX chain -> BusGain -> BusPan) -> output
```

There's exactly one bus per track plus the master bus — no sends, no aux buses, no routing
matrix. A tracker cell can automate its *own* track's bus only; it can never reach the master
bus.

`webdsp` models each bus's FX as an **ordered chain of independent effect instances**
(`AudioRuntime.addEffect(bus, kind)` returns an `EffectId`; `removeEffect`/`moveEffect`/
`setEffectEnabled`/`setEffectParameter` act on one instance by that id; `getEffectChain(bus)`
snapshots the chain) — not one fixed slot per DSP kind. Any number of instances of the same kind
can coexist on one bus (two Filters, say), each with its own state, parameters, and
enable/disable flag; changing one can never affect another. webtrack's own `fxChain` mirrors
this directly — one entry per instance actually added, rather than choosing *which kind* a bus
uses: an **active FX chain**, per track/master, distinct from the fixed catalog of FX kinds the
DSP merely knows how to provide (`FX_PARAMS`/`FX_TYPES` — eight kinds: filter, delay, reverb,
compressor, saturation, chorus/flanger, phaser, bitcrusher). A track with nothing in its chain
shows an empty FX panel, not a wall of disabled modules — see "The model" below for the
three-layer shape this is built from.

None of this required a webtrack-side engine change beyond re-pulling `webdsp`'s own FX-chain
feature (`AudioRuntime.createBus()`, `MASTER_BUS`, `addEffect`/`removeEffect`/`moveEffect`/
`setEffectEnabled`/`setEffectParameter`/`getEffectChain`, all already shipped engine-side — see
`node_modules/webdsp`'s own `docs/fx-chain.md`). `audio/fx.js` is the one place webtrack calls
any of it. See
[`ARCHITECTURE.md`'s "FX: track/master buses, stacked FX instances, and cell automation"](ARCHITECTURE.md#fx-trackmaster-buses-stacked-fx-instances-and-cell-automation)
section for the short version; this doc is the longer one.

Two parameters are bus-level, not chain members, and never go through any of the above:
**BusGain** (`bus.gain`, the FX panel's pinned Output module) and **BusPan** (a track's pan
slider in `ui/chrome/Mixer.jsx`'s channel strip; the master's own pan, next to its Bus Gain in
the same Output module) — both still plain `setNodeParameter(bus, NodeParam.BusGain/BusPan,
value)` calls (`audio/fx.js#setTrackFxParam`/`setMasterFxParam` for gain,
`setTrackPan`/`setMasterPan` for pan). See `node_modules/webdsp`'s `docs/panning.md` for the pan
law and how it composes with a *voice's* own per-note pan (`Event.pan`, wired separately in
`audio/compile.js#compileEvent` — unrelated to this doc's bus/chain model).

## The parameter catalog (`src/model/fxParams.js`)

`FX_PARAMS` is the single list every FX-parameter-aware UI reads from — the FX panel and the
cell editor both render from it, and nothing else hand-maintains a second copy. Each entry:

```js
{ id: "filter.cutoff", nodeParam: "FilterCutoff", group: "Filter", label: "Cutoff",
  min: 20, max: 20000, default: 20000, step: 1, unit: "Hz" }
```

- `id` is `"<node>.<param>"` — every per-instance param bag (`trackChannel.fx.instances[id]`,
  `Event.fx.instances[id]`) is keyed by this same string, e.g. `{ "filter.cutoff": 1200 }`, one
  bag per chain *instance* rather than one bag per *type* (see "The model" below).
- `nodeParam` is the *name* of a `webdsp` `NodeParam` enum member, not the enum value itself —
  this file deliberately imports nothing from `webdsp` (same rule `model/effects.js` already
  follows: `model/` stays webdsp-free). `src/audio/fx.js` is the only place `nodeParam` gets
  resolved to the real enum value.
- `min`/`max`/`default`/`step`/`unit` are this app's own UI-side musical ranges. `webdsp`'s own
  enum doc comments already give authoritative ranges for Reverb/Compressor/Saturation/
  Chorus-Flanger; Filter/Delay/BusGain aren't range-documented there, so those values are
  reasonable musical defaults, not an engine-mandated scale.

Each entry also carries a `type` (which `FX_TYPES` entry it belongs to — see below — or `null`
for `bus.gain`, which isn't one of the chain-able kinds) and an optional `cellAutomatable: false`
for the handful of setup/gain-staging params that aren't natural step-automation targets
(`comp.knee`/`comp.makeup`, `sat.asymmetry`/`sat.outputGain`, `chorus.delay`/`chorus.stereoPhase`,
`phaser.stages` — still editable from the FX panel, just left out of the cell editor's "+ ADD
FX" list).

`FX_TYPES` is the catalog of FX kinds a track/master bus can add one or more instances of — one
entry per kind (`filter`, `delay`, `reverb`, `compressor`, `saturation`, `chorus`, `phaser`,
`bitcrusher`), just `{ id, label }`. There's no `bypassValues` map here (unlike before webdsp's
FX chains existed) — bypassing one of these is now a real engine primitive
(`AudioRuntime.setEffectEnabled`, see "Bypass" below), not a "push this node's neutral value"
trick, and a freshly-added instance is inert on its own anyway (webdsp's own "inert until
parameterized" convention — mix 0 for Delay/Reverb/Saturation/Chorus/Phaser/Bitcrusher, ratio 1
for Compressor, cutoff/resonance at this catalog's own defaults for Filter). `bus.gain` isn't in
`FX_TYPES` — it's the bus's own always-present output stage, not a toggleable/addable effect, so
it's exempt from chain-gating everywhere that's checked.

Helpers: `getFxParam(id)`, `getFxType(id)`, `getFxParamsForType(typeId)` (a kind's own params, in
declaration order — what the FX panel renders one chain instance's sliders from),
`getFxTypeForParam(paramId)`, `getFxInstanceLabel(fxChain, instanceId)` (a human label that
disambiguates stacked instances of the same kind — "Filter #1", "Filter #2" — counting an
entry's position among same-kind siblings already in the chain), `formatFxValue(value, param)`
(shared formatting, same precedent as `model/notes.js`'s `toHex`/`noteNumberToName`).

Glitch (`glitch`, webdsp `EffectKind.Glitch`, webdsp docs/glitch-fx.md) is a ring-buffer performance effect that always
records: `glitch.mix` 0 is an exact bypass and the 0 → >0 edge engages it, using the `glitch.mode` (Repeat loops the last
`glitch.division` of audio, Tape reads the signal back at `glitch.speed`, Gate chops it with `glitch.mix` as the depth) and
division in force at that moment. Mix and speed can be cell-automated or LFO-driven, which is how a repeat or a tape stop is played.

Dub Delay (`dubdelay`, webdsp `EffectKind.DubDelay`) is a tempo-synced delay: `dub.division` is a
step index shown as a note value (`labels` on its catalog entry, rendered by `formatFxValue`), and
the engine derives the actual time from the transport BPM, so it follows tempo changes with no
client work (indices 6..9 are the triplets 1/16T, 1/8T, 1/4T, 1/2T). `dub.tone` is a low-pass inside the feedback loop (repeats darken).

Currently exposed: Filter (cutoff, resonance, mode, slope), Delay (time, feedback, mix), Reverb
(decay, damping, mix), Compressor (threshold, ratio, attack, release, knee, makeup), Saturation
(drive, asymmetry, output gain, mix), Chorus/Flanger (rate, depth, delay, feedback, stereo
phase, mix), Phaser (rate, depth, center, feedback, stages, mix), Bitcrusher (bits, downsample,
mix), Utility (gain), Dub Delay (time as a note division, feedback, tone, mix), and bus output gain. `FilterMode` (the engine's low-pass/high-pass toggle) and
`FilterSlope` (the engine's 12dB/24dB-per-octave toggle) are both `kind: "boolean"` catalog
entries (`model/fxParams.js`), not plain numeric sliders like everything else above — a discrete
on/off choice isn't a great fit for "sparse automation at a cell," so both are `cellAutomatable:
false` (still editable from the FX panel/Push's FX encoders, just left out of the cell editor's
"+ ADD FX" list). `isFxBooleanOn(value, param)` reads a boolean param's current on/off state off
`param.min`/`param.max` rather than assuming a normalized 0/1 — FilterMode's value space really
is 0/1, but FilterSlope's is webdsp's own 12/24, sent straight through unmodified.

## Bridging to `webdsp` (`src/audio/fx.js`, `src/audio/runtime.js`)

```js
// audio/runtime.js — one bus per track, allocated lazily, exactly once per index
export async function ensureTrackBuses(trackCount) { ... }

// audio/fx.js — the only place NodeParam/EffectKind/MASTER_BUS get imported from webdsp

// bus.gain / pan — bus-level, not chain members (plain setNodeParameter calls):
export async function setTrackFxParam(trackIndex, paramId, value) { ... } // bus.gain only
export async function setMasterFxParam(paramId, value) { ... }            // bus.gain only
export async function setTrackPan(trackIndex, pan) { ... }
export async function setMasterPan(pan) { ... }

// Chain instances — one function per addEffect/removeEffect/moveEffect/setEffectEnabled/
// setEffectParameter call, keyed by this session's own instanceId -> webdsp EffectId map
// (never persisted — an EffectId only means anything within the current AudioRuntime session):
export async function addTrackFxInstance(trackIndex, instanceId, type, paramValues) { ... }
export async function removeTrackFxInstance(trackIndex, instanceId) { ... }
export async function setTrackFxInstanceParam(trackIndex, instanceId, paramId, value) { ... }
export async function setTrackFxInstanceEnabled(trackIndex, instanceId, enabled) { ... }
export async function moveTrackFxInstance(trackIndex, instanceId, newIndex) { ... }
// ...and the addMasterFxInstance/removeMasterFxInstance/etc. master-bus equivalents.

// Full rebuild of one bus's engine-side chain from the model — see "Project load" below.
export async function resyncAllFxChains(trackChannels, masterFxChain, masterFx) { ... }
```

`ensureTrackBuses` is idempotent/cached the same way `initRuntime()` already is (see
`ARCHITECTURE.md`'s Gotcha #4) — whichever caller asks first, a user dragging an FX slider
before ever pressing Play, or `playbackController.play()` wiring up note routing, wins without
allocating a track's bus twice. Both call sites end up sharing the exact same array.

### Project load

A bus (a track's own, or `MASTER_BUS`) is never freed or recreated across a project load in
this app — the same bus ids are reused session-to-session, since `webdsp` has no "free a bus"
primitive. Left alone, a freshly loaded project would inherit whatever FX instances a
*previously* loaded project left sitting on that same, reused bus. `resyncAllFxChains` closes
this gap: for every track (plus master), it removes every effect instance the engine currently
holds on that bus (via `getEffectChain`/`removeEffect` — not just the ones this session's own
id map happens to know about) and recreates the model's current `fxChain` fresh, in order, with
its stored parameter values and bypass state. `appContext.js` calls this once, right after a
project loads (`loadProjectFromFile`/`restoreFromRecovery`) — every edit from then on (the FX
panel's add/remove/param/bypass/move controls) keeps the engine in sync incrementally, the same
way they always did.

`audio/compile.js#compileRow` now accepts a `trackBusIds` array and passes each track's bus id
into `compileEvent`, which sets it as the compiled voice's `bus` — this is what actually routes
a track's notes through its own FX chain instead of straight to `MASTER_BUS`. Without this half
of the wiring, the FX panel's sliders would move but change nothing audible.

## The model: a track's FX, in three layers

1. **What the DSP can provide** — `FX_TYPES`/`FX_PARAMS` (above). A fixed catalog of *kinds*, not
   per-track; unaffected by anything a track does.
2. **What's actually been added, and in what order** — `trackChannel.fxChain` /
   `song.masterFxChain`: an **ordered array of instances**, `{ id, type, bypassed }`, one entry
   per instance actually added to this track's (or the master bus's) chain. `id` (allocated from
   a shared `song.nextFxInstanceId` counter — `model/song.js`) is the instance's own stable
   handle, distinct from `type`: two entries can share the same `type` (two independent Filters),
   each with its own id, own stored values (layer 3), own bypass flag, and — once pushed to a
   live runtime — its own `webdsp` `EffectId` (`audio/fx.js`'s own session-local id map, never
   persisted). Array order *is* chain/signal-flow order, mirrored straight into `webdsp`'s
   `addEffect`'s `index`/`moveEffect`. `model/mutations.js#addTrackFx`/`removeTrackFx`/
   `setTrackFxBypass`/`moveTrackFx` (and the `*MasterFx*` equivalents) are the only way to change
   this.
3. **Current parameter values of what's been added** — `trackChannel.fx` / `song.masterFx`: `{
   "bus.gain"?: value, instances: { [instanceId]: { [paramId]: value } } }`. `bus.gain` sits flat
   at the top (it isn't part of any chain, see above); every other param lives in its own
   instance's bag under `instances[id]`, so two instances of the same type each keep independent
   values — changing one can never change the other. `webdsp` has no getter for
   `setEffectParameter`/`setNodeParameter` — the engine is write-only from the host's side — so
   this is the model's own canonical copy of "what value is this instance's parameter at right
   now." The FX panel's TRACK/MASTER views read/write this; cell automation during playback
   latches onto it too (see "Playback semantics" below). Not cleared when an instance is removed
   from `fxChain` (only its own `instances[id]` bag goes with it) — but since ids are never
   reused, a freshly re-added FX of a given type always starts from that type's catalog defaults,
   the same as any other brand-new instance.

`Event.fx` (`model/event.js`) is a fourth, distinct layer — a cell's own *sparse* automation map,
mirroring the same shape: `{ "bus.gain"?: value, instances?: { [instanceId]: { [paramId]: value
} } }` or `null`. Only the parameters actually set at that cell are present; everything else is
untouched. `model/mutations.js#setCellFxParam` (the flat `bus.gain` entry) and
`setCellFxInstanceParam` (everything else) are the only ways to write to it, and the latter now
validates against layer 2: a new entry is refused outright if that `instanceId` isn't in the
track's `fxChain` — not just "this type isn't enabled," since a cell must now unambiguously name
*which* stacked instance it automates. Symmetrically, `removeTrackFx` purges every matching
`Event.fx` entry across every pattern on that track the moment that instance is removed.
Together, these two mean a cell can never reference an instance that doesn't exist — enforced at
the model layer, not as a defensive check threaded through playback.

### Bypass

Each `fxChain` entry's `bypassed` flag mutes that one *instance* without removing it from the
chain or touching its stored values in `fx`/`masterFx` — a temporary "turn this off for now," as
opposed to `removeTrackFx`'s "this track doesn't use this instance" (which also purges cell
automation; bypass doesn't). Unlike before webdsp's FX chains existed, this is now backed by a
real engine primitive — `AudioRuntime.setEffectEnabled(bus, effectId, enabled)` — not a "push
this node's neutral value" trick: `audio/fx.js#setTrackFxInstanceEnabled`/
`setMasterFxInstanceEnabled` is the one place the bypass toggle reaches the engine, and
un-bypassing needs no extra parameter push — the instance already has its last values live
inside the engine (only its *internal* processing state, e.g. a filter's memory or a delay's
buffer, is cleared on disable, for a click-free bypass — see `node_modules/webdsp`'s
`docs/fx-chain.md`). While an instance is bypassed, a parameter write for one of its params —
from the FX panel or from cell automation — only ever updates the model
(`trackChannel.fx.instances[id]`); the live engine call is skipped until it's un-bypassed, so the
"intended" value isn't lost, it's just not audible yet (`audio/fx.js#isFxInstanceBypassed`,
checked by `appContext.js`'s `applyTrackFxInstanceParam`/`applyMasterFxInstanceParam` and by
`audio/playbackController.js`'s cell-automation wiring).

All of `trackChannel.fx`/`fxChain` and `song.masterFx`/`masterFxChain` are plain, additive
fields on objects the project format already serializes as JSON — no persistence-format version
bump was needed (see `persistence/projectFile.js#ensureFxDefaults`/`ensureFxChains`, which
default them on load for a project saved before this feature existed at all, same pattern
`ensureTrackLengths` already set for per-track length). A pre-`fxChain` project has no way to
say "this FX is enabled," so the migration derives it the same way it always did: any `FX_TYPES`
id with a non-default value already sitting in `fx`/`masterFx`, or referenced by a cell's
`Event.fx` anywhere in the song, is unioned into that track's/master's `fxChain`. A second
migration pass, `ensureFxInstanceIds`, then handles the newer `fxChain`-without-ids shape
specifically: since a pre-stacking project could only ever have *one* instance of each type to
begin with, assigning each existing chain entry a fresh id and moving its type's flat param
values into that id's own bag is lossless and mechanical — the project sounds and edits
identically to how it did before stacking existed.

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
`{ trackIndex, instanceId, paramId, value }` per key present in that cell's `fx` map —
`instanceId` is `null` for the flat `bus.gain` entry, and the real chain-instance id for
everything under `fx.instances`. It's deliberately **not** gated by mute/solo (unlike note
triggers in `compileRow`) — a track's FX automation keeps latching in even while muted, the same
way turning a real mixer knob would.

`audio/lookaheadPlayer.js`'s `tick()` calls `compileRowFx` at the same point it calls
`compileRow` for note scheduling, and reports each change through an `onTrackFxChange`
callback. `audio/playbackController.js` wires that callback to two things every time: the real
engine call (`audio/fx.js#setTrackFxParam` when `instanceId === null`, else
`setTrackFxInstanceParam`) and, via `appContext.js`, the model update
(`store.setTrackFxParam`/`setTrackFxInstanceParam`) that keeps the FX panel showing the right
value live, if it happens to be open on that track while it's playing.

**Superseded for FX instances and instruments** (see `AUTOMATION.md`): they are scheduled on the audio
clock with webdsp's `scheduleParams` and never written into the model while playing. What follows
still describes `bus.gain`.

**Timing caveat**: `setNodeParameter`/`setEffectParameter` have no timestamp of their own —
unlike `schedule()`'s sample-accurate `ScheduledEvent.time`, they're just an immediate
`postMessage`. Cell FX changes apply at the same ~25ms tick / 150ms lookahead cadence note
scheduling already uses, not sample-accurately. This is a property of `webdsp`'s current API,
not something fixable from this layer without an engine change — treat it like a live knob
turn, not a scored event.

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

- A pinned **Output** module for `bus.gain` and pan — always present, no remove/bypass controls
  (neither is a chain-able effect — see "The parameter catalog" above and
  `model/trackChannel.js#pan`'s own doc comment).
- One module per `fxChain` *instance*, in chain order, each titled with `getFxInstanceLabel`
  ("Filter #1", "Filter #2" — never just "Filter" twice over, even when two instances of the
  same kind are stacked), with ▲/▼ move buttons (`fxController.moveTrackFx`/`moveMasterFx`,
  clamped at either end), a bypass toggle, and a remove button in its header, and sliders
  underneath for just that instance's own params (`getFxParamsForType`, reading/writing
  `fx.instances[entry.id]`).
- A **"+ ADD FX"** dropdown listing every `FX_TYPES` kind, always — picking one adds a *new*
  instance regardless of whether the track already has one of that kind (unlike before stacking
  existed, this is never disabled/filtered down to "not already present").
- Nothing else — a track/master with no FX enabled shows only Output and the add control, not a
  wall of disabled module cards.

## Editing cell FX

`ui/chrome/NoteEditor.jsx`'s "CELL FX" section lists whatever parameters the selected cell
already has set, each labeled with its owning instance (`getFxInstanceLabel` again, e.g. "Filter
#2 — Cutoff") when it's a chain param, or just "Bus Gain" for the flat entry — each with its own
slider, value readout, and a remove button, plus an "+ ADD FX" dropdown to add a new entry. That
dropdown is scoped twice over: only (instance, param) pairs for instances actually in the
current track's `fxChain`, and only params marked `cellAutomatable` on top (not every param of
an added instance is a good automation target — see "The parameter catalog"). `bus.gain` is
always offered, chain or no chain. Picking one seeds it at that specific instance's current
value (`trackChannel.fx.instances[id]`), the same value already playing, not the catalog default
— a newly-added cell entry is a continuation of "whatever's already there," never a jump back to
a neutral baseline. Trying to add automation for an instance the track doesn't have isn't
possible from this dropdown in the first place, and `model/mutations.js#setCellFxInstanceParam`
refuses it anyway even if called directly.

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
3. If it's genuinely a new kind (not a new parameter on an existing one), confirm `webdsp`'s
   `NodeParam`/`EffectKind` enums actually have it (`node_modules/webdsp/lib/index.d.ts`) before
   wiring it up — this file only bridges ids that already exist on the engine side; it never
   invents new DSP behavior. Add a matching `FX_TYPES` entry too (`{ id, label }` — no
   `bypassValues` needed, see "Bypass" above) and an `EFFECT_KIND_BY_TYPE` mapping in
   `audio/fx.js`, so it can be added/removed/bypassed the same way the existing eight are.

## Boundaries (what this deliberately doesn't do)

- **No sends/aux buses/routing matrix.** Only insert FX (per track) and master FX exist. The
  model doesn't hard-code "exactly one bus per track" in a way that would block adding sends
  later — it just isn't built.
- **A tracker cell can never automate the master bus.** `compileRowFx` only ever resolves a
  `trackIndex`; there's no code path from a cell to `MASTER_BUS`.
- **No per-instance dry/wet beyond each effect's own mix; no cross-bus sends or sidechain; no
  crossfade on `moveEffect`.** All limitations of `webdsp`'s own FX-chain primitive
  (`node_modules/webdsp`'s `docs/fx-chain.md`, "Limitations"), not something webtrack works
  around — e.g. reordering a filter mid-stream can click, the same way it would on hardware.
- **Up to `MAX_EFFECTS_PER_BUS` (16) instances per bus** — `webdsp`'s own ceiling; the FX panel
  doesn't currently show a friendly message if `addEffect` throws past it (a 17th "+ ADD FX" on
  one bus is an edge case no one has hit in practice yet, not a deliberately-built limit).
- **Push's encoder FX mode (`midi/push/encoderController.js`) pages through `fxChain` by
  instance, one instance's params per page — stacking just means more pages to turn through,
  not a UI gap.** Tracker grid FX columns are still not wired to anything (`model/fxParams.js`
  is written so a future grid column or `control/contract.js` entry could consume it the same
  way the FX panel and Push already do, but neither exists today — see `ARCHITECTURE.md`'s
  "Explicitly out of scope"). The bypass flag is a plain boolean per instance id, the same shape
  `trackChannel.muted`/`solo` already have — deliberately easy to wire into `contract.js` later,
  even though this plan doesn't add an entry for it yet.
