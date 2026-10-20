# Project scale and per-track arpeggiator

Client-only (webdsp untouched). `src/model/scale.js` and `src/model/arp.js` are line-for-line ports
of webseq's `scale.ts`/`arp.ts` (docs/scale-and-arp.md there) with the same test vectors; this file
covers what is tracker-specific.

## Scale (`song.scale`)

`{ root, scale, snap, preset }`, default chromatic; normalised on project load (no format bump, old
files open as chromatic, no note is touched). `store.setScale(patch)` emits `SCALE_CHANGED`; picking a
musical preset also sets the edit octave to the preset's suggestion.

- Transport bar `ScaleControl`: root, scale, preset list ("inspiration, not definitions"), SNAP.
- Grid: a note outside the key gets `.tracker-cell__note--out-of-scale` (dimmed), repainted on
  `SCALE_CHANGED`. Cells stay fully editable; typing a note in the Note Editor is never snapped.
- Note entry (`input/editController.js`): with SNAP on, played notes (computer keyboard and MIDI
  input) are snapped to the nearest scale note, for audition and write alike. **Shift** on a letter
  key bypasses it (`chromatic` in the note-on payload). Push note-entry is not snapped.

## Arp (`trackChannel.arp`)

Track-level, so it survives pattern switches like mute/LFO. Config shape and generation are as in
webseq. Tracker specifics:

- Seam: `audio/compile.js#compileRow`. If `isArpActive(channel)`, the row's events come from
  `arpEventsAtRow(track, localStep, arp, noteDurationSteps)` (`model/arp.js`), each compiled with
  `compileEvent` at `time + offset * stepDuration` and `duration = steps * stepDuration`. Arp off: the
  original code path, unchanged. Because everything goes through `compileEvent`, samples, synths,
  MIDI output, per-note pan, Track LFO and voice limits behave as for ordinary notes — one arp, no
  separate "MIDI arp".
- Source: a bar is 16 rows. The notes (with an instrument) in the bar are the pool; each note's
  length (`noteDurationSteps`, explicit or auto) is its gate window, clipped to the bar and to the
  track's own loop length. A note still sounding at a bar line carries into that bar as a run
  starting on the line (cut short by the bar's first note), so long notes keep arpeggiating. A row is compiled on its own: the bar is re-expanded each tick (<=16 rows)
  and only steps starting in `[row, row+1)` are emitted, so there is no state between ticks and
  looping, queued patterns and polymetric lengths stay deterministic. Empty rows inside a window sound.
- Sub-row steps (1/32, triplets) are placed at straight offsets inside the row; swing delays the row,
  and so its sub-steps, as a block.
- UI: "Arp" module in the Track tab (`ui/chrome/TrackPanel.jsx`); velocity step bars are drawn by
  dragging. Velocities show 0-127.
- Persistence: `projectFile.js#ensureScaleAndArpDefaults` — a present arp is normalised, an absent one
  stays absent.
