# Extending webtracker

Practical recipes for common changes, plus the maintenance habits that keep this codebase from
drifting into the kind of organically-grown complexity `docs/ARCHITECTURE.md`'s gotchas warn
about. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this doc assumes you
know the module map and the gotchas.

## Before you start: which layer does this belong in?

```
model/   — musical data and pure mutation. No DOM, no webdsp, no React.
audio/   — webdsp integration. No DOM, no React, no state/ import.
state/   — the store. No webdsp, no DOM rendering.
input/   — keyboard/MIDI → store mutations. No DOM rendering.
ui/grid/ — vanilla DOM, driven by state/. No React (except the one TrackerGridHost.jsx boundary).
ui/chrome/ — React, driven by state/useStore. No direct DOM manipulation.
appContext.js — the only file allowed to import across all of the above to wire them together.
```

If your change needs two of these layers to know about each other, the wiring goes in
`appContext.js`, not by having one layer reach into another directly. This is the rule that
keeps `audio/compile.js` testable with plain `vitest` assertions and `model/` reusable if the
rendering approach ever changes.

## Recipes

### Adding a field to `Event`

1. Add the field (nullable, default `null`) to `createEmptyEvent()` in `model/event.js`
   (and to `isEmptyEvent()`'s check).
2. Decide where it's edited: a **high-frequency** field that earns a grid column goes through
   `ui/grid/rowFormatting.js#formatCell()` plus keyboard entry (see point 4); a
   **low-frequency** one (like `length`/`pan`/`effectCommand`/`effectParam` today) goes in
   `ui/chrome/NoteEditor.jsx` instead — don't add a fifth grid-cell column by default, see
   `docs/ARCHITECTURE.md`'s rendering-architecture section for why the grid stays compact.
3. If it needs to affect playback, read it in `audio/compile.js#compileEvent()`.
4. If it needs keyboard editing in the grid itself, decide whether it fits the existing cursor
   field cycle (`CURSOR_FIELDS` in `state/store.js`) or needs its own input handling in
   `input/editController.js`. It's always mouse-selectable regardless (see
   `ui/grid/gridView.js`'s `data-field` tagging), even if keyboard entry for it isn't wired.
5. Add/extend a `test/compile.test.js` case if it affects what gets scheduled, and a
   `test/projectFile.test.js` case if it needs special handling on save/load (most fields
   don't — `Song` serializes as plain JSON).

### Wiring up a real effect

Right now `Event.effectCommand`/`effectParam` are stored and displayed but inert (Gotcha #7 in
`ARCHITECTURE.md`). To make one real, e.g. a volume fade:

1. In `audio/compile.js#compileEvent()`, after resolving `instrument` and before returning,
   check `event.effectCommand` and adjust the compiled `ScheduledEvent` accordingly (e.g. scale
   `gain` based on `effectParam`), or — for something that needs to ride webdsp's own DSP chain
   (filter, reverb, delay, etc.) — call `runtime.setNodeParameter(bus, NodeParam.X, value)` from
   somewhere that actually has a `runtime` reference. `compileEvent()` itself is pure and has no
   runtime access by design, so a stateful effect (one that persists beyond a single
   `ScheduledEvent`, like a filter sweep) belongs in `audio/playbackController.js` or a new
   small module alongside it, not inside `compile.js`.
2. Update `model/effects.js#applyEffect()` from a no-op into whatever that specific command
   actually does, or replace it with a small per-command dispatch table if you add more than
   one or two real effects.
3. `webdsp`'s existing `NodeParam`/`VoiceParam` enums (filter, delay, reverb, compressor,
   saturation, chorus/flanger) are usable today with **zero `webdsp` engine changes** — see its
   `ARCHITECTURE.md`, "Adding a new master-bus module." You only need a `webdsp` change if
   you're adding an algorithm that doesn't exist there yet.

### Adding a new React chrome component

Follow `TrackHeaders.jsx`/`InstrumentPanel.jsx`'s shape:

```jsx
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";

function MyPanel({ store }) {
  // Select PRIMITIVES, not mutable objects — see ARCHITECTURE.md Gotcha #1.
  const someFlag = useStore(store, events.SOME_EVENT, (s) => s.someBooleanField);

  return <div>{someFlag ? "on" : "off"}</div>;
}
```

- If it needs a new piece of store state, add it to `state/store.js`'s `state` object and
  write a mutator function that mutates `state` and calls `emitter.emit(EVENT, payload)` — add
  a new event name to `state/events.js` only if none of the existing ones fit; reusing
  `CURSOR_MOVED` for "misc editor session state changed" is an established pattern here (see
  `toggleEditMode`/`setEditStep`/`setOctave`/`selectInstrument` in `store.js`), not something
  to avoid by default.
- Wire the component into `App.jsx`'s render tree. If it needs `playbackController` or
  `renderStats`, thread them through as props the same way `TransportBar`/`TrackerGridHost` do.
- **Never** let a chrome component touch grid DOM directly — if it needs to affect the grid,
  it should call a `store` mutator and let `TrackerGridHost.jsx`'s existing subscriptions
  handle the repaint.

### Adding a new vanilla grid overlay (like the playhead/cursor)

Follow `ui/grid/playheadLayer.js`/`cursorLayer.js`'s shape: a factory function returning
`{ mount(containerEl), unmount() }`, created and torn down inside
`TrackerGridHost.jsx`'s effect alongside the existing layers. **Set `top`/`left` explicitly on
mount** if you're using `transform` for positioning — see Gotcha #2 in `ARCHITECTURE.md`; it's
an easy one to repeat.

### Changing track/row/bank counts

`model/song.js#createSong({ bpm, trackCount, rowCount, bankCount })` takes these as options
with MVP defaults (8/64/4). Nothing in `model/`, `audio/`, or `ui/grid/` hardcodes those
numbers — they're all read from the `Song`/`Pattern` objects at runtime (`song.trackCount`,
`pattern.rowCount`, `song.banks.length`). Changing the defaults, or exposing a UI to configure
them per-song, shouldn't require touching more than `demo/demoSong.js` (if you want the demo
song itself to look different) and possibly `src/control/contract.js`'s track-control
generation loop (`TRACK_COUNT`, `ROW_COUNT`, `BANK_COUNT` constants) if the control contract
needs to stay in sync with a non-default song shape.

