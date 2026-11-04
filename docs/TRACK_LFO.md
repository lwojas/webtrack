# Track LFO

A track-level LFO that modulates **event** properties: the **velocity** of the steps that opt
in, or their **note / slice** (the Target selector). It is a sequencer concern: it acts when a step is scheduled, never inside the synth. (The
synth's own continuous LFOs are the Modulation section of the instrument editor; see webdsp's
`docs/lfo-modulation.md`.) Same behaviour as webseq's Track LFO (`webseq/docs/track-lfo.md`).

```text
event.velocity (authored)
        |  + lfo(eventTime) x depth x event.lfo x 127
        v
effective velocity --> compileEvent --> sample / synth / (MIDI) event --> engine
```

## Data (in the project, all optional)

| Where | Field | Meaning |
|---|---|---|
| `trackChannel.eventLfo` | `enabled, target ("velocity" \| "pitch"), waveform, sync, rateHz, division, depth` | the LFO. Per song, like mute/solo/volume, so it survives pattern switches. |
| `Event.lfo` | 0..1 or `null` | the step's participation. `null` = plays at its own velocity. |

Effective velocity is never stored. `effective = clamp(round(velocity + lfo * depth * Event.lfo *
127), 0, 127)`, `lfo` in -1..1, `depth` 0..1 of the full range (shown as %). Rounded so a MIDI
consumer of the same event stays valid. Projects without these fields play exactly as before (tested).

### Note / slice target

With target `pitch` the velocity is left alone and the LFO moves each participating step along the
notes its instrument can play: every slice of a chop instrument (root note = slice 1), otherwise
notes 0-127. The authored note is the centre; it moves `lfo x depth x Event.lfo x (notes - 1)`
places, rounded and clamped to the ends (depth 100% can reach any note). `audio/trackLfo.js#effectiveNote`;
the stored note is never changed, and the project scale is not consulted. Same behaviour as webseq.

### Waveforms

Waveform is webdsp's, including **sample & hold** (a new random value each cycle, held flat; a hash of
the cycle number, so it replays identically). It is also available on the instrument and FX LFOs.

## Timing and phase

`audio/compile.js#compileEvent` evaluates the LFO at the event's own **scheduled time** (swing
included), through `audio/trackLfo.js`, which calls webdsp's `lfoValueAt` (a TypeScript mirror of the
engine's LFO, parity-tested in webdsp). No second clock: `audio/lookaheadPlayer.js` passes
`{ anchorTime: startTime, bpm }`, the same anchor and tempo it gives `runtime.setTempo`.

* **Sync**: cycle = `(time - anchor) / (60/bpm x division beats)`. **Free**: `(time - anchor) x rateHz`.
* The anchor is the playback start, so the LFO restarts when playback starts and runs on across
  pattern switches and queue advances (the LFO belongs to the track, not a pattern). A live BPM change
  re-announces the tempo with the same anchor, so a synced LFO re-derives its phase from the new tempo
  (as webdsp's synced synth LFOs and Pulse do).
* Auditions/previews are not modulated. MIDI output is untouched code-wise: it just receives the
  resulting velocity of the normal event.

## UI

* **Track tab** (Mixer | FX | **Track**, contextual to the cursor's track): a Track LFO card (Enabled,
  Waveform, Mode Sync/Free, Rate as a division or Hz, Depth, target Velocity) and a Steps card
  (count, All steps / None). Length and polyphony stay in the grid's header rows above the columns.
* **Per step**: the Note Editor's TRACK LFO slider, and an amber underline on the velocity of steps that
  take part (no extra number in the grid).

A further target later = one more `target` value and one more case in `audio/trackLfo.js`.
