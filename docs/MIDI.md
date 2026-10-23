# MIDI: live input, MIDI-output instruments, and the Push Mk1 controller surface

How webtrack's MIDI I/O fits together, and how to add another controller. Read
[`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this assumes you know the module
map and the Song/Event data model.

## What this is

MIDI is an input/output boundary around the tracker, not a separate application model:

```
            WebTrack domain (model/, state/, audio/)
                        |
         +--------------+--------------+
         |                             |
    MIDI INPUT                    MIDI OUTPUT
         |                             |
  keyboard / Push Note Mode      a MIDI-output instrument
         |                             |
         +---------- MIDI ------------+
```

The tracker never imports anything MIDI-specific, and MIDI code never reaches into the tracker's
internals — every seam below is a small, explicit contract. Three mostly-independent pieces:

1. **Live MIDI input** — a keyboard (or Push in Note Mode) playing notes into the tracker, via
   the same contract the computer keyboard already used.
2. **MIDI output** — a track's instrument sending notes to an external MIDI device instead of
   triggering a sample, scheduled off the same lookahead player that drives sample playback.
3. **The Push Mk1 controller surface** — Push's grid/buttons/LEDs as a hardware editor for the
   tracker, built as a small mode-dispatch layer on top of pieces 1 and 2, not a separate thing.

None of this depends on [`midi-core`](https://github.com/lwojas/midi-core) (a sibling project's
own, separate MIDI library) at runtime — see "Why no `midi-core` dependency" below for why, and
what was taken from it anyway.

## MIDI input (`input/midiInputSource.js`)

The contract already existed before any MIDI code did — `input/noteInputSource.js`:

```js
{ onNoteOn(fn), onNoteOff(fn), emitNoteOn(payload), emitNoteOff(payload), attach() }
// payload: { note, velocity, channel? } — note/velocity numeric, same values Event.note/
// Event.velocity already use. channel is optional; nothing downstream currently reads it.
```

`input/keyboardNoteMap.js` (the computer keyboard) and `input/midiInputSource.js` (any Web MIDI
input device) both implement it. `input/editController.js#handleNoteOn` is the one consumer —
it always auditions the note (`audio/preview.js`) and, only when edit mode is on and the cursor
is on the note field, writes it into the model. Neither source nor the consumer knows about the
other: a MIDI keyboard note and a `Z` keypress produce an identical call.

`appContext.js` passes **every** note source into one `editController.js` as an array
(`noteSources: [keyboardNoteSource, midiNoteSource, pushNoteEntryMode]`), not a second
`createEditController` instance per source — `editController.js#attach()`'s own doc comment
explains why: a second instance would attach a second `"keydown"` listener on the same target
and double every arrow-key move/hex-digit entry/copy-paste shortcut, since those aren't gated by
which note source triggered them.

`createMidiNoteSource()` wraps `navigator.requestMIDIAccess()` and wires **every** currently
connected input port's Note On/Off into the same contract, with no per-device filtering — it's
the generic "any MIDI keyboard" path. (Push's own notes go through a separate, mode-gated path —
see "Push Note Mode" below — not through this generic source, since a Push pad press should only
become a tracker note while Push is deliberately in Note Mode.)

`requestMIDIAccess` is an overridable constructor parameter (same "overridable for tests" shape
`audio/lookaheadPlayer.js`'s `reserveVoiceSlot`/`registerVoice` already use) — tests inject a
fake `MIDIAccess`, production falls back to the real `navigator.requestMIDIAccess`.

## MIDI output (`model/instrument.js`, `audio/compile.js`, `audio/midiOutput.js`)

### The model: output lives on the instrument, not the track

```js
// model/instrument.js
createInstrumentSlot({ ..., output: { type: "sample" | "midi", channel: 0-15 | null } })
```

A track doesn't have one instrument — a *cell* does (`Event.instrument`), and `Instrument`
already owns the sample-specific fields (`sampleId`, `rootNote`, `gain`). Output type is the
smallest-diff addition to that existing shape, additive and round-tripping through
`persistence/projectFile.js` with no format-version bump (an old project's instruments default
to `{ type: "sample", channel: null }` — unchanged behavior).

### The rule: a MIDI note number is never offset by `rootNote`

```js
// audio/compile.js#compileEvent
if (instrument.output?.type === "midi") {
  if (instrument.output.channel == null) return null;
  return { kind: "midi", channel: instrument.output.channel, note: event.note, velocity, ...time/duration };
}
// sample path (unchanged): pitch = event.note - instrument.rootNote
```

`rootNote` exists to compensate for a *sample's* unknown natural pitch — the engine has no idea
what pitch the raw audio is, so `pitch = event.note - instrument.rootNote` is a playback-rate
transposition trick. A MIDI device receiving note 60 already knows what its own note 60 means;
there's nothing to compensate for, so the MIDI branch sends `event.note` verbatim and has no
`pitch` field in its compiled shape at all. (This was a deliberate design correction mid-build —
see the git history around `audio/compile.js`'s MIDI branch for the original back-and-forth.)
Velocity passes straight through too — no `gain = velocity/127 * trackChannel.volume` scaling,
since that's a sample-engine gain-staging concept, not a MIDI one.

Every compiled event carries a `kind` (`"sample"` | `"midi"`) so callers can route without
re-deriving it. `audio/compile.js#compileRow` doesn't filter by it — whichever caller needs to
route `"midi"`-kind events differently does that itself.

### Scheduling: no clock bridge, because Web MIDI timestamps can't be canceled

`audio/lookaheadPlayer.js#tick()` partitions a row's compiled events by `kind`: `"sample"` goes
through `runtime.schedule()` exactly as before (with `kind` stripped alongside `trackIndex`,
same as before this feature existed); `"midi"` goes to `audio/midiOutput.js#scheduleNoteEvents`.

The obvious design — pass each event's own `time` as Web MIDI's `output.send(data, timestamp)`
future-timestamp parameter — doesn't work: unlike `webdsp`'s own `AudioRuntime.cancelScheduled()`
(which really does stop a scheduled audio event), Web MIDI's own timestamped `send()` has **no
cancel**. Once sent with a future timestamp, the browser delivers it no matter what happens
afterward (e.g. the user hits Stop mid-note). `audio/midiOutput.js` never uses that parameter —
every send is a plain `setTimeout`, keyed to `event.time - runtime.getCurrentTime()` computed
fresh at the moment `scheduleNoteEvents()` is called (within the same ~150ms lookahead horizon
everything else schedules inside). `event.time` and `runtime.getCurrentTime()` are already the
same AudioContext-seconds clock, so the difference is directly "seconds from now" — no
cross-clock (`performance.now()` vs. `AudioContext.currentTime`) bridging is needed at all.
`setTimeout`'s few-ms jitter is well within MIDI's own timing tolerance (unlike audio sample
playback, which is why `webdsp` needs the Web Audio clock in the first place), and, critically,
`setTimeout` **is** cancelable — `lookaheadPlayer.js#stop()` calls
`midiOutput.cancelScheduled()` alongside `runtime.cancelScheduled()`.

Each compiled MIDI event already carries its own `duration` (`compileRow` computes it the same
`noteDurationSteps` way sample output does), so `scheduleNoteEvents` sends a self-contained
Note On + Note Off pair per event — no cross-event voice tracking, no parallel
`audio/voiceTracker.js`-equivalent for MIDI. This mirrors `webdsp`'s own "duration is baked in
at compile time, the engine auto-releases" model (see `ARCHITECTURE.md`'s audio-timing section).

`audio/preview.js#triggerPreview` branches the same way for live audition: a `"midi"`-kind
compiled event calls `midiOutput.sendImmediateNoteOn()` directly and returns `null` (no voice
handle — there's nothing to release later, same as a sample audition's own voice isn't
explicitly released on key-up either). Critically, `compileEvent` runs *before* `preview.js`
touches `getRuntime()` at all, so auditioning a MIDI-output instrument never needs `webdsp`'s
`AudioRuntime` initialized in the first place.

`midiOutput`, like `audio/voiceTracker.js`'s own `voiceTracker`, is one shared app-wide
singleton (`export const midiOutput = createMidiOutput();`) — scheduled playback and manual
audition both send through the same connected output ports, lazily connected on first use
(`ensureConnected()`, same idempotent "whichever call site asks first wins" shape
`audio/voiceTracker.js#ensureVoiceEndedWired` already established), not an explicit
attach/detach lifecycle wired into `App.jsx`.

### UI

`ui/chrome/InstrumentPanel.jsx`'s instrument editor has a SAMPLE/MIDI toggle (reusing
`FxPanel.jsx`'s own TRACK/MASTER toggle button styling) and, for MIDI, a 1–16 channel field
(displayed 1-indexed, stored 0-indexed — the usual MIDI-gear convention). Switching to MIDI
hides the gain slider (meaningless without a sample); switching back restores it if a sample is
still loaded. The instrument list shows `· MIDI` next to a MIDI-output slot's name.

## The Push Mk1 controller surface (`src/midi/push/`)

### Why no `midi-core` dependency

`midi-core` is a sibling project's existing, working MIDI library with its own Push Mk1 profile
— real, hands-on-verified hardware knowledge. Its `core/`, `mapping/`, and `control-api/` layers
are genuinely generic (message types, Web MIDI port wrapping, a Control/Action registry), but
its `surface/` layer — the part that would actually bind a device profile to an application —
is sequencer-app-shaped: windowed/paged controls addressed by string templates
(`"step.{row}.{column}"`), mode switching, bank-select, display-meter compositing, built for a
different app's "small device, much larger sequence" problem. Adopting it would force webtrack
into exactly the per-cell control-id addressing scheme `docs/ARCHITECTURE.md`'s Gotcha #5
already explains webtrack rejected (`control/contract.js` deliberately has no per-cell ids —
see that gotcha for the 1400-line cautionary tale), plus constructing a `DeviceProfile` +
`SurfaceContext` + `SurfaceNavigation` object graph for things webtrack doesn't need (track
paging — webtrack's 8 tracks already fit Push's 8 columns exactly; a device registry — webtrack
only ever targets one or two known devices).

What **was** taken from `midi-core`, as plain ported data, not code or architecture: the Push
Mk1 protocol facts in `constants.js` and `colors.js` below (pad note numbering, button CCs, LED
feedback byte families, LCD SysEx framing) — hands-on-verified hardware knowledge with no cheap
substitute, since re-deriving it would mean re-probing a real device.

### Layout

```
src/midi/
  deviceManager.js        generic Web MIDI port listing, for the Settings modal
  push/
    constants.js        protocol constants — CCs, pad note formula, LCD SysEx framing
    colors.js            LED feedback — RAW bytes + a semantic PALETTE
    lcd.js                 LCD text-building helpers (bars, columns) — not protocol data
    pushDevice.js         raw connection to the Push's "User Port" input/output pair
    modeController.js     the CC50/51/112/113 mode state machine + gridContent dispatch
    noteEntryMode.js       "note" content — pads behave like a keyboard
    trackerGridMode.js     "session.tracker" content — the tracker grid controller
    selectCopyPaste.js     CC48 Select copy/paste actions, shared by noteEntryMode/trackerGridMode
    patternGridModeStub.js "session.pattern" content — a placeholder (Pattern view isn't built)
    encoderController.js    the 8 encoders + LCD — volume/FX/cellEdit modes, independent of gridContent
    transportController.js  the Play button — also independent of gridContent
    writeMode.js             the CC86/Record toggle — also independent of gridContent
```

### `pushDevice.js` — the User Port, never the Live Port

Confirmed against the real connected hardware, not guessed: Push Mk1 exposes **two** port
pairs, `"Ableton Push Live Port"` (Ableton Live's own proprietary control-surface protocol,
which webtrack never speaks) and `"Ableton Push User Port"` (free for custom MIDI — the one
webtrack wants). `pushDevice.js` matches by a loose substring pattern (`/push.*user/i`), not an
exact name, specifically because the same port can show up elsewhere (Audio MIDI Setup, a DAW's
device list) with a manufacturer suffix, e.g. `"Ableton Push User Port (Akai)"` — also confirmed
against real hardware, with a regression test locking in the match
(`test/pushDevice.test.js`).

User Mode must be entered manually on the Push's own hardware menu — there's no documented
setup handshake to replicate in software (per `midi-core`'s own hardware-validation docs), so
this module only ever connects to whichever port already matches; it never tries to switch the
device into that mode itself.

Connection is lazy and idempotent (`ensureConnected()`), the same shape
`audio/voiceTracker.js#ensureVoiceEndedWired` already established — `attach()` kicks it off,
returning a cleanup that removes whatever listeners ended up wired.

### `constants.js` / `colors.js` — the protocol data, and the two LED feedback families

Two **separate, non-interchangeable** LED feedback schemes exist on this hardware, and mixing
them up is a real bug this project hit once (see "Lessons from real bugs" below):

- **Velocity-color-led** (pads, mute strip `MUTE_CC`, track-select buttons `TRACK_SELECT_CC`) —
  a byte picks a *color* from the device's palette. `colors.js`'s `RAW` holds the
  hardware-confirmed bytes (`OFF: 0`, `DIM_WHITE: 10`, `RED: 6`, `GREEN: 22`, `TEAL: 36`,
  `AMBER: 29` — the last one provisional, unconfirmed on pads specifically); `PALETTE` is the
  one semantic layer webtrack's own rendering code should ever import (`CELL_HAS_NOTE`,
  `TRACK_MUTED`, `TRACK_SELECTED`, etc.) — re-theming or swapping a provisional byte once
  hardware-checked is a one-place edit there, never a change scattered across mapping code.
- **Monochrome dim/full/blink** (Play, Shift, and — this project's own addition — the four mode
  buttons `CC_MODE_NOTE`/`CC_MODE_SESSION`/`CC_MODE_TRACK`/`CC_MODE_CLIP`) — only
  `FEEDBACK_OFF` (0) / `FEEDBACK_DIM` (1) / `FEEDBACK_DIM_BLINK` (2-3) / `FEEDBACK_FULL` (4) /
  `FEEDBACK_FULL_BLINK` (5-6) are meaningful; 7+ clamps to full. These live in `constants.js`,
  never in `colors.js`'s `PALETTE`.

Other protocol facts in `constants.js`: `padNote(rowFromBottom, column)` / `padCoordinates(note)`
(exact inverses — `padNote` confirmed for the whole grid, LED feedback only hardware-confirmed
at velocity 36/teal specifically), `ENCODER_CC`/`encoderDelta()` (relative, signed 7-bit two's
complement — not yet consumed anywhere), `lcdSysex(lineIndex, text)` (4 lines, `F0 47 7F 15
{lineId} 00 45 00 [68 ASCII bytes] F7`, space-padded/truncated to exactly 68 bytes — not yet
consumed anywhere; see "Boundaries" below), `CC_TRACK_SELECT`/`TRACK_SELECT_CC`/`MUTE_CC`/
`CC_ARROW_UP`/`CC_ARROW_DOWN`.

`TRACK_SELECT_CC` (CC20-27, the row of buttons directly below the LCD) isn't in `midi-core` at
all — it was confirmed directly against the real hardware mid-build, including which LED
feedback family it belongs to (velocity-color-led, same as the mute strip — also confirmed
hands-on, not assumed). `SELECT_CC` (CC36-43, the side column) **is** real, confirmed hardware
data from `midi-core`, but isn't currently used — it doesn't line up with anything once the
tracker grid's track axis is columns rather than rows (see `trackerGridMode.js` below); kept
documented in case a future per-row use for it comes up.

### `modeController.js` — the mode state machine

Two independent pieces of state, entirely this project's own design (not ported from
`midi-core`, which wires its equivalent buttons to a different app's concepts entirely):

```js
pushMode: "note" | "session"       // what the 8x8 grid currently shows — CC50 / CC51
sessionView: "tracker" | "pattern" // which content "session" shows — CC112 / CC113
```

Pressing Track or Clip sets `sessionView` **and** switches into session mode directly, so you
land on the grid immediately rather than needing a separate Session press afterward. Note/
Session light up mutually exclusively per `pushMode`; Track/Clip light up mutually exclusively
per `sessionView` regardless of which `pushMode` is current — so the device always shows what
you'll land on next time you press Session. The unselected button in each pair is dim
(`FEEDBACK_DIM`), not off — every mutually-exclusive Push button group (these four, plus
`encoderController.js`'s CC114/115 and `transportController.js`'s Play) uses this one
dim/selected-is-full convention, not a per-button scheme.

`gridContent` is the dispatch table — keyed `"note"` or `"session.<view>"` — each entry an
optional `{ onEnter, onExit, onPadOn(row, column, velocity), onPadOff(row, column),
onCC(cc, value), paint }`. This is deliberately small and flat rather than a generic
device-mode framework: there are exactly three content providers this project has any use for.
A pad message (Note On/Off) is decoded once (`padCoordinates`) and routed to whichever content
is currently active; a non-mode CC is routed to that content's `onCC` (mute strip, track-select,
paging — only `trackerGridMode.js` currently defines one).

### `noteEntryMode.js` — Push as a keyboard

Confirmed against real hardware (not guessed, not assumed): Push's pads already send standard
Note On/Off in their resting state, exactly the same shape a MIDI keyboard sends, with **no
special handshake needed** — this was the one open question flagged when this stage started
("does Push need to be told to emit notes, or does it already?"), resolved by listening to the
device's raw input with it in its default state and observing real Note On/Off messages. So
Note Mode is a thin adapter: `modeController.js`'s decoded `(row, column, velocity)` converts
straight back to the note the hardware itself assigned that pad (`padNote` — the exact inverse
of `padCoordinates`) and feeds it through `noteInputSource.js`'s contract — the same one
`midiInputSource.js`/`keyboardNoteMap.js` implement. `editController.js` never needs to know a
note came from a Push pad instead of a keyboard. `pushNoteEntryMode` is simultaneously a
`gridContent["note"]` entry (receives pad events from the mode controller) and a regular
`noteSources` entry in `appContext.js` (the same object, both roles).

Note Mode's pads also carry a deliberate color scheme, configured in `colors.js`'s `PALETTE`
alongside every other Push color (`NOTE_MODE_BASE`/`NOTE_MODE_PRESSED` — resting amber,
struck-bright green): `onEnter()` paints the whole grid to the base color, `onPadOn`/`onPadOff`
flash a pad to the pressed color and back, `onExit()` darkens everything, all diffed against a
per-pad cache the same way `trackerGridMode.js`'s own LED sends already are.

### `trackerGridMode.js` — Push as a tracker grid controller

**Axis mapping** (this project's own design choice — corrected once, after hands-on use):
Push's pad **column** is the webtrack track index (column 0, leftmost, is track 0); Push's pad
**row** is the step *within the currently visible 8-step window*, flowing top-to-bottom (row 0,
physical top, is the earliest step). This lines up tracks with the 8 encoders and the mute/
track-select button rows above, all of which are column-addressed by nature — the original
version of this file had the axes swapped (tracks on rows, steps on columns, matching the
app's *own* on-screen grid layout more literally) and was rotated 90° after real use showed it
needs to be vertical, in line with the encoders, not horizontal. Nothing about webtrack's own
on-screen grid changed — only how Push's two axes map onto it.

**Paging**: the track axis needs none — 8 Push columns, 8 webtrack tracks, exactly. The step
axis does, since a pattern can be up to 128 steps (`model/timing.js#MAX_BARS`) — `stepOffset`
is the one window position this module owns, paged 8 steps at a time by the Up/Down arrow
buttons (steps flow vertically, so paging is vertical too — Up toward earlier steps, Down
toward later ones, the direction scrolling up/down a page of text would go). This is the one
axis of windowing `midi-core`'s own full 2D paging system would have been overkill for.

**Editing**: a pad press toggles a step — empty becomes a note at a fixed default pitch (middle
C), the currently-selected instrument, and the pad's own velocity; occupied becomes cleared.
Only `note`/`instrument`/`velocity` are touched by a clear — never `pan`/`length`/`fx`, so a
step a user carefully set up from the desktop UI never loses that data just because it got
tapped off and back on from Push.

**Mute and track select**: `MUTE_CC[trackIndex]` toggles `store.setTrackChannelMuted` directly
(reusing the existing mutator, no new model state); `TRACK_SELECT_CC[trackIndex]` moves
`store`'s cursor to that track via `store.selectCell`, the same "which track is focused" notion
clicking a grid column already sets — nothing Push-specific added to the model.

**Live playhead**: polled on a plain `setInterval` (50ms), not a store event — there's no
equivalent of a note/cell edit firing for "time passed." Mirrors `ui/grid/playheadLayer.js`'s
own reasoning for polling rather than subscribing. Only the (at most two) cells whose playhead
status actually changed get repainted.

**LED painting is diffed, not blind** — every `device.send()` in this file goes through a
`sendPad`/`sendMute`/`sendTrackSelect` helper that checks a per-LED cache first and skips the
send if the color hasn't actually changed (see "Lessons from real bugs" below for why this
exists). The cache resets on `onEnter()`, since another mode may have painted over the same
physical LEDs in the meantime.

### `encoderController.js` — the 8 encoders + LCD, volume/FX modes

Attached independently of `modeController.js`'s grid-mode dispatch — its own
`device.onMessage` subscription (`pushDevice.js` already supports more than one listener) —
because the encoder row is a physically separate set of controls from the 8x8 pad grid and stays
meaningful regardless of whether the grid is currently showing Note or Session content.

Two switchable modes, each a Push-surface-local piece of state (not `state/store.js` — the same
"this module owns its own windowing state" precedent `trackerGridMode.js`'s own `stepOffset`
already established):

- **Volume** (`CC_ENCODER_MODE_VOLUME`/114, the hardware's own Volume/Pan button, reused as-is) —
  encoder *i* controls `trackChannels[i].volume`, the same column-is-track axis the grid/mute
  strip/track-select row already use. Range clamped to `src/control/contract.js`'s own
  `track.*.volume` `{min:0,max:1.5}`, not a second copy of that number.
- **FX** (`CC_ENCODER_MODE_FX`/115 — this project's own reassignment of that physical button,
  the same kind of repurposing `CC_MODE_NOTE`/`SESSION`/`TRACK`/`CLIP` already are, not a ported
  hardware meaning) — encoder *i* controls the *i*-th parameter (`model/fxParams.js#getFxParamsForType`)
  of whichever `fxChain` entry is currently paged to, on the grid cursor's current track
  (`store.getState().cursor.trackIndex` — the same "current track" `FxPanel.jsx`/`NoteEditor.jsx`
  already use). `CC_ARROW_LEFT`/`CC_ARROW_RIGHT` (44/45 — unclaimed by `trackerGridMode.js`,
  which only consumes Up/Down) page between enabled FX modules, clamped at the ends like
  `trackerGridMode.js#pageSteps` already is. A `kind: "boolean"` parameter (`filter.mode`,
  `filter.slope` — see below) can't read a relative encoder's delta as "current + delta" the way
  a continuous one does — it accumulates `|delta|` and flips once that crosses a small threshold,
  then resets, toggling between that param's own `min`/`max` (`model/fxParams.js#isFxBooleanOn`)
  rather than a hardcoded 0/1 — `filter.slope`'s two values are webdsp's own real 12/24, not a
  normalized flag like `filter.mode`'s.

Writes exclusively through `store.setTrackChannelVolume`/`fxController.setTrackFxInstanceParam`
(the latter addresses one specific stacked FX instance's own parameter bag, now that the same
kind can appear more than once in a chain — `model/trackChannel.js#fxChain`'s doc comment) — the
exact calls `Mixer.jsx`/`FxPanel.jsx` already use, so there's one path from "a parameter
changed" to the engine, whichever UI (hardware or React) changed it.

The LCD (4 lines via `constants.js#lcdSysex`, diffed per-line the same "only send what changed"
way every other Push paint already is) shows a header (mode, or the current FX's name/page/
track), a bar row per encoder (`midi/push/lcd.js#formatBar`, glyphs from `[ ] - =` per
`constants.js`'s own doc comment — a boolean parameter centers "ON"/"OFF" instead), a name row,
and a value row (`model/fxParams.js#formatFxValue`). Repaints on an encoder turn and on
`TRACK_CHANNEL_CHANGED`/`TRACK_FX_CHANGED`/`CURSOR_MOVED`, so the display tracks a value changed
from the React UI, a track switch, or an FX-module page turn alike — never a second
representation of the same state.

Each encoder's 8-character column is placed at its real physical offset, not at `index * 8`: the
68 columns aren't one continuous strip — the hardware has 4 dot-matrix display units, one per
pair of encoders, and each is a 17-character cell (two 8-wide encoder segments plus one spare,
unrendered column between them). `constants.js#LCD_SEGMENT_OFFSETS` (`[0, 8, 17, 25, 34, 42, 51,
59]`, ported from `midi-core`'s `PUSH_MK1_DISPLAY.segments`) is this geometry; `lcd.js#buildEncoderLine`
positions every bar/name/value column against it. Packing all 8 columns contiguously (the
original implementation) drifts one column out of alignment with the physical encoder at every
display-unit boundary crossed, visible as a growing gap by the rightmost pair.

### `transportController.js` — the Play button

Also attached independently of the grid-mode dispatch. Reflects `store`'s `playing` flag as
dim/full on `CC_PLAY`, and a press calls `appContext.js`'s own `togglePlayback()` — the same
play/stop entry point the keyboard shortcut uses, so Push's Play button can't start playback
ahead of `ensureDemoInstrumentsLoaded()` finishing (the autoplay-gesture + demo-kit-load race,
`ARCHITECTURE.md`'s Gotcha #4) by routing around it.

### `writeMode.js` + write mode — Push as a hardware cell editor

CC86 (Record) toggles **write mode**, a cross-cutting piece of Push-surface state deliberately
kept independent of `modeController.js`'s own `pushMode`/`sessionView` — it stays on across a
Note ↔ Session/Grid switch, exactly like Play or the encoder mode buttons are already
independent of grid content. `writeMode.js` owns only the boolean and Record's own LED
(`FEEDBACK_DIM` off, `FEEDBACK_FULL_BLINK` on — the hardware blinks on its own once sent that
value, no JS timer) plus an `onChange(fn)` subscriber list; `appContext.js` wires that one
subscriber to flip `encoderController.js`'s display mode and force a repaint of whichever grid
content is active, the same composition-root role `pushDevice.js`'s own `onConnectionChange` →
`refreshPushState()` wiring already established. `noteEntryMode.js`/`trackerGridMode.js` never
get notified — they just call `writeMode.isActive()` lazily from inside their own existing
pad/CC handlers.

There is no second "selected cell" concept anywhere in this feature — write mode reads and
writes `state/store.js`'s own `cursor` (`store.selectCell`/`store.setCell`, the exact mutators
the grid/mouse and `ui/chrome/NoteEditor.jsx` already use), so Push's notion of "the selected
cell" and the webtrack UI's are, by construction, the same value, synchronized through the same
`CURSOR_MOVED`/`CELL_CHANGED` events every other subscriber already reacts to.

**Note Mode, write mode on** (`noteEntryMode.js`): a pad press still emits the same
`noteInputSource.js` event it always has (so audition/scale behavior is unchanged), and
additionally commits straight into the selected cell via `store.setCell` — note/instrument
(the currently selected one)/velocity, then an `editStep`-driven cursor advance, mirroring
`input/editController.js#handleNoteOn`'s own write+advance so a note entered from Push lands
exactly where the same note typed on a keyboard while editing would. CC44-47 move the selected
cell through the actual (track, row) coordinates — not constrained to any visible window, since
Note Mode's pad grid has no windowing concept at all (it's a piano-style note layout). Each axis
wraps independently via `store.selectCell`, not `store.moveCursor`'s `delta.field` (which also
cycles `field`/wraps into a neighboring track as a side effect that doesn't apply to a dedicated
track-axis move).

Note Mode's own pad grid still gets a `PALETTE.SELECTED_CELL_CURSOR` highlight, reusing
`trackerGridMode.js`'s own track=column, row=step-within-window mapping *exactly* (not a
separate one) — so the cursor lands on the same physical pad for the same selected cell
regardless of which Push view is showing it. (An earlier version of this highlighted whichever
pad matched the *note already in* the selected cell instead, reasoning that Note Mode's grid is
a piano layout with no (track, row) position of its own to paint — wrong in practice: it didn't
move predictably with CC44-47, since two cells rarely hold adjacent note values, and gave no
indication at all for an empty cell. Fixed by reusing the real mapping.) Note Mode has no
window-offset of its own to page with (the piano layout never scrolls), so `rowIndex` wraps onto
the 8-row grid every 8 rows via a plain modulo instead of a tracked window position. Repaints on
`CURSOR_MOVED` only now (not `CELL_CHANGED` — the overlay no longer depends on what a cell
contains, only on the cursor's own position), and is skipped for any pad currently held down so
a store write mid-press (`writePressedNote`'s own `store.setCell` calls, which fire
`CELL_CHANGED`, and the `editStep` auto-advance's `CURSOR_MOVED`) can't clobber the
`NOTE_MODE_PRESSED` feedback the user is still looking at. No highlight shows when write mode is
off.

**Session/Grid, write mode on** (`trackerGridMode.js`): a pad press selects that tracker cell
(`store.selectCell`, preserving the cursor's own `field`) instead of toggling a step on/off —
loading the cell's properties onto the encoders/LCD and lighting the cursor color both follow
for free from the `CURSOR_MOVED` this emits, no separate "push to Push" step. The selected
cell's own pad is painted `PALETTE.SELECTED_CELL_CURSOR` (colors.js) — a new priority tier ahead
of both the playhead and has-note coloring in `cellColor()`, since knowing exactly which cell
Push is about to write into matters more, while editing, than briefly seeing the playhead pass
through it. CC44-47 keep their existing (write-mode-independent) behavior: Up/Down still page
the visible step window (`pageSteps` — viewport paging, not cell selection, so it doesn't
compete with pads as the brief's "one selection mechanism" requirement), Left/Right stay
unclaimed exactly as before this feature existed.

**Session/Grid range selection and Duplicate** (`trackerGridMode.js`, CC49 Shift / CC88
Duplicate): extends the single-cell behavior above with a range-selection/duplicate operation,
built entirely on `state/store.js`'s existing selection rect (`cursor` + `selectionAnchor`, the
same shape a desktop shift+click/drag already produces) and its existing
`captureBlock`/`tileBlockIntoRect` primitives — no second selection representation, no second
copy/paste implementation.

- **Shift (CC49)** is read live: `modeController.js`'s own CC dispatch now forwards *every* CC
  to the active content's `onCC`, release included (it used to filter to presses only, `data2 >
  0`, before ever reaching `onCC` — fine for every existing consumer, which already guarded
  releases itself, but wrong for a button whose LED must track real held/not-held state rather
  than behave like a one-shot toggle). `trackerGridMode.js`'s own `onCC` handles Shift *before*
  its usual release guard, for exactly this reason. Lit (`FEEDBACK_FULL`) while physically held,
  dim otherwise — only meaningful while write mode is on; a plain no-op otherwise (Shift was
  never wired to anything before this).
- **Shift + a pad** builds a range from the tracker's own absolute first cell (track 0, row 0)
  through the pressed pad: `store.selectCell(0, 0, field)` then
  `store.extendSelectionTo(trackIndex, stepIndex)` — the *exact* pair a desktop shift+click/drag
  already calls, not a parallel implementation. Every further Shift+pad press repeats this same
  pair from scratch, replacing rather than extending the previous range, per the brief. A plain
  (non-shift) pad press always calls the single-cell `store.selectCell(trackIndex, stepIndex,
  field)` from before this feature — which, as a side effect, collapses any existing range back
  to one cell, satisfying "a normal press dismisses the selection" for free.
- **`PALETTE.GRID_SELECTION`** (colors.js, `RAW.DIM_WHITE`) paints every cell inside an active
  multi-cell range uniformly, in `cellColor()`'s own priority tier *above*
  `SELECTED_CELL_CURSOR` — the two are deliberately distinct colors/concepts per the brief (a
  single selected cell vs. a range selected for an operation): the cursor color only shows once
  a rect has collapsed back to 1x1. `DIM_WHITE` was chosen because every *other* RAW byte is
  already painted somewhere in the Session/Grid pad context (`OFF`=empty, `GREEN`=has-note,
  `TEAL`=playhead, `RED`=cursor) — the same "reuse a confirmed byte in a new context" move
  `SELECTED_CELL_CURSOR`'s own choice of `RED` already made.
- **Duplicate (CC88)** is lit while `store.getSelectionRect()` spans more than one cell, dim
  otherwise (`hasRangeSelection()`) — reflecting *any* current selection, not only a Push-made
  one. A press calls `state/store.js#duplicateSelection()` (new — built from the same
  `captureBlock`/`tileBlockIntoRect` `copySelection`/`fillSelection` already use, destination rect
  starting the row right after the selection's own last row, clipped at the pattern's row bound
  the same way `pasteSelection` already clips near an edge; deliberately never touches
  `state.clipboard`, unlike `copySelection`, so duplicating can't clobber an unrelated pending
  paste), then collapses the selection back to the cursor's single cell either way — restoring
  normal single-cell editing (and the LCD/encoders along with it, via the same `CURSOR_MOVED` the
  collapse emits).
- **Provenance, not a second selection:** `pushOwnsSelection` (a plain boolean, not a selection
  copy) is true only while the *active* range was created by a Push Shift+pad gesture — checked
  before auto-collapsing a selection on `onExit()` (leaving Session/Grid view) or on `refresh()`
  once write mode has turned off (`syncSelectionWithWriteMode()`, called from both `onEnter()`
  and `refresh()` — the hook `appContext.js`'s `pushWriteMode.onChange` → `pushModeController.
  refresh()` wiring actually fires through). This is what stops Push from clobbering a selection
  the desktop UI's own mouse drag made independently of it, while still cleaning up anything
  Push itself started.

**Session/Grid and Note Mode: Select cell copy/paste** (`selectCopyPaste.js`, CC48 Select):
a momentary modifier, available in *both* grid contents, that exposes webtrack's own existing
cell clipboard (`state/store.js#copySelection`/`pasteSelection` — the exact mutators Ctrl/Cmd+C/V
and the toolbar's Copy/Paste buttons already use) through Push, rather than a second, Push-only
clipboard or paste implementation.

- **`selectCopyPaste.js`** holds the two shared actions as plain functions over a `store`, not a
  stateful module the way `writeMode.js` is one for CC86: `copyCurrentCellToClipboard(store)`
  collapses any active range selection onto the cursor's own cell (`collapseSelectionToCursor`'s
  own pattern) then calls `store.copySelection()` — "the currently selected/cursor cell," never
  whatever a pending Shift-made range spans — and returns `false` without copying anything if
  there's no valid cell under the cursor, so a stale older clipboard entry can never be mistaken
  for a fresh copy by a caller that only checks "is held." `pasteClipboardIntoCell(store,
  trackIndex, rowIndex, field)` calls `store.selectCell` then `store.pasteSelection()` — a no-op
  without a clipboard. Both `noteEntryMode.js` and `trackerGridMode.js` import these directly;
  each content tracks its own local `selectHeld`/`pasteReady` live-held state (reset in its own
  `onEnter`/`onExit`), the same way `trackerGridMode.js`'s own `shiftHeld` already is — Select has
  to reset the moment the active grid content changes or write mode turns off, not persist across
  either.
- **Select (CC48)** needs its own release, for the same reason Shift does (`modeController.js`
  forwards every CC, release included, to the active content's `onCC` — see "Session/Grid range
  selection and Duplicate" below). A press copies the current cell (`copyCurrentCellToClipboard`)
  and records whether that copy actually succeeded (`pasteReady`); a release clears both
  `selectHeld` and `pasteReady`. Lit (`FEEDBACK_FULL`) while physically held, dim otherwise — only
  meaningful while write mode is on; a plain no-op otherwise, same dim/full convention
  Shift/Duplicate already use. Painting the LED in `noteEntryMode.js` is additionally gated on
  `writeMode` being *present* at all (not just inactive), so the plain no-arg/no-writeMode
  construction `test/pushNoteEntryMode.test.js` uses for Note Mode's base note-input contract
  never sees this button touched — `appContext.js`'s one real caller always passes a `writeMode`.
- **A pad press while Select is held** is a destination pick, not its usual action — this takes
  precedence over everything else a pad press would otherwise do in write mode (including
  Shift's own range-selection handling in `trackerGridMode.js`; if both happen to be held, Select
  wins), and never falls through to a plain select/toggle/note-entry either, even if the armed
  copy turned out invalid (`pasteReady` false): while physically held, the grid is dedicated to
  this interaction only, per the brief. A valid press calls `pasteClipboardIntoCell` with that
  pad's own tracker cell — in `trackerGridMode.js` that's the same (trackIndex=column,
  stepIndex=stepOffset+row) pair `onPadOn` already computes; in `noteEntryMode.js`, which has no
  (track, row) pad grid of its own (it's a piano layout), it reuses the exact same mapping the
  cursor overlay already paints (`destinationRowForPadRow`): column -> track directly, and the
  pressed pad's row -> the same mod-8 remainder within the cursor's *own* current 8-row block
  (there's no window/page position in Note Mode to otherwise pick which of a pattern's many rows
  sharing that remainder is meant) — so a destination lands predictably relative to the pad
  actually pressed, the same reasoning the cursor overlay's own mapping was already built on.
  `noteEntryMode.js` also tracks which notes were redirected this way (`pasteInterceptedNotes`)
  so the matching `onPadOff` swallows the release without emitting a stray `noteOff` — no matching
  `noteOn` was ever emitted for it — while leaving every *other* `onPadOff` call exactly as
  stateless as it already was.
- **The destination becomes the new selection** for free, through the exact same
  `store.selectCell` call every other Push cell-selection entry point already makes — the
  `CURSOR_MOVED` it emits is what moves the `SELECTED_CELL_CURSOR` highlight and refreshes
  `encoderController.js`'s `cellEdit` display onto the pasted cell, with no separate "push the
  result back to the device" step. `store.pasteSelection()`'s own `CELL_CHANGED` is what updates
  the pasted cell's own on-grid content/color in `trackerGridMode.js`.
- **No second clipboard, no second paste:** `state.clipboard` is the only clipboard involved —
  identical to a desktop Ctrl/Cmd+C/V or the toolbar's Copy/Paste buttons, which Select doesn't
  touch and isn't touched by. Pasting onto the cell that was just copied is allowed (ordinary
  `pasteSelection` behavior — no special-casing).

**The encoders/LCD** (`encoderController.js`'s `cellEdit` mode, entered via
`setCellEditMode(true)`/restored via `setCellEditMode(false)`): while write mode is on, the 8
encoders/4 displays show the same 7 fields `ui/chrome/NoteEditor.jsx` exposes above its CELL FX
section, in the same order — NOTE, INSTRUMENT, VELOCITY, LENGTH, PAN, FX CMD (`effectCommand`),
FX PARAM (`effectParam`) — reading/writing the exact same event fields via `store.setCell`, no
second data model. `effectCommand` is a bounded enum, stepped with the same
accumulate-until-a-real-turn technique the FX boolean parameter already uses (`handleFxEncoder`'s
`BOOLEAN_TOGGLE_THRESHOLD`), generalized to a signed index step. `length` steps a whole row per
tick (a snap-to-grid count, not a continuous parameter) and returns to `null`/"auto" one step
below 1. Cell FX automation (the sparse, variable-length CELL FX list) isn't represented — it
doesn't fit a fixed 8-encoder layout, and the brief's own examples ("note, velocity/cell volume,
length, etc.") don't require covering it; a future stage could page it the same way FX mode
pages `fxChain` entries. Repaints on `CURSOR_MOVED` (already subscribed, for volume/FX mode) and
now also `CELL_CHANGED`, so a `NoteEditor.jsx` edit landing on the currently-displayed cell shows
up on the LCD immediately. Turning write mode off restores whichever of volume/FX was showing
before, never resetting to a default.

### `patternGridModeStub.js` — a placeholder, not a feature

Pattern view (the `"session.pattern"` content, reached via Clip/CC113) isn't designed yet. This
file exists only so the mode state machine has somewhere real to switch to: all 64 pads go
dark on entry, every pad press is a no-op. Replacing this file's contents is the entire job of
building Pattern view later — nothing else needs to change.

## Lessons from real bugs (read this before touching LED feedback or mode lifecycle)

Three real bugs were found and fixed against the actual hardware while building this — all
three are the kind of mistake easy to repeat in a new device integration, so they're recorded
here rather than only in git history.

1. **Mixing up the two LED feedback families.** `modeController.js`'s mode buttons were
   originally wired to `colors.js`'s `PALETTE.MODE_BUTTON_ACTIVE`/`INACTIVE` (RAW color bytes
   22 and 10) — both of which are ≥7, and the monochrome scheme clamps any value ≥7 to "full."
   Every button press sent a *different* number that produced the *identical* visual result:
   nothing visibly changed. Diagnosed by isolating a raw `output.send()` call (ruling out a
   connection/environment issue first), confirmed and fixed with a standalone before/after LED
   toggle test against the real device. **Before wiring LED feedback for any new control, know
   which of the two families it belongs to** — `colors.js`'s own doc comment calls this out
   explicitly now.
2. **A React StrictMode effect-cleanup leak.** `modeController.js#attach()`'s returned cleanup
   originally only unsubscribed the raw device message listener — it never called `onExit()` on
   whatever `gridContent` entry `attach()` had just entered. React's StrictMode double-invokes
   effects once in dev (`ARCHITECTURE.md`'s Gotcha #6: mount, cleanup, mount again) — the first
   mount's `onEnter()` (`trackerGridMode.js`'s `setInterval`-driven playhead sync, plus its
   store subscriptions) kept running forever, orphaned, because the second mount's `onEnter()`
   overwrote the only reference that could have canceled it. Symptom: switching to Note Mode
   looked fine until Play was pressed, at which point stale tracker-grid/playhead LEDs bled
   through — invisible beforehand because the leaked interval had nothing to repaint while the
   playhead was stationary. A page reload did **not** fix it, because StrictMode recreates the
   same leak on every single mount. **Any `attach()`/`onEnter()` that starts something
   persistent (a timer, a subscription) must have a cleanup that fully undoes it, and the
   cleanup must actually be wired to the real teardown path, not just the most obvious one**
   (device message unsubscribe here) — test for this with the exact "attach, detach, attach
   again" sequence StrictMode produces (see `test/pushModeController.test.js`'s two regression
   tests for the pattern).
3. **Unthrottled full-grid repaints.** `trackerGridMode.js#paint()` originally sent all 64 pad +
   16 control messages unconditionally on every repaint (e.g. every page turn). Real hardware
   testing showed that volume isn't reliably delivered intact over a sustained burst — some LEDs
   were left stuck showing stale state. Fixed by diffing every send against a per-LED cache
   (see `trackerGridMode.js` above) — not by throttling or batching, since the actual problem
   was redundant *volume*, and most of a repaint's content is usually unchanged from the last
   one. `modeController.js#paintModeButtons()` got the same treatment for consistency (lower
   volume there — 4 messages, not 64-80 — but the same discipline).

## Testing strategy

No physical hardware for the core suite — every module above is constructed with injectable
dependencies (`requestMIDIAccess`, `device`, `store`, `playbackController`, `writeMode`) the same
"overridable for tests" shape already established elsewhere (`audio/lookaheadPlayer.js`'s
`reserveVoiceSlot`/`registerVoice`). `test/pushDevice.test.js` and `test/midiInputSource.test.js`
use fake `MIDIAccess`/port objects; `test/pushModeController.test.js`,
`test/pushTrackerGridMode.test.js`, `test/pushNoteEntryMode.test.js`, `test/pushWriteMode.test.js`,
and `test/patternGridModeStub.test.js` use a fake `device` (`{ onMessage, send }`) and drive a
real `state/store.js` instance (`trackerGridMode.js`/`noteEntryMode.js`'s own write-mode tests
pass a minimal fake `writeMode` — `{ isActive: () => bool }` — rather than a real
`writeMode.js` instance, since isolating "does this content react correctly to write mode" from
"does CC86 toggle correctly" is the whole point of testing each module separately);
`test/pushConstants.test.js` and `test/midiOutput.test.js` test pure formulas and scheduling
logic (the latter with `vi.useFakeTimers()`) respectively.

Hardware was used only to *confirm* already-written, already-tested code — never to
experimentally discover new mappings from scratch (the one exception, `TRACK_SELECT_CC`, was
supplied directly by someone with hands-on Push experience, then confirmed, not guessed). A
useful pattern that emerged: a standalone Node script using
[`@julusian/midi`](https://www.npmjs.com/package/@julusian/midi) (the same native MIDI library
`midi-core`'s own hardware-validation scripts use) is far more reliable for this than driving a
headless-Chromium instance through Web MIDI — a Playwright-based attempt genuinely hung/dropped
messages during this project's own debugging, while the native approach worked cleanly every
time. Reach for that, not a browser automation tool, when a future device integration needs a
quick hands-on check.

## Adding another MIDI controller

Following the shape Push established:

1. **Protocol data first, as plain constants** — notes/CCs/SysEx framing in a
   `src/midi/<device>/constants.js`, LED colors (if any) split into `RAW` (hardware bytes) and
   `PALETTE` (semantic names) in a `colors.js`, same as Push's. If the device already has a
   `midi-core` profile, port the *data* across by hand (read `midi-core`'s
   `src/profile/devices/<device>.ts` and its hardware-validation docs) — don't import
   `midi-core` itself; see "Why no `midi-core` dependency" above for why.
2. **A raw device connection** (`<device>.js`, mirroring `pushDevice.js`) — match the device's
   MIDI port by name (confirm the exact string against the real hardware first, the way
   `pushDevice.js`'s own doc comment explains), expose `{ attach, onMessage, send, isConnected
   }`. Lazy, idempotent connect; a cleanup that fully reverses `attach()`.
3. **Decide what state the device actually needs** — not every controller needs a mode state
   machine; Push does because one physical grid serves three different jobs (note entry,
   tracker grid, future pattern view). A simpler device might go straight to one content
   handler. If you do need mode switching, reuse the `gridContent`-dispatch shape
   `modeController.js` established (`{ onEnter, onExit, onPadOn, onPadOff, onCC, paint }`)
   rather than inventing a new one — and **make sure whatever manages the mode lifecycle has a
   cleanup that calls `onExit()` on whatever's currently active**, not just its own listener
   unsubscribe (see "Lessons from real bugs" #2).
4. **Route input through the existing contracts, don't invent new ones.** A device that can
   play notes should feed `input/noteInputSource.js`'s contract, the same way
   `noteEntryMode.js` does — never write directly into `model/`. A device that controls
   transport/mixer state should read/write through `store.js`'s existing mutators (mute, track
   selection, etc.) exactly like `trackerGridMode.js`'s `onCC` does — never reach into
   `Song`/`TrackChannel` directly.
5. **Diff your LED/display sends against a cache**, the way `trackerGridMode.js` does, if the
   device has more than a handful of LEDs/display cells and might repaint a lot of them at
   once. This isn't optional polish — see "Lessons from real bugs" #3.
6. **Test everything with injected fakes first.** Only use real hardware to *confirm* mappings
   you've already ported/documented, never to discover them from scratch (per the brief that
   shaped this whole MIDI effort) — and prefer a native MIDI library
   (`@julusian/midi`/`node-midi`) over a browser-automation tool for that confirmation pass, per
   "Testing strategy" above.
7. **Wire it into `appContext.js`**, following the Push block there as a template: construct
   the device + content handlers once, build an `attachX()` that attaches the device then
   whatever sits on top of it (mirroring the order `attachPush()` uses), add any note-producing
   content to the shared `noteSources` array, and call `attachX()`/its cleanup from `App.jsx`'s
   effect alongside the existing ones.

## The MIDI settings modal (`src/midi/deviceManager.js`, `ui/chrome/SettingsModal.jsx`)

`deviceManager.js` wraps its own `requestMIDIAccess({ sysex: true })` call (overridable, same
"overridable for tests" shape as everything else above), independent of `pushDevice.js`'s own
connection — a read-only, generic view of whatever Web MIDI currently sees, for the Settings
modal's port listing. It never decides what to *do* with a port; `pushDevice.js` is still the
only thing that connects to anything, and `deviceManager.js` just labels a port `likelyPush` by
reusing `constants.js`'s own `USER_PORT_NAME_PATTERN` (so the UI never re-derives that rule
itself). `getSnapshot()` returns a cached, stable reference (rebuilt only on an actual
access-granted/`statechange` event) — required by `useSyncExternalStore`'s equality check, not
an incidental detail; returning a fresh object on every call infinite-loops React.

`pushDevice.js` additionally exposes `ensureConnected` (already existed internally; now a public
re-connect trigger) and `onConnectionChange(fn)`, fired from the end of `refreshPorts()`.
`appContext.js` wires that straight into `refreshPushState()` — the one function that resyncs
mode buttons, encoders/LCD, and the Play button together (`pushModeController.refresh()` +
`pushEncoderController.refresh()` + `pushTransportController.refresh()`) — so a reconnect (the
device was plugged in after the page loaded, or the Settings modal's own "Reconnect"/"Refresh
Push State" buttons) always leaves every LED/LCD line matching live state, never stale.

A `refresh()` on each piece deliberately never re-calls `onEnter()` (which owns store
subscriptions) — only resets that piece's own LED/LCD diff cache and repaints — so a manual
refresh can't produce the same StrictMode-style leaked-subscription bug `modeController.js`'s
own `attach()` cleanup was built to avoid (see "Lessons from real bugs" #2 below).

## Boundaries (what this deliberately doesn't do yet)

- **No Pattern view.** `patternGridModeStub.js` is the placeholder; see "Boundaries" in that
  file's own doc comment.
- **No per-port device selection for generic MIDI input/output.** The Settings modal lists every
  detected port for visibility, but `input/midiInputSource.js` still attaches to every connected
  input indiscriminately (no per-device filtering exists anywhere in this app) — Push is the only
  device with real connect/reconnect semantics today, so that's the only "connect" action the
  modal gives real behavior to.
- **No voice-stealing/poly-mono policy for MIDI output.** A MIDI-output instrument sends one
  Note On/Off pair per event with no cross-event bookkeeping (see "Scheduling" above) — a
  track's `voiceMode`/`maxVoices` policy (`model/trackChannel.js`) only governs sample-output
  voices today.
- **No scale/quantization feature.** Nothing in webtrack (keyboard, MIDI, or Push input) applies
  a musical scale to incoming notes — if one gets added later, it belongs between
  `noteInputSource` and the model (inside `editController.js#handleNoteOn`, or a
  `model/scale.js` it calls), so it's automatically shared by every input source rather than
  needing to be duplicated into MIDI/Push code specifically.
- **No generic device registry, capability negotiation, or routing graph**, on purpose — see
  "Why no `midi-core` dependency" above. If a second real device is ever integrated, revisit
  whether any of `modeController.js`'s shape is worth generalizing *then*, with two real
  examples in hand instead of one speculative one.
- **Write mode's `cellEdit` encoder display doesn't cover cell FX automation
  (`Event.fx`/`ui/chrome/NoteEditor.jsx`'s CELL FX section).** That list is sparse and
  variable-length per cell/track — it doesn't fit the fixed 8-encoder layout the other 7 fields
  (note/instrument/velocity/length/pan/effectCommand/effectParam) already use. A future stage
  could page through it the same way `encoderController.js`'s own FX mode already pages
  `fxChain` entries, reusing `fxPageIndex`'s precedent rather than inventing a new windowing
  scheme.
- **Write mode never auto-scrolls `trackerGridMode.js`'s step window** to bring a newly selected
  cell into view (e.g. a UI-driven cursor move to a step outside the current 8-step page) — the
  selected-cell cursor color simply isn't visible until the user pages there themselves, same as
  the playhead already behaves outside the visible window.

## In a plugin host

A plugin host (webvst) provides `navigator.requestMIDIAccess` itself, returning a MIDIAccess with one extra input,
"WebVST DAW MIDI", fed by the host's MIDI. Nothing here changes: `createMidiNoteSource()` already wires every connected
input, so the host's notes audition and enter like a keyboard's (verified against this module). The port name matches no
Push pattern, so `pushDevice.js` ignores it, and no outputs are offered (MIDI output instruments find no port there).

### Native MIDI routing (low latency, works with the window closed)

When the host can play MIDI itself (`capabilities.midiRouting`, webdsp `docs/midi-routing.md`: a plugin with protocol 2), the page does not play
MIDI notes. `audio/midiRoute.js` declares a *route*: what the audition of the selected instrument on the cursor's track plays (a sample from
its root note, or one chop slice per key; a synth from its root note, released on key-up for sustained kinds like the Bass; scaled by the track
volume; mono and choke group carried). The host then plays incoming notes on its audio thread, sample-accurately. The route is re-declared when
the cursor, selection, track settings, instruments, scale or resample status change, and withdrawn (the page plays again) when it cannot
be expressed: a muted track, a MIDI-output instrument, nothing loaded yet, a resample in progress, or Snap on (the page snaps a played note to the
scale before it is heard and written; a raw key would not be).

The note is still delivered to the page for note entry; `input/midiInputSource.js` flags it `routed: true` while the host is playing, and
`editController.js` then enters it into the pattern without also auditioning it. Without `midiRouting` (a browser, an older plugin) nothing changes.

The note source's `attach()` used to share one `detached` flag across calls, so after any detach every later attach was ignored; under React
StrictMode (dev server) the MIDI input never worked. The flag now belongs to each attach call.