`pattern.rowCount` specifically already has a live UI path — the transport bar's LEN control
→ `store.setSequenceLength(bars)` → `model/mutations.js#setPatternRowCount()`, bounded to
`model/timing.js#MAX_BARS` (8). Extending that bound, or exposing `trackCount`/`bankCount`
the same way, follows the same shape: a mutation that resizes the live `Song`/`Pattern` in
place, a store method that calls it and emits an event, a UI control that calls the store
method — see `docs/ARCHITECTURE.md`'s Gotcha #8 for why no audio-layer change is needed when
`rowCount` changes.

### Adding MIDI input

The seam is `input/noteInputSource.js`'s contract: `{ onNoteOn(fn), onNoteOff(fn),
emitNoteOn(payload), emitNoteOff(payload) }` where `payload = { note, velocity }`, numeric
MIDI-style values matching `Event.note` exactly.

1. Write `input/midiInputSource.js` implementing the same contract shape as
   `keyboardNoteMap.js` (it can literally call `createNoteInputSource()` from
   `noteInputSource.js` and just wire the Web MIDI API's `onmidimessage` into
   `emitNoteOn`/`emitNoteOff` instead of `keydown`/`keyup`).
2. In `appContext.js`, create it alongside `noteSource` and pass it to a **second**
   `createEditController({ store, noteSource: midiSource })`, or extend `editController.js` to
   accept multiple sources — either works; `editController.js` doesn't currently assume
   there's only one source, it just takes whatever `noteSource` it's given.
3. No changes needed in `model/`, `audio/`, or `ui/` — this is the whole point of the contract.

### Adding to the external control contract

`src/control/contract.js`'s `CONTROLS`/`ACTIONS` arrays are the complete, reviewed surface —
see Gotcha #5 in `ARCHITECTURE.md` before adding to this. If you have a real reason to (an
actual device/consumer, not "this seems useful"):

1. Add one entry to `CONTROLS` (or `ACTIONS`) in `contract.js` — `{ id, label, kind, min?, max? }`.
2. Add the resolution logic to `registry.js#buildControl()` (or `buildAction()`) — a `read`/
   `write`/`subscribe` closure over `store`/`playbackController`, following the existing
   `switch (def.id)` cases. For a parameterized family of ids (like `track.<n>.muted`), match
   `TRACK_CONTROL_ID`'s regex-prefix pattern rather than hand-listing every index.
