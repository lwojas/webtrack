# Chords

A chord is a modifier on a note, like ratchet or tie: the cell's **NOTE is the chord's root** and `Event.chord` says what is stacked on it.
Nothing stores the notes it sounds as, so the grid, copy/paste, fill and the one-event-per-row model are unchanged.

```
Event.chord = { type, inversion, spread, offsets? } | null
```

| Field | Meaning |
|---|---|
| `type` | a `CHORD_TYPES` id (maj, min, 7, maj7, sus4, 6/9, 13 ...), a scale type `dia3` / `dia4` / `dia5` (every second note of the project scale: the quality follows the key; a chromatic project falls back to a major stack) or `custom` |
| `inversion` | 0 = root position; n moves the n lowest tones up an octave |
| `spread` | `close`, `open` (2nd tone up an octave), `drop2` (2nd from the top down an octave), `wide` (every other tone up) |
| `offsets` | `custom` only: semitones above the root, ascending (1 to 5 tones) |

`model/chord.js` is the one place that turns a chord into notes (`chordNotes`). At most `MAX_CHORD_VOICES` (5) tones.

## Editing

Note Editor, **CHORD** row, opens the chord editor under the grid. It has the on/off toggle, type, inversion, spread, a PLAY audition and a
keyboard showing the tones (root in amber). Clicking a key adds or removes a tone and turns the chord into a `custom` one. Moving or retyping
the cell's note moves the whole chord. While a chord cell is under the cursor in edit mode, notes you play audition (and write) as that chord.
A chop slot plays slices, not chords, and an FX send track holds no notes, so neither can have one.

## Playback

`audio/compile.js#compileEventTones` expands a chord event into one trigger per tone (same time, length, velocity, pan, ratchet), so everything
downstream (lookahead player, native sequence, preview) sees ordinary events. The Track LFO's note target moves every tone.

- **Sample slots**: one voice per tone through the normal voice machinery (a track's mono/poly limits apply to the tones).
- **MIDI output**: one note per tone.
- **Synth slots**: a webdsp instrument is monophonic, so tone *i* sounds on its own engine instance. The slot keeps its own instance
  (`engineInstrumentId`, tone 0) plus `engineVoiceIds` (tones 1..n-1), created on the same bus with the same controls. Controls, LFOs and cell
  automation are applied to every instance (`audio/instrument.js`, `audio/automation.js#toExtraVoiceParams`). The count follows the largest chord
  any cell uses on the slot, across all patterns (`voicesNeededForSlot`), re-synced (debounced) after cell/queue/instrument edits and on project load.
  If the engine refuses another instance, the remaining tones share the last one that exists.
- **Tie**: only the lowest tone glides into the next note; the other tones re-attack.
- **Arp**: an arp-enabled slot plays its notes as written (the arp reads the pitches of the track), not as chords.

Ids are session-only and never saved; only `Event.chord` is.
