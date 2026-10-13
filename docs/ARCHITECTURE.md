# webtracker — architecture

This is a browser tracker built on [`webdsp`](https://github.com/lwojas/webdsp) (a standalone
audio engine — see its own `ARCHITECTURE.md` for how sampling/voices/scheduling work on that
side). The brief that shaped this repo (Linear ECS-156) asked for two things at once: a real
playable MVP, and a rendering-performance experiment — can a dense, continuously-updating
tracker UI stay fast on plain DOM if the architecture deliberately separates the musical
model, the renderer, and the audio scheduler? Most of the design decisions below exist to
answer that question, not just to ship a feature.

```
Musical model (src/model/)
      |
      +-- UI / tracker renderer (src/ui/)
      |
      +-- audio scheduler (src/audio/)
```

Nothing in `model/` imports `audio/`, `ui/`, or `state/`. Nothing in `audio/` imports `ui/` or
`state/`. The musical model doesn't know a renderer or an audio engine exists; the renderer
and the audio scheduler each only know about the model.

## Core concepts

### 1. Hybrid rendering: React chrome, vanilla DOM grid

React renders the app's chrome — `TransportBar`, `TrackHeaders`, `InstrumentPanel`,
`PerfPanel` — ordinary stateful forms-and-buttons UI where React's component model earns its
keep. The 64×8 pattern grid is **not** a React tree. It's built once with `createElement`
(`src/ui/grid/gridView.js`), and React never re-renders into it after the initial mount.

The boundary is one component, `src/ui/grid/TrackerGridHost.jsx`: it renders a single
container `<div>` with a ref, and in a `useEffect` with an empty dependency array, mounts the
vanilla `gridView`/`playheadLayer`/`cursorLayer` modules into that container exactly once.
From then on, all grid cell content, the playhead, and the cursor are owned entirely by those
vanilla modules, driven by `state/store.js`'s pub/sub — never by React props or state.

**Why**: the grid's own requirements (dense fixed layout, a high-frequency playhead driven by
an external audio clock, minimal DOM churn per edit) are exactly the cases where React's
reconciler gets in the way rather than helping. Even `webseq` — a sibling tracker that *is*
built in React+TypeScript — has to step outside React for its own playhead (raw `useRef` DOM
mutation in an animation-frame loop). This project takes that same escape hatch for the whole
grid subtree, not just the playhead, while keeping React for everything that benefits from it.

### 2. One store, two kinds of subscriber

`src/state/store.js` is a small pub/sub over the `Song` plus UI/session state (cursor, octave,
edit step, playing flag, selected instrument). It is **not** a general framework —
just an event emitter over a fixed set of named events (`src/state/events.js`).

- The vanilla grid modules subscribe directly: `store.subscribe(EVENT_NAME, handler)`.
- React chrome components read the same store through `src/state/useStore.js`, a thin wrapper
  around React 18's `useSyncExternalStore` — the built-in hook for exactly this "external
  store" shape.

There's one source of truth. Nothing is duplicated between "React state" and "the real
state" — there's only the store.

### 3. Direct, in-place model mutation

