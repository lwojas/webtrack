# Synthesized instruments (Kick, Snare, Clap, Tom, Hi-Hat)

How webtracker consumes `webdsp`'s synthesized-instrument API (`AudioRuntime.createInstrument`
et al. — Kick, Snare, Clap, Tom, Hi-Hat today) as a third kind of instrument output, alongside
sample playback and MIDI output. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't
— this assumes you know the module map and the Song/Instrument data model.

## What this is

`webdsp` grew a second kind of audio source beyond sample `Voice`s: an `Instrument` — an
opinionated, purpose-built sound machine with its own small control set (see
`node_modules/webdsp`'s `docs/instruments.md`/`docs/kick-instrument.md`/
`docs/percussion-instruments.md`). webtrack exposes this as a third value for
`Instrument.output.type` (`model/instrument.js`), alongside the existing `"sample"` and `"midi"`:

```
output.type === "sample"     → sampleId/rootNote/gain/envelope (existing)
output.type === "midi"       → channel (existing)
output.type === "instrument" → kind ("kick"/"snare"/"clap"/"tom"/"hihat") + instrumentParams + engineInstrumentId
```

Conceptually, per the brief this was built from:

```
webtrack Instrument slot  →  Instrument.output.kind ("kick"/"snare"/"clap"/"tom"/"hihat")
                           →  webdsp AudioRuntime.createInstrument(InstrumentKind.<Kind>)
                           →  webdsp's own DSP for that kind
                           →  audio
```

webtrack never reimplements any synthesized instrument's DSP — it only ever creates/addresses
an opaque `webdsp` `InstrumentId` and pushes the public parameter values `webdsp` itself
advertises. The instrument owns its sound design; webtrack owns selection, state, parameter
editing, sequencing, and persistence — the same split `ARCHITECTURE.md`'s module map already
draws between `model/`/`state/`/`ui/` and `audio/`/`webdsp`.

**Multiple instances.** `webdsp`'s `createInstrument()` returns a distinct `InstrumentId` per
call (up to `MAX_INSTRUMENTS`, 64) — "one instance is one monophonic machine," by design, never
a shared singleton. webtrack doesn't add anything special for this: every instrument slot
already has independent identity (`store.instruments[i]`), so switching any number of slots to
`"instrument"`/`"kick"` — via `+ ADD SLOT` in the Instrument Panel, the same control that
creates a new sample slot — just gives each one its own `webdsp` instance with its own
parameters, exactly like loading a different sample into two different slots already works.
There is no dedicated "add a Kick" workflow; a Kick is an ordinary instrument slot whose output
happens to be `"instrument"`.

## The parameter catalog (`src/model/instrumentParams.js`)

