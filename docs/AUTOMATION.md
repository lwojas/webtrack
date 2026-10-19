# Automation and modulation

How a tracker moves parameters over time. Same model as webseq's
(`webseq/docs/modulation.md`) and webdsp's (`webdsp/docs/modulation.md`): **a parameter has a base
value; automation and LFOs are sources that move it; the engine resolves the stack.** What differs is
the shape of the host: tracks are vertical, and things happen because a *cell* says so.

```text
Parameter (FX instance param | instrument slot param)
  ├── Cell automation   sparse values (Event.fx) on the track's rows -> the parameter's BASE value
  └── LFO, LFO ...      webdsp's engine LFO bank, added on top of the base in the DSP
```

## Cell automation (the data)

A cell value means "from this row onward this parameter takes this value", or, with **glide**, "ramp
from this value to the next value of the same parameter on this track". It lives in `Event.fx`
(`model/event.js`), and `model/cellAutomation.js` reads all of it uniformly through one key scheme
(a string; also a lane's id in the editor and the key of `Event.fx.glide`):

| Key | Targets | Stored in |
|---|---|---|
| `bus.gain` | the track bus's output gain | `fx["bus.gain"]` (flat) |
| `fx:<instanceId>:<paramId>` | one parameter of one FX chain instance | `fx.instances[id][param]` |
| `inst:<slot>:<paramId>` | one parameter of one **instrument slot** | `fx.instruments[slot][param]` |

Instruments are global, not bound to a track, and a track's cells may use several, so an instrument
entry names its **slot explicitly**; it is never inferred from "the instrument of this note". The
slot may be a synth (its continuous controls; stepped switches such as Legato are left out) or a
sample (its ADSR). The automation is the *cell's*, so two tracks can write the same instrument
parameter: the last write wins, and the instrument panel marks such parameters (below).

Rules, enforced in `model/mutations.js#setCellAutomation`: a new value is refused if its target does
not exist (an FX instance not in the track's chain, a slot or parameter that is not there), and is
clamped to the parameter's range. Removing an FX instance purges its entries (and glide flags) across
the track; changing an instrument slot's kind, or switching it between synth / sample / MIDI, purges
that slot's entries everywhere (`purgeInstrumentAutomation`). `bus.gain` cannot glide (see below).

`glide` is a set of keys on the cell (`fx.glide`), so a ramp costs one flag per entry, and it only
ever qualifies a value: removing the value removes the flag, and a cell whose only content is a flag
is empty.

## Playback: scheduled on the audio clock, live only

`audio/compile.js#compileRowAutomation` turns the cell a track is on (folded through the track's own
loop, `trackLocalStep`, like everything else) into descriptors; `audio/automation.js` resolves them to
webdsp `scheduleParams` events (`docs/scheduled-params.md` in webdsp) at that step's swung time:

* a plain entry is a **step** at the step's time;
* a **glide** entry is one event `{from: its value, value: the next point's value, ramp: the time to
  that row}`, found inside the track's loop with no wrap (after the last point a value just holds).
  The next cell's own entry steps to its value where the ramp ends, so the two agree. Ramps are
  linear in the parameter's units.

Events land at the start of the 128-frame render block containing their time (about 2.7 ms), before
that block's notes. Automation writes the **base** in the engine only: the model keeps the authored
base (`trackChannel.fx`, `instrument.instrumentParams`, `instrument.envelope`) and the engine's LFOs
ride on whatever base is playing. **Nothing is written back into the model during playback.** On stop
(`playbackController.stop`) queued events are cancelled and the authored value of every parameter
automation touched is written back (a direct write also ends a ramp still running). Consequently the
FX panel and instrument panel keep showing the authored base while a song plays.

`bus.gain` is the one entry with no scheduled form (webdsp's scheduled parameters do not cover bus
parameters), so it keeps the older immediate path: applied at the ~25 ms tick, also latched into the
model so the Output slider follows it. It cannot glide.

## Editing

* **Note Editor, CELL AUTOMATION**: the selected cell's entries, one slider each, labelled by target
  ("Filter #2 — Cutoff", "00 Bass — Cutoff"); `~` toggles glide, `▤` opens the lane in the editor,
  `×` removes. `+ ADD` offers the bus gain, each parameter of the track's FX instances and each
  sounding instrument slot's parameters, seeded at the parameter's current base value so adding
  changes nothing audible.
* **Automation editor** (`ui/chrome/AutomationEditor.jsx`, opened from the Note Editor): one lane of
  the cursor's track drawn across that track's own loop, under the grid like the chop editor. It is a
  view over the cells, not a second model: a point **is** the cell at its row; clicking the lane adds
  one, dragging moves it (row and value), Delete removes it, `G` toggles its ramp. The horizontal axis
  is the track's loop length, so polymeter and length changes need no special handling (rows past the
  loop point stay in the data but are not drawn or played). It states the lane's extent ("64 steps · 4
  bars"), draws bar and beat ticks, uses a log vertical axis for Hz / seconds parameters, and scrolls on
  its own when the loop is too long to fit at a tappable row width.
  New points ramp by default (RAMP / STEP toggle), since smooth is what volume and filter moves want;
  a ramp point is drawn round, a step point square.
* **Shapes** (`model/automationLane.js`): Ramp up/down, Fade in/out, Swell, Filter wobble, Up/down,
  Sine, Pulse, Saw up/down, in normalized coordinates (t 0..1 across the region, v 0..1 across the
  parameter's range) so they fit any loop length and parameter. Range: ALL, BAR 1, LAST BAR (shown
  only for a loop longer than a bar). Ramps become glide points; pulse and saw are held steps with real
  jumps; fades on a dB gain end at unity, not at the boost maximum; log parameters are subdivided so a
  sweep is exponential. A shape replaces only its region's points of that lane; CLEAR empties the
  lane. The library is one list (`AUTOMATION_TEMPLATES`), same shapes as webseq's.
* **Markers**: a parameter name carries **A** if some cell in the song automates it and **L** (with a
  count) if LFOs target it, in the instrument panel and the FX panel (`ui/chrome/ModBadge.jsx`).

## LFOs and the Utility FX

* Every FX instance has the same stackable LFO bank as a synth (webdsp `setEffectLfo`): the MODULATION
  section of each FX module, built from the same `LfoEditor` the instrument panel uses. LFOs are stored
  on the chain entry (`entry.lfos`) by catalog param id; which parameters are targets comes from the
  engine (`getEffectModulationTargets`), never from a list here. Delay time and stepped controls are not
  targets.
* **Utility** is an addable FX kind (`utility.gain`, dB, -60 = silence .. +12): the automatable track
  volume. The mixer's `bus.gain` stays the track's plain mix state. Put a Utility first in a chain for
  "track -> Utility -> other FX" and automate its gain from cells (a fade is Fade in / Fade out over a
  few bars).

## Limits

Automation is block-granular (see above); a per-note instrument parameter set a few frames after its
note in the same block lands about 2.7 ms early (webdsp's optional phase 2 removes that). A glide does
not wrap around the loop, and a ramp already running when a pattern switch happens finishes to its old
target. Master-bus FX cannot be automated from cells (as before).

Tests: `test/cellAutomation.test.js` (keys, model rules, compile, player routing, the scheduling
bridge, restore), `test/playbackAutomation.test.js` (the real playback controller against a faked
runtime), `test/automationLane.test.js` (curve, mapping, templates), `test/fxLfos.test.js`.
