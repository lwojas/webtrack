# Choke groups

A **choke group** makes tracks cut each other off: a note on one track silences the sounding voices of the
*other* tracks in the same group, at that note's exact start. The classic case is a closed hi-hat cutting an open one.

## Using it

The **C** select in the voice row under LEN (next to Poly/Mono and max voices) sets a track's group: `-` for none,
`C1`..`C8` otherwise. Every member of a group can cut every other. A track never cuts itself; its own overlapping
notes follow **Poly/Mono** unchanged. Sample and synth-instrument tracks share the same groups, so a synth closed hat
cuts a sample open hat. MIDI-output instruments have no engine voices and are not affected.

## How it works

`trackChannel.chokeGroup` (`null` or a positive integer, `model/trackChannel.js`) is song-level like mute/solo, so it
survives pattern switches. `audio/compile.js#compileEvent` stamps it on each sample event and synth note, and the
lookahead player and `audio/preview.js` pass it to webdsp (`TriggerParams`/`InstrumentNoteParams.chokeGroup`). The cut
is made by the engine on the audio thread at the new note's exact frame (~2 ms fade, ignores the release), so it is
sample-accurate and needs no tracker-side bookkeeping. See webdsp `docs/choke-groups.md`. Because webdsp tells sources
apart by bus and every track has its own, "another track" needs no extra work.

Not the same as **Mono** (a track against itself) or voice stealing (the engine's pool is full).

## Simultaneous notes

The engine resolves two same-frame triggers in queue order and has no priority concept. The tracker makes it fixed:
when two tracks in one group start a note at the same instant, the **later track wins** and the earlier track's note
is not played (`compile.js#dropSimultaneousChokeLosers`, applied per step in `compileRow`). Notes at different times
follow the normal rule: the later one cuts the earlier. One track's own simultaneous notes (arp chords) never drop each other.

## Persistence

`chokeGroup` is saved with each track channel (and in the recovery cache). A project saved before this loads as none
(`projectFile.js#ensureVoiceDefaults`); no migration. Tests: `test/chokeGroup.test.js`.