Same shape/conventions as `model/fxParams.js`'s `FX_PARAMS` and `model/envelopeParams.js`'s
`ENVELOPE_PARAMS` — `model/` stays `webdsp`-free (`docs/EXTENDING.md`'s layer map), so this file
hand-mirrors `webdsp`'s own `docs/kick-instrument.md`/`docs/percussion-instruments.md` tables
rather than importing anything:

```js
export const KICK_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 30, max: 120, default: 50, step: 1, unit: "Hz" },
  // ...pitchDrop, pitchDecay, decay, punch, drive
];
export const SNARE_PARAMS = [ /* tune, decay, snap, noise */ ];
export const CLAP_PARAMS = [ /* tune, decay, spread, snap */ ];
export const TOM_PARAMS = [ /* tune, pitchDrop, decay, body, damp */ ];
export const HIHAT_PARAMS = [ /* tune, decay, metal, tone */ ];

export const SYNTH_KINDS = [
  { id: "kick", name: "Kick", category: "drum", params: KICK_PARAMS },
  { id: "snare", name: "Snare", category: "drum", params: SNARE_PARAMS },
  { id: "clap", name: "Clap", category: "drum", params: CLAP_PARAMS },
  { id: "tom", name: "Tom", category: "drum", params: TOM_PARAMS },
  { id: "hihat", name: "Hi-Hat", category: "drum", params: HIHAT_PARAMS },
];

export const SYNTH_PARAMS_BY_KIND = Object.fromEntries(SYNTH_KINDS.map((k) => [k.id, k.params]));
```

`SYNTH_KINDS` mirrors the `{ id, name, category, params }` shape `webdsp`'s own
`runtime.getCapabilities().instruments` reports (`id` is the stable persistence identity, `name`
is display text, `category` is a free string — currently always `"drum"` — reserved for future
filtering/taxonomy, not built yet). It's the **one** table UI code needs to iterate over to list
every synth kind (`ui/chrome/InstrumentPanel.jsx`'s output-type buttons render straight from it)
— not a second, separately-maintained list of instrument names. `SYNTH_PARAMS_BY_KIND` is
derived from it, keyed by the same string `output.kind` the model uses. See "Adding another
synthesized instrument kind" below for the full recipe this table follows.

`getSynthParams(kind)`/`defaultSynthParamValues(kind)`/`formatSynthParamValue(value, param)` are
the same three helpers `fxParams.js`/`envelopeParams.js` already expose for their own catalogs —
nothing instrument-specific invents a fourth pattern.

## The model (`src/model/instrument.js`)

Two fields were added to `createInstrumentSlot()`:

- **`instrumentParams`** (`Record<paramId, number> | null`) — persistent per-instance control
  values, the `"instrument"`-output counterpart to a sample's `envelope`. `null` until a slot is
  first switched to `"instrument"`, at which point it's seeded with that kind's catalog defaults
  (`state/store.js#setInstrumentOutput`) — never left at `null` with a kind selected, so the
  Instrument Editor's sliders always have something to show.
- **`engineInstrumentId`** (`InstrumentId | null`) — this slot's live `webdsp` instrument,
  session-scoped only, exactly like `sampleId` already is: meaningless after a reload, never
  persisted (see "Persistence" below), written by `audio/instrument.js#createSynthInstrument`
  the moment a live instance exists.

`output.kind` (also new, alongside the pre-existing `output.channel`) is a **string**, not
`webdsp`'s numeric `InstrumentKind` enum value — so a saved project stays readable, and correct,
even if `webdsp` renumbers its enum later. `audio/instrument.js` is the only place that string
gets resolved to a real `InstrumentKind`/param-enum value.

A slot's `sampleId`/`rootNote`/`gain`/`envelope`/`sampleAsset` all stay present (just unused)
under `"instrument"` output, the same way they already go unused under `"midi"` — no
special-casing needed to keep a slot's other field values around across a user flipping the
output toggle back and forth (switch SAMPLE → KICK → SAMPLE and the original gain/envelope are
exactly as they were).

## The audio bridge (`src/audio/instrument.js`)

The `audio/` counterpart to `audio/fx.js`'s FX bridging and `audio/instrumentGain.js`'s
sample-gain bridging — the one place `createInstrument`/`removeInstrument`/
`setInstrumentParameter`/`instrumentNoteOn` actually get called:

- `createSynthInstrument(instrument, kind)` — tears down any previous live instance on this slot
  first (switching kind, or a project reload recreating every `"instrument"`-output slot fresh),
  creates a new one, writes its id onto `instrument.engineInstrumentId`, then pushes every one of
  the kind's catalog values (`instrument.instrumentParams`, defaulting whatever isn't set) so it
  sounds like its saved parameters immediately rather than `webdsp`'s own engine defaults.
- `removeSynthInstrument(instrument)` — frees the live instance (the Instrument Editor's output
  toggle switching away from `"instrument"`), so it stops counting against `MAX_INSTRUMENTS`
  once nothing can trigger it anymore.
- `setSynthInstrumentParam(instrument, kind, paramId, value)` — one control at a time, the same
  per-slider granularity `audio/fx.js#setTrackFxInstanceParam` already uses for FX.
- `resyncSynthInstruments(instruments)` — `appContext.js`'s one entry point for recreating every
  `"instrument"`-output slot's live instance after a project load, mirroring
  `audio/fx.js#resyncAllFxChains`'s "the engine has no persistence of its own" reasoning: unlike
  a sample (re-obtained by re-loading its bytes), a synth slot has no bytes to reload — it needs
  a fresh `createInstrument()` call plus its saved `instrumentParams` pushed back.

**Routing: a synth instrument instance renders to `MASTER_BUS` by default, or to one specific
track's own insert bus if the slot's `output.track` names one** (`model/instrument.js`'s own doc
comment) — `ui/chrome/InstrumentPanel.jsx`'s "Output Bus" selector (MASTER or TRK 1..N), shown
only while `output.type === "instrument"`. `audio/instrument.js#resolveSynthBus` resolves it to a
real `BusId` via `audio/runtime.js#ensureTrackBuses`, the exact same helper/shape
`audio/fx.js#resolveBusId` already uses for FX. Routed into a track, the instrument's output
passes through that track's own FX chain (filter/delay/reverb/etc.), `BusPan`, and mute/solo/
volume gating exactly the way a sample voice on that track already does.

`webdsp` bakes an instrument's bus in at `createInstrument()` time and has no way to move it
afterward (unlike an FX chain instance's `moveEffect`), so changing `output.track` — like
changing `output.kind` — means tearing down and recreating the live instance;
`createSynthInstrument` already does an unconditional teardown-then-create on every call, so a
routing change falls out of the exact same path a kind change already takes, no special-casing
needed. It's a single either/or choice, not a chain of its own: `webdsp` has no bus-of-a-bus
summing (every bus — a track's, or whichever one a synth instrument is routed to — sums straight
into `MASTER_BUS`, never into another non-master bus), so an instrument can be routed into
*one* track's insert bus, not stacked through several. Because `Event.instrument` is a plain
index, not bound to one track, routing is the slot's own explicit, persisted choice rather than
inferred from whichever track happens to trigger it — automatically picking "whichever track
triggered it first" would be an arbitrary, order-dependent choice if more than one track's cells
ever addressed the same slot. This is orthogonal to any instrument kind's own *internal* DSP
(Tom's `damp` low-pass, a future bass synth's own filter as part of its sound design) — that's
`webdsp`'s own synthesis, not a routing concern; `output.track` only decides which bus the kind's
already-finished output sums into next.

## Compiling and scheduling (`audio/compile.js`, `audio/lookaheadPlayer.js`, `audio/preview.js`)

`compileEvent()` gained a third branch (`instrument.output?.type === "instrument"`), producing a
third compiled `kind` alongside the existing `"sample"`/`"midi"`:

```js
{ kind: "instrument", instrumentId: instrument.engineInstrumentId, velocity, pitch, time?, pan? }
```

A few differences from the sample branch are the `webdsp` instrument contract, not a bug:

- **Pitch is derived exactly like the sample branch's.** `webdsp`'s `InstrumentNoteParams.pitch`
  is "semitones on top of the instrument's own `tune`" (`node_modules/webdsp`'s
  `docs/percussion-instruments.md`, "Note pitch") — the identical convention a sample's
  `rootNote`-relative pitch already uses, so `compileEvent()` computes it the same way:
  `pitch = event.note - instrument.rootNote`. `rootNote` defaults to 60 (C-4), so an untouched
  slot playing cells on C-4 compiles `pitch: 0` — the `tune` control's own value, unshifted —
  which is what keeps a project authored before `webdsp` had a pitch field at all (when Kick's
  note value was never read) sounding the same. A Tom is the kind where this matters most: the
  tracker's NOTE column now genuinely transposes it, exactly the way the FX/parameter brief
  asked for ("a Tom should be able to respond naturally to different tracker notes").
- **No duration.** `webdsp` instruments are one-shot/self-ending (`instrumentNoteOff` is only an
  optional early choke) — `durationSeconds` is computed upstream the same way for every branch,
  but simply unused here.
- **`velocity` is `(event.velocity / 127) * trackChannel.volume`, clamped to 0..1** — the exact
  same scalar the sample branch already folds into `gain`, so loudness responds to the track's
  mixer volume the same way a sample does. `instrument.gain` (the sample-only field) is never
  read here, same as it's never read for MIDI output.
- `instrument.engineInstrumentId === null` (no live instance yet) returns `null`, the identical
  "nothing to address yet" gate `instrument.sampleId === null` already uses for the sample
  branch.

`audio/lookaheadPlayer.js#tick()` partitions a compiled row three ways instead of two
(`sampleEvents`/`midiEvents`/`instrumentEvents`) and, for the third, calls `webdsp`'s own
per-note scheduling primitive directly:

```js
runtime.instrumentNoteOn(event.instrumentId, { velocity, time?, pan?, pitch? });
```

There's no `schedule()`-style batch call for instruments, and no voice-handle bookkeeping to
do — `instrumentNoteOn` returns nothing, and a fresh note on the same instance just restarts it
(one instance is one monophonic machine, by `webdsp`'s own design, so there's no equivalent of
`voiceTracker.js`'s per-track voice-limit reservation to wire up here). `audio/preview.js`'s
keyboard-audition path gained the same branch, for the same reason the existing MIDI branch
there returns no handle — just a direct, unscheduled `instrumentNoteOn()` call.

## The Instrument Editor (`ui/chrome/InstrumentPanel.jsx`)

SAMPLE/MIDI plus one button per `SYNTH_KINDS` entry (KICK/SNARE/CLAP/TOM/HI-HAT today), rendered
by mapping over the catalog rather than one hand-written button per kind — reusing the exact
existing output-picker pattern (`fx-panel__target-btn`), not a new control style. While
`output.type === "instrument"`, the editor renders one slider per entry in
`getSynthParams(output.kind)` — the same `fx-module__field` range-input pattern the ADSR
envelope section just above it already uses, each slider committing its own field
(`instrumentController.setInstrumentParam(index, paramId, value)` — merges, doesn't replace,
same as `setEnvelope`). The slider *values* are read with one `useStore` primitive selector per
**unique param id across every kind's catalog** (`tune`, `decay`, `snap`, `noise`, `spread`,
`pitchDrop`, `pitchDecay`, `punch`, `drive`, `body`, `damp`, `metal`, `tone` — `docs/
ARCHITECTURE.md`'s Gotcha #1, the same reason `envelopeValues` is four separate selectors, not
one `instrument.envelope`), not one per kind: only the ids belonging to the current `outputKind`
are ever read by `getSynthParams(outputKind).map(...)`, the rest sit unused. Because the slider
list itself is driven entirely by the catalog, a future kind needs no new JSX for the sliders —
see "Adding another synthesized instrument kind" below.

The Instrument Panel's slot list shows a `· <NAME>` badge (the kind's display name from
`SYNTH_KINDS`, uppercased — e.g. `· HI-HAT`, not the raw `hihat` id) next to a configured synth
slot's name, the same place `· MIDI` and `· R` (resample-origin) badges already live.

## Persistence (`src/persistence/projectFile.js`)

`instrumentParams` is persisted (`serializeInstrument`/`deserializeProject`'s `base` object), the
same additive-field treatment `output`/`origin` already got when *they* were added — a project
saved before this feature existed simply has no `def.instrumentParams`, and
`createInstrumentSlot`'s own `null` default applies on load, same as a brand-new slot. No
`PROJECT_FORMAT_VERSION` bump was needed, same reasoning `docs/EXTENDING.md`'s "Project
save/load" recipe already gives for any purely-additive field.

`engineInstrumentId` is **never** persisted, for the identical reason `sampleId` isn't: it's
only a handle into the *current* `AudioRuntime` session. `appContext.js`'s two project-load paths
(`loadProjectFromFile`, `restoreFromRecovery`) both call `resyncSynthInstruments(instruments)`
right alongside the existing per-sample gain/envelope pushes and `resyncAllFxChains()` call, so
every `"instrument"`-output slot gets a fresh live instance (and its saved params re-pushed)
exactly once per load — the same "the engine has no persistence of its own, every load path
needs one explicit push" rule the rest of this app's `audio/` layer already follows.

## Testing

`test/instrumentParams.test.js` covers every catalog (shape, defaults, formatting) and
`SYNTH_KINDS` itself (stable ids, display names, category) — pure, no `webdsp` import, same as
`test/fxParams.test.js`. `test/compile.test.js`'s `"compileEvent — synthesized instrument
output"` block (including the pitch-from-rootNote conversion and a Tom-specific case) and
`test/lookaheadPlayer.test.js`'s `"synthesized instrument routing"` block (including pitch
passthrough) cover the compile/scheduling branches above, following the exact same
fake-runtime/mock-`compileRow` conventions the pre-existing MIDI-output tests in both files
already use. `test/instrumentOutput.test.js` covers `state/store.js#setInstrumentOutput`'s
kind-reseed behavior (switching an already-`"instrument"` slot from one kind to another reseeds
`instrumentParams` with the *new* kind's defaults, not the old kind's leftover values —
unreachable before a second kind existed). `test/projectFile.test.js` round-trips all four new
kinds by stable `id`. A new instrument kind extending `SYNTH_KINDS` should extend these the same
way, not introduce a parallel testing approach (`docs/EXTENDING.md`'s "Testing" section).

## Adding another synthesized instrument kind

This recipe is exactly how Snare/Clap/Tom/Hi-Hat were added on top of Kick — additive, not a
redesign, and the webtrack side needed no new abstractions to absorb four more kinds:

1. **`webdsp` side first** — pick up whatever `webdsp` release adds `InstrumentKind.<Name>` and
   its own `<Name>Param` enum, plus the `{ id, name, category }` identity on
   `getCapabilities().instruments` (see that repo's own
   `docs/instruments.md#adding-a-new-instrument` for the engine-side recipe).
2. `src/model/instrumentParams.js` — add a `<NAME>_PARAMS` catalog (mirroring that kind's own
   docs table, same shape as `KICK_PARAMS`) and one more entry in `SYNTH_KINDS`
   (`{ id, name, category, params }`); `SYNTH_PARAMS_BY_KIND` is derived from it automatically.
3. `src/audio/instrument.js` — add the kind to `ENGINE_KIND_BY_NAME` and
   `WEBDSP_ENUM_BY_KIND` (the two small lookup tables that resolve a string kind to `webdsp`'s
   real enums). Everything else in that file — creation, removal, param pushes, resync — is
   already generic over `kind`.
4. **UI and persistence need nothing new.** `InstrumentPanel.jsx`'s output-type buttons and
   slider list both render straight from `SYNTH_KINDS`/`getSynthParams(output.kind)` — a new kind
   is one more `SYNTH_KINDS` entry, not a new button or a new code path.
   (`ui/chrome/InstrumentPanel.jsx`'s per-param `useStore` selectors are the one place that does
   need a line per *new param id* — see "The Instrument Editor" above — but no new id was needed
   here since Snare/Clap/Tom/Hi-Hat reuse `tune`/`decay`/`pitchDrop` from Kick's own set plus
   `snap`/`noise`/`spread`/`body`/`damp`/`metal`/`tone`.) `projectFile.js` already round-trips
   `instrumentParams` as an opaque bag — no persistence changes at all.
5. If the new kind is naturally pitched, it already is: `audio/compile.js`'s instrument branch
   reads `event.note`/`instrument.rootNote` unconditionally now (see "Compiling and scheduling"
   above) — every kind gets a `pitch` value, and an unpitched-feeling kind simply means a project
   author leaves cells on the slot's `rootNote`.
6. Extend the tests listed above the same way the Kick ones were extended for these four, rather
   than writing a parallel suite.

## What this doesn't do

- **No routing into more than one bus at once.** A synth instrument renders to exactly one bus
  (MASTER_BUS or one chosen track's insert bus — see "Routing" above); `webdsp` has no send/aux
  concept to split it across several.
- **No polyphony per slot.** One `webdsp` instance is one monophonic machine, by `webdsp`'s own
  design; webtrack doesn't layer a second voice-allocation policy on top. Two overlapping hits of
  the same kind need two separate instrument slots, exactly like `webdsp`'s own docs recommend
  for any overlapping part.
- **No instrument-kind-specific sequencing.** The tracker triggers a synth instrument through the
  exact same note/event mechanism as sample and MIDI instruments — there is no kind-specific
  pattern/step concept anywhere in `model/` or `audio/`.
- **No instrument browser filtering/search/taxonomy UI.** `SYNTH_KINDS`' `category` field
  (currently always `"drum"`) exists so a future filtering UI has something to read, but no such
  UI is built — every kind still shows up as a flat row of buttons.
- **No MIDI/Push parameter mapping for `instrumentParams` yet** — `model/fxParams.js`'s entries
  are wired to Push's encoder FX mode (`midi/push/encoderController.js`); none of the
  `*_PARAMS` catalogs here are, the same "exists as a catalog, not yet consumed by every possible
  surface" gap `docs/ARCHITECTURE.md`'s "Explicitly out of scope" section already notes for
  `FX_PARAMS` itself.