`src/model/mutations.js` mutates the `Song` object tree in place — `event.note = 60`, not
"replace the array this event lived in." There's no undo/history requirement for this MVP, so
copy-on-write/immutable updates would be pure overhead. This choice has a real consequence for
how React reads the store — see [Gotcha #1](#1-usesyncexternalstore--in-place-mutation) below.

### 4. The lookahead scheduler pattern

Audio timing never comes from a JS timer. `webdsp`'s `AudioRuntime.getCurrentTime()` (the
render thread's own clock) is the single source of truth for both scheduling and the UI
playhead. `src/audio/lookaheadPlayer.js` runs a `setInterval` purely to decide *when to top up*
the schedule a little further into the future — the same "lookahead scheduler" shape
`webdsp`'s own `src/sequencing/lookaheadPlayer.ts` demonstrates, reimplemented here against
this app's Song/Pattern model instead of webdsp's generic example shape.

## Module map

| Directory | Owns | Imports from |
|---|---|---|
| `src/model/` | Song/Pattern/Track/Row/Event — plain factory functions and mutators, no classes | nothing else in `src/` |
| `src/audio/` | Compiling the model to `webdsp` calls, the lookahead player, sample loading, transport | `model/`, `webdsp` |
| `src/state/` | The pub/sub store, event names, the React bridge hook | `model/` (for mutation helpers) |
| `src/input/` | Keyboard → musical note events, transport keys, cursor/hex-digit editing | `model/`, `audio/preview.js`, `state/` (via the store it's given) |
| `src/ui/grid/` | The vanilla-DOM grid, playhead, cursor, cell formatting, the React mount boundary | `model/`, `state/` |
| `src/ui/chrome/` | React chrome components | `state/`, `audio/` (instrument loading) |
| `src/ui/debug/` | The F3 perf panel | `state/` (indirectly, via props) |
| `src/control/` | A small external control-surface contract/registry — unused by the app itself | `state/`, `audio/` |
| `src/debug/` | Render/mutation instrumentation | nothing (pure counters) |
| `src/demo/` | The bundled demo song/instruments | `model/` |
| `src/persistence/` | Project save/load — explicit versioned format (`projectFile.js`) plus browser file I/O (`projectIO.js`) | `model/` (`createInstrumentSlot`) |
| `src/appContext.js` | **The composition root** — the only file that wires `state/`, `audio/`, and `input/` together | all of the above |

`src/appContext.js` is deliberately the one place that breaks the "layers don't know about
each other" rule — something has to wire a store's getters into a playback controller's
callbacks, and that's its entire job. If you're ever unsure where new cross-cutting wiring
belongs, it almost certainly belongs here, not inside `model/`, `audio/`, or `state/` itself.

## Data model

```
Song { bpm, swing, trackCount, rowCount, trackChannels: TrackChannel[8],
       patterns: Pattern[], patternQueue: PatternId[], selectedPatternId: PatternId, nextPatternId }
Pattern { id, name, rowCount, tracks: PatternTrack[8] }        // rowCount is per-pattern — 1-8 bars, see model/timing.js
PatternTrack { events: Event[rowCount], length }   // length is the track's own playback loop length — defaults to rowCount, see §8
Event { note, instrument, velocity, pan, effectCommand, effectParam, length }   // all nullable; empty = all null
TrackChannel { index, name, muted, solo, volume }   // mixer-level — persists across pattern switches
Instrument { id, name, sampleId, gain, rootNote, sampleAsset }   // not part of Song — lives in store.instruments
```

`Song.patterns` is a pool of patterns, unique by `id`. `Song.patternQueue` is an ordered list
of pattern ids — a queue of *references*, not unique occurrences, so the same pattern id can
appear in it more than once (see `ui/chrome/PatternManager.jsx`, `model/mutations.js`'s
`addPattern`/`appendPatternToQueue`/`removeFromPatternQueue`). `Song.selectedPatternId` is
which pattern the Tracker tab currently edits/displays — explicit project state, not UI/session
state, since a reopened project should restore it. The queue can never be empty;
`removeFromPatternQueue` refuses a removal that would leave it with zero slots.

Three things worth noting:

- **`TrackChannel` (mute/solo/volume) is separate from `PatternTrack` (the note events).**
  Mute/solo/volume are mixer-level state that should survive switching patterns on the same
  track; the events themselves are per-pattern. `Song.trackChannels` is indexed in parallel
  with every pattern's `tracks` array by track index.
- **`Instrument` is not part of `Song`.** Instrument slots (and the samples loaded into them)
  are store-level (`store.instruments`), not musical data — an `Event.instrument` is just an
  index into that array. This keeps instrument/sample assignment independent of which pattern
  you're looking at. `Instrument.gain` is model state like every other field here, but it also
  has a live counterpart inside the current `AudioRuntime` session (`webdsp`'s
  `SampleParam.Gain`, keyed by `sampleId`) — see "Instrument/track gain staging" below for how
  the two stay in sync.
- **There is no `Bank` abstraction.** An earlier version of this model put patterns under
  `Bank { patterns: Pattern[], activePatternIndex }`, which conflated pattern identity,
  sequencing, and selection with an unrelated "which instrument/track set" concept — one that
  was never actually implemented (`trackChannels` above were already global, shared by every
  pattern). The Pattern Manager (`ui/chrome/PatternManager.jsx`) replaced it with the
  pool/queue/selectedPatternId shape above. If bank-scoped instrument sets are added later,
  they belong on `trackChannels`/`instruments`, not on pattern storage.

`Event.note` is a numeric MIDI-style value (`60` = `C-4`), not a display string — `model/notes.js`
is the only place that converts to/from `"C-4"`-style text. This matters for MIDI readiness:
a future MIDI input source can emit the exact same shape the keyboard source does, with no
translation layer.

`Event.length` (steps) is `null` by default — meaning "hold until the next note on this track,
or 1 step if there isn't one," the original MVP behavior. An explicit value overrides that scan
— see `audio/compile.js#noteDurationSteps()`. Edited via `ui/chrome/NoteEditor.jsx`, not the
grid (see "Rendering architecture" below for why that split exists).

`Instrument.sampleAsset` (`{ buffer, mimeType, fileName } | null`) holds the raw bytes behind
`sampleId` — unlike `sampleId`, which is only a handle into the *current* `AudioRuntime`
session, these bytes are what `src/persistence/projectFile.js` actually embeds on save. See
"Project persistence" below.

## Key functions / entry points

| Function | File | What it does |
|---|---|---|
| `createSong()` | `model/song.js` | Builds a fresh `Song` with the MVP defaults (8 tracks, 64 rows) and one starting pattern, already queued and selected |
| `setEventField()` / `clearEvent()` | `model/mutations.js` | The only functions that write into a pattern's events |
| `compileEvent()` / `compileRow()` | `audio/compile.js` | Pure: `Event` + `TrackChannel` + `Instrument[]` → `webdsp` `ScheduledEvent` (or `null`). No `webdsp` calls — testable with plain assertions |
| `createLookaheadPlayer()` | `audio/lookaheadPlayer.js` | Drives playback: ticks every 25ms, schedules ~150ms ahead, derives the playhead row purely from `getCurrentTime()` |
| `createPlaybackController()` | `audio/playbackController.js` | The `play()`/`stop()`/`switchPattern()` surface `state/` and `ui/` actually call |
| `createStore()` | `state/store.js` | The pub/sub store — every mutation goes through one of its methods |
| `createGridView()` | `ui/grid/gridView.js` | Builds the grid once; `patchCell()` is the **only** write path for cell content |
| `createPlayheadLayer()` / `createCursorLayer()` | `ui/grid/playheadLayer.js` / `cursorLayer.js` | The two `transform`-driven overlay layers |
| `createEditController()` | `input/editController.js` | Cursor navigation, hex digit entry, clear, and note-entry-while-editing |
| `createAppContext()` | `appContext.js` | Builds and wires one instance of everything — call once per app mount |

## Rendering architecture

- **The grid is built exactly once**, at mount (`gridView.mount()`): one row `<div>` per row,
  8 track cells per row, 4 `<span>`s per cell (note/ins/vol/fx). Every cell's DOM refs are
  cached in a 2D array at build time.
- **`patchCell(trackIndex, rowIndex, event)` is the single write path for all cell content.**
  A single edit calls it once. A pattern switch calls it 512 times (once per cell) — this
  is a repaint via the same function, not a rebuild: zero node allocation after mount.
- **The playhead and cursor are each one absolutely-positioned `<div>`**, moved via
  `transform`, never one DOM node per row. The playhead's `requestAnimationFrame` loop only
  writes when the row actually changes — an idle player costs one comparison per frame, not a
  DOM write.
- **Geometry comes from the real rendered DOM** (`rowEl.offsetTop`/`offsetHeight`,
  `cellEl.offsetLeft`/`offsetWidth`), not a duplicated CSS constant in JS — CSS stays the one
  place that defines row height and column width.
- **The F3 perf panel is the acceptance check** for all of the above: it shows the DOM node
  count (computed once, cached), a running cell-patch counter, and average frame time, all fed
  from the same two call sites (`patchCell`, `playheadLayer`'s rAF loop) that do the actual
  work — not a separate estimate. A dev-only `MutationObserver`
  (`debug/renderStats.js#attachMutationCrossCheck`) cross-checks the real DOM mutation count
  against the self-reported `patchCell` count, so a future change that bypasses `patchCell`
  (e.g. someone reaching for `innerHTML`) gets flagged in the console rather than silently
  regressing.

## Audio / timing architecture

1. `playbackController.play()` lazily initializes `AudioRuntime` (`audio/runtime.js`, inside
   the click/keydown handler that called it — a user gesture is required) and starts a
   `LookaheadPlayer`.
2. The player's `tick()` (every 25ms) compiles and schedules any row whose time falls within
   ~150ms of `runtime.getCurrentTime()`. It's `compileRow()` (`audio/compile.js`) that turns
   one pattern row into `webdsp` `ScheduledEvent`s — mute/solo gating and gain (velocity ×
   track volume) happen here, at compile time, not via a `webdsp` bus. Instrument gain is
   deliberately *not* folded into that compile-time number — it's pushed straight to `webdsp`'s
   own per-sample gain stage (`SampleParam.Gain`) instead, applied once at the sample level
   rather than recomputed into every triggered event. See "Instrument/track gain staging"
   below.
3. The **UI playhead never touches the scheduler.** `playheadLayer.js` runs its own rAF loop
   reading `lookaheadPlayer.getPlayheadRow()`, itself purely `floor((getCurrentTime() -
   startTime) / stepDuration) % rowCount`. A slow render thread only degrades the playhead's
   redraw rate — never audio timing.
4. **Note length**: a row's note holds until the next non-empty note on the same track (or a
   1-step default if none follows) — computed at compile time into `TriggerParams.duration`,
   so `webdsp`'s render-thread auto-release handles it. There's never a second timed
   `release()` call.
5. **Pitch**: `Event.note` isn't itself a pitch — `compileEvent()` subtracts the instrument's
   `rootNote` (default 60/`C-4`) to get a semitone offset, passed as `webdsp`'s `pitch`
   parameter. Without this, the note column would be cosmetic.
6. **Swing** (`Song.swing`, 0–100, set via the transport bar's SWING field) is a pure
   scheduling-time adjustment, never a second clock and never a change to logical position.
   `lookaheadPlayer.js#tick()` computes the step's logical time (`stepCounter * duration`,
   exactly as before swing existed — this is what `rowIndex`, `patternRelativeStep`, and the
   playhead all still read) and only adds a delay on top of that, via
   `model/timing.js#swingDelaySeconds()`, to get the time actually passed to `compileRow`/
   `runtime.schedule()`. The delay only ever applies to odd-indexed shared transport steps (the
   "off" half of each on/off pair) and maxes out at a third of a step at `swing: 100` — the
   same 2:1/triplet ratio hardware (MPC) and software (Ableton, FL Studio) swing use — so
   even-indexed (downbeat) steps, and therefore overall beat duration/BPM, are never shifted.
   Because the parity check is on the raw, never-reset `stepCounter` rather than a
   pattern/track-relative position, the swing phase can't drift or reset at a pattern boundary
   or a track's own polymetric wrap. This also leaves a clean seam for a future MIDI output
   path: whatever emits MIDI events off the same scheduler would read the same swung time this
   does, rather than needing its own swing math.

### Loop-boundary-deferred pattern switching

Switching the selected pattern **while playing** doesn't take effect immediately.
`lookaheadPlayer.requestPatternSwitch()` stores the new pattern as *pending*; `tick()` only
swaps it in the moment `rowIndex` wraps back to `0` (a loop boundary) — so a switch issued
mid-pattern finishes the current loop first. `playbackController` reports this via
`onPatternSwitchPending`, which the store surfaces as `patternSwitchPending` (shown as "SWITCH
QUEUED" in the transport bar). While **stopped**, there's nothing to defer — `switchPattern()`
is a no-op and the next `play()` reads the newly selected pattern fresh.

The **edit view** (what the grid displays) is not deferred — selecting a pattern (from the
Pattern Manager, or anything else calling `store.selectPattern()`) repaints the grid
immediately via `PATTERN_SELECTED`, independent of whatever is currently playing. This is
deliberate: you can look at and edit pattern B while pattern A keeps playing until its loop
finishes. Playback itself still loops a single pattern — the queue (`Song.patternQueue`) is
sequencing/editing state only; nothing currently walks it during playback (see "Explicitly out
of scope" below).

## Project persistence (`src/persistence/`)

An explicit, versioned project format (`PROJECT_FORMAT_VERSION` in `projectFile.js`) rather
than a dump of arbitrary application state — `serializeProject()`/`deserializeProject()` are
pure and DOM-free (unit-tested in `test/projectFile.test.js`); `projectIO.js` is the only part
that touches browser APIs (`Blob`/anchor-click download, `File` reading), kept separate so the
format logic stays testable without a browser.

The one real design decision here: **loaded samples are embedded as base64 bytes in the
project JSON, not referenced by object URL or file path.** `URL.createObjectURL()` addresses
only survive the current page session — persisting one as a sample's "address" would silently
break on reload, which is exactly the failure mode this format was built to avoid. Each
instrument keeps a copy of its sample's raw bytes on `sampleAsset` (set alongside `sampleId`
whenever a sample loads — see `ui/chrome/InstrumentPanel.jsx` and
`appContext.js#loadDemoInstrument`, both of which clone the `ArrayBuffer` before handing the
original to `loadSample()`, since that call may transfer/detach it). `sampleId` itself is
**not** persisted — it's only a handle into the current `AudioRuntime` session; load re-feeds
the saved bytes through `loadSample()` to get a fresh one, exactly as `docs/EXTENDING.md`'s
original persistence recipe anticipated.

Loading a project replaces `state.song`/`state.instruments` wholesale
(`state/store.js#loadProject()`) rather than merging into the existing ones, then re-emits the
same granular events (`PATTERN_QUEUE_CHANGED`, `PATTERN_SELECTED`, `TRACK_CHANNEL_CHANGED`,
`INSTRUMENTS_CHANGED`, etc.) normal interaction already produces — every existing subscriber
(the grid, the mixer, the instrument panel, the note editor, the Pattern Manager) refreshes
correctly with no project-load-specific wiring anywhere else, including the grid's own
rowCount-mismatch rebuild (see Gotcha #8).

A project saved under the pre-Pattern-Manager format (`formatVersion: 1`, `Song.banks` instead
of `Song.patterns`/`patternQueue`) is migrated on load, not rejected —
`projectFile.js#migrateSongV1ToV2()` flattens every bank's patterns into one pool/queue, in
bank order, and selects whichever pattern was active in the previously active bank. No pattern
data is lost; only the bank-shaped addressing is.

## External control contract (`src/control/`)

A small, fully-specified table of control/action ids (`src/control/contract.js`) built from
two generic factories (`createControl`/`createAction`) instead of one hand-written function
per id. **Nothing in this app consumes it yet** — it exists as a clean, internally-consistent
seam for a future external controller (e.g. a `midi-core`-based adapter) to read/write
transport state, pattern selection, and per-track mute/solo/volume, without the tracker
itself ever importing anything MIDI-specific. See
[`docs/EXTENDING.md`](EXTENDING.md#adding-to-the-external-control-contract) for how to add to
it, and [Gotcha #5](#5-the-control-contract-is-deliberately-small) for why it's this small.

## Instrument/track gain staging

Three distinct level controls exist today, each owned at a different layer, deliberately kept
separate rather than collapsed into one "volume" concept:

- **Instrument/sample gain** (`Instrument.gain`, edited via `ui/chrome/InstrumentPanel.jsx`'s
  instrument editor) — a signal/input stage, pushed to `webdsp`'s own persistent per-sample
  gain (`SampleParam.Gain`) via `audio/instrumentGain.js#setInstrumentGain()` whenever it
  changes (the editor) or a sample loads into a slot (`appContext.js#applyInstrumentSample`,
  `#loadProjectFromFile`). Applied by the engine itself, upstream of a voice's own filter and
  of the bus/track chain — see `webdsp`'s `ARCHITECTURE.md`, "Gain staging". This replaced an
  earlier compile-time multiply (`audio/compile.js` used to fold `instrument.gain` into every
  triggered event's `gain` alongside velocity/track volume) — now that `webdsp` has a real
  primitive for it, folding it in at compile time too would double-count it, so `compileRow()`
  no longer reads `instrument.gain` at all.
- **Track gain** — `webdsp`'s `NodeParam.BusGain`, a track bus's own output stage (applied
  after that track's FX chain, before summing into the mix). This already existed and was
  already wired in — see "FX: track/master buses..." below, where it shows up as the FX
  panel's pinned **Output** module (`bus.gain`). No separate "track gain" control needed
  adding: `NodeParam.BusGain` *is* the track-gain primitive the architecture calls for, reused
  rather than duplicated.
- **Track mixer volume** (`TrackChannel.volume`, `ui/chrome/Mixer.jsx`) — the pre-existing
  compile-time multiplier (`audio/compile.js`'s `gain = (velocity/127) * trackChannel.volume`),
  unchanged by any of this. Kept conceptually separate from track gain above: one is a musical
  mixer control the model/compile step owns, the other is a real DSP-stage parameter the
  engine owns: two different layers, not two names for the same knob.

Not part of this: **per-cell volume** (a future per-event level, mapping naturally to MIDI
velocity later) stays entirely a tracker/event-level concern — `webdsp`'s `TriggerParams.gain`/
`VoiceParam.Gain` already exists for exactly this and is left free for it; nothing above
assumes event-level gain must be represented as instrument or track gain.

## FX: track/master buses, active FX chains, and cell automation

Every track gets its own insert FX bus plus a master bus, via `webdsp`'s existing bus
architecture (`MASTER_BUS`, `AudioRuntime.createBus()`, `setNodeParameter`) — no engine change
needed, it was simply never wired into webtracker before (see the "Explicitly out of scope"
entry this replaced). `webdsp`'s six DSP nodes (filter/delay/reverb/compressor/saturation/
chorus-flanger) are always present on every bus at the engine level; webtrack adds its own
application-level concept of an **active FX chain** per track/master on top (`fxChain` —
which of those six a track/the master bus actually uses right now, each individually
bypassable), distinct from the fixed catalog of what the DSP merely knows how to provide
(`FX_PARAMS`/`FX_TYPES`). A tracker cell can hold sparse FX automation (`Event.fx`) that
latches onto its own track's bus during playback, never the master bus, and only for a
parameter whose FX is actually enabled on that track. See [`docs/FX.md`](FX.md) for the full
design: the parameter/type catalogs (`model/fxParams.js`), the `webdsp`-bridging module
(`audio/fx.js`), the `fxChain`/`fx`/`masterFxChain`/`masterFx`/`Event.fx` data model and its
bypass mechanics, playback semantics, the FX panel, and a known timing caveat
(`setNodeParameter` has no timestamp, unlike `schedule()`).

## Gotchas

These are things that either actually broke during development, or will reliably confuse
whoever touches this code next if they're not written down.

### 1. `useSyncExternalStore` + in-place mutation

`useSyncExternalStore` decides whether to re-render by comparing the previous and next
snapshot with `Object.is`. Because `model/mutations.js` mutates objects **in place**, a
selector like `(s) => s.song.trackChannels[trackIndex]` returns the *same object reference*
before and after a mutation — React sees no change and skips the re-render, even though the
store did change and `onStoreChange` fired.

This genuinely happened: `TrackHeaders.jsx`'s mute/solo buttons silently stopped updating
until this was traced down. **The fix: select primitive fields, not container objects.**

```js
// Wrong — the trackChannel object's reference never changes:
const channel = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[i]);

// Right — primitives compare correctly by value:
const muted = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[i].muted);
```

Numbers/booleans/strings are fine as selectors (that's why `TransportBar.jsx`'s `bpm`/`playing`
selectors never had this problem). Any selector that would return a mutable object — a
`TrackChannel`, an `Instrument`, an `Event` — needs to be split into one `useStore` call per
primitive field instead. See `TrackHeaders.jsx` and `InstrumentPanel.jsx` for the pattern.

### 2. Absolutely-positioned overlay elements need an explicit `top`/`left`

`playheadLayer.js` and `cursorLayer.js` each create a `position: absolute` element and move it
purely via `transform`. Without an explicit `top: 0` (and `left: 0` for the cursor, which
moves on both axes), `top`/`left` default to `auto` — which for an absolutely-positioned
element resolves to wherever it *would have* sat in normal document flow. Since both elements
are appended as the **last** children of the grid container (after all 64 row `<div>`s), their
static-flow position is right below the last row. The `transform` was animating correctly —
just from the wrong starting point, so the playhead appeared to float below the table.

If you add another `transform`-positioned overlay to the grid, set `top`/`left` explicitly on
mount.

### 3. Vite dev-server pre-bundling breaks `webdsp`'s worklet URL

`webdsp/worklet-url`'s `defaultWorkletUrl` resolves via `new URL('./engine-processor.js',
import.meta.url)` — correct once bundled, but broken under `vite dev` specifically, because
Vite's dependency pre-bundling (`optimizeDeps`) copies `webdsp`'s modules into
`node_modules/.vite/deps/` before serving them, and the relative URL then resolves against
that copied location instead of the real package directory. `vite.config.js` excludes
`webdsp`, `webdsp/worklet-url`, and `webdsp/sequencing` from `optimizeDeps` to prevent this —
**don't remove that exclusion**, or `AudioRuntime.create()` starts throwing "Unable to load a
worklet's module" in dev only (production builds are unaffected). This is documented in
`webdsp`'s own `ARCHITECTURE.md` and confirmed independently by `webseq`, a sibling project on
the same dependency.

### 4. Audio needs a user gesture — twice, sort of

`AudioRuntime.create()` + `resume()` must run inside a user gesture handler (browser autoplay
policy). `audio/runtime.js#initRuntime()` is idempotent and cached, so it's safe to call from
multiple places (`playbackController.play()`, `appContext.js#ensureDemoInstrumentsLoaded()`).
But loading the demo kit is a *separate* async step (fetch + decode two WAV files) layered on
top of `initRuntime()` — `App.jsx` awaits `ensureDemoInstrumentsLoaded()` before calling
`play()` specifically to avoid a race where playback starts before the demo samples have
finished loading and the first note or two gets silently dropped (an empty `Instrument.sampleId`
compiles to `null` in `compile.js`). If you add more eager-loaded content, route it through the
same `ensureDemoInstrumentsLoaded()`-style cached-promise pattern rather than firing it
unguarded from multiple call sites.

### 5. The control contract is deliberately small

`src/control/contract.js` intentionally does **not** have per-cell control ids (`step.<row>.<col>`
addressing, the shape `webseq`'s own `src/midi/sequencerContract.ts` uses). That file in
`webseq` grew to 1400+ lines, one hand-written control factory per id, added ticket-by-ticket
over the project's life. Resist the urge to "complete" `webtracker`'s contract by adding
per-cell addressing speculatively — add to it only when a real consumer (an actual device
integration) needs a specific new id, and add it as a table entry (`contract.js`) plus however
many lines `registry.js#buildControl` needs to resolve it, not a new bespoke factory function.

### 6. React StrictMode double-invokes effects in dev

`main.jsx` wraps `<App/>` in `<StrictMode>`. In development, React intentionally mounts
effects, tears them down, and mounts them again once, to help surface missing cleanup. This is
why the F3 perf panel's "cell patches" counter reads `1024` on a fresh page load instead of the
`512` you might expect (two `repaintPattern()` passes, 512 cells each) — not a bug, just
StrictMode doing its job. Production builds (and `npm run build`/`preview`) don't do this.

### 7. `Event.pan` and effect command/param aren't wired to audio

`model/event.js` models `pan`, `effectCommand`, and `effectParam` — editable through
`ui/chrome/NoteEditor.jsx` (the extended note editor below the instrument panel) and
`model/effects.js` has a small effect-command registry — but `compile.js` deliberately doesn't
read `pan` (webdsp has no per-voice pan parameter yet — see its own `ARCHITECTURE.md`,
"Intentionally deferred") and nothing calls `webdsp`'s `setNodeParameter`/`setVoiceParameter`
for any effect command. They're stored, properly editable, and displayed (the grid's fx column
for effectCommand/effectParam; NoteEditor for all three); they just don't yet *do* anything
to the sound. See [`docs/EXTENDING.md`](EXTENDING.md#wiring-up-a-real-effect) for how to close
this gap for one specific effect.

### 8. `Pattern.rowCount` is per-pattern, not a song-wide constant

Each pattern carries its own `rowCount` (1–8 bars, see `model/timing.js`), changed via the
transport bar's LEN control (`store.setSequenceLength()` →
`model/mutations.js#setPatternRowCount()`). `lookaheadPlayer.js` and `compileRow` already read
`pattern.rowCount` fresh every tick/wrap off the live pattern object, so a length change takes
effect immediately, even mid-playback, with no audio-layer changes needed — a mutation, not a
reschedule. `ui/grid/TrackerGridHost.jsx` detects a mismatch between the mounted grid's
trackCount/rowCount and the selected pattern's and rebuilds the grid (full remount, not a
resize-in-place) on `PATTERN_SELECTED`/`PATTERN_LENGTH_CHANGED`. Don't read `Song.rowCount` for
grid sizing — it's only the default handed to newly created patterns.

Each `PatternTrack.events` array is still sized by `setPatternRowCount` together (every track's
`events` array matches the pattern's `rowCount`), but each track's own `length` — its playback
*loop* length — is independent and can be shorter (never longer) than that: this is the
polymetric-track feature. `audio/lookaheadPlayer.js`'s `stepCounter` is the one shared
transport step every track folds into its own `length` via `trackLocalStep()`
(`model/pattern.js`) to get the row it's actually playing right now — the same fold
`audio/compile.js#compileRow` uses for what sounds and `ui/grid/playheadLayer.js` (via
`playbackController.getTrackPlayheadRow()`) uses for what's drawn, so the two can never
disagree. There's still exactly one shared clock; nothing introduces a second one or a
per-track timer. `model/mutations.js#setTrackLength()` is the only mutator — it never touches
`events`, so shortening a track's length and lengthening it back brings the same notes right
back.

## Explicitly out of scope

Left out of this MVP on purpose, with the seam each one would extend noted:

- **MIDI I/O** — `input/noteInputSource.js`'s contract and `Event.note`'s numeric
  representation are both already MIDI-shaped; no `midiInputSource.js` exists.
- **A Canvas renderer** — `gridView.js` exposes a narrow interface
  (`mount()`/`patchCell()`/node-count probe) a future canvas-based implementation of the same
  interface could satisfy without touching `model/`, `audio/`, or anything else.
- **Per-track polymetric playback length/independent playheads** — implemented; see §8 above
  (`model/pattern.js#trackLocalStep`, `model/mutations.js#setTrackLength`,
  `ui/chrome/Mixer.jsx`'s LEN control).
- **Send/aux buses, a routing matrix** — there are only insert FX (one bus per track) and
  master FX (`MASTER_BUS`) — see "FX: track/master buses and cell automation" below. Nothing
  in that model hard-codes "exactly one bus per track" in a way that would block adding sends
  later; it just isn't built.
- **Tracker FX columns and Push/MIDI parameter mappings consuming `model/fxParams.js`** — the
  single parameter-definition registry exists and the FX panel/cell editor already consume it,
  but nothing beyond those two UIs reads it yet (no grid column, no `control/contract.js`
  entries). Mute/solo/volume remain compile-time gain/gating (`audio/compile.js#compileRow`),
  not real buses — only FX (filter/delay/reverb/compressor/saturation/chorus-flanger) routes
  through the new per-track buses.
- **Undo/redo, block selection, copy/paste, velocity curves/automation, sample waveform
  trimming.**

Project persistence, mouse-driven cell/field selection, an explicit per-note length, and
variable (1–8 bar) sequence length — all previously listed here as out of scope — are now
implemented; see `src/persistence/`, `ui/grid/gridView.js`'s `onCellClick`, `Event.length`,
and Gotcha #8 above respectively.