3. Add a `test/controlRegistry.test.js` case using the existing fake `playbackController`
   helper — no real `webdsp`/browser audio needed for this layer.

Resist building a `midi-core` adapter against this registry speculatively. Build it when
there's an actual device to test against.

### Swapping the grid for a Canvas renderer

`gridView.js`'s public surface (`mount`, `unmount`, `patchCell`, `repaintPattern`,
`getContainerElement`, `getRowElement`, `getCellElement`, `getNodeCount`) is the contract a
`canvasGridView.js` would need to implement. `TrackerGridHost.jsx`, `playheadLayer.js`, and
`cursorLayer.js` only call these methods — none of them assume DOM specifically, except that
`playheadLayer`/`cursorLayer` currently read `offsetTop`/`offsetLeft`/etc. from the elements
`getRowElement`/`getCellElement` return, so a Canvas version would need to either keep
returning real (possibly invisible) DOM elements for geometry, or those two layers would need
their own Canvas-aware reimplementation. Don't build this speculatively — the whole point of
the rendering-performance experiment this repo is built around was to find out whether DOM
actually needs replacing; check the F3 perf panel on a realistic pattern first.

### Project save/load

Implemented in `src/persistence/` — see `docs/ARCHITECTURE.md`'s "Project persistence"
section for the design (`song` serializes as plain JSON since `model/` objects are plain data;
`store.instruments` is saved alongside it since it lives outside `Song`; `sampleId` is dropped
and re-assigned on load since it's only valid for the current `AudioRuntime` session). To
extend the format (a new field to persist):

1. Add it to `serializeProject()`/`deserializeProject()` in `persistence/projectFile.js`.
2. Bump `PROJECT_FORMAT_VERSION` only if the change isn't backward-compatible (an old file
   would fail to load correctly without it) — an additive, optional field usually doesn't need
   a bump.
3. Add a case to `test/projectFile.test.js`.

## Testing

- `model/`, `audio/compile.js`, and `control/registry.js` are pure-function or
  fake-dependency-friendly — covered by `vitest` (`npm test`). Add cases here for any new
  logic in these layers; they don't need a browser.
- `audio/runtime.js`, `audio/lookaheadPlayer.js` (the real scheduling loop), and all of `ui/`
  genuinely need a browser (`AudioContext`/`AudioWorklet`/real layout) — this project's
  development process verified these with a real headless-Chromium session via Playwright
  (click through the actual UI, read back DOM state, check `console`/`pageerror` for free),
  the same "can't fake it, so verify it for real" approach `webdsp`'s own `ARCHITECTURE.md`
  documents. There's no committed browser-test suite yet; if you add one, prefer driving the
  real app over mocking `AudioContext`.
- Before shipping a change to `ui/grid/*`, sanity-check the F3 perf panel: a single-cell edit
  should move the "cell patches" counter by exactly the number of fields you wrote (usually 1,
  or 3 for a full note-entry), never by anything close to 512 — if it does, something is
  triggering a full repaint where it shouldn't.

## Maintenance checklist for a new module

Before adding a new file under `src/`:

- [ ] Does it belong in an existing directory per the module map above, or does it genuinely
      need a new one? (`model/`, `audio/`, `state/`, `input/`, `ui/grid/`, `ui/chrome/`,
      `control/`, `debug/` cover almost everything.)
- [ ] Does it import only from the layers below it (per the layering rule), or does the
      cross-layer wiring belong in `appContext.js` instead?
- [ ] If it's a React component reading the store, are its `useStore` selectors returning
      primitives, not mutated container objects? (Gotcha #1)
- [ ] If it positions a DOM element via `transform`, did you set `top`/`left` explicitly on
      mount? (Gotcha #2)
- [ ] If it's data-shaped (a new control id, a new effect, a new event name), did you add it
      as one entry to an existing table/registry rather than growing a parallel one-off
      mechanism? This is the single habit most worth keeping — see Gotcha #5 and
      `docs/ARCHITECTURE.md`'s framing of why `webseq`'s MIDI contract became hard to
      maintain, and why this repo's equivalent is built differently.
