# Following a host transport

When the audio runtime is hosted by something with its own clock (a DAW plugin), the tracker follows it.
In a browser nothing here runs: `runtime.onHostTransport` never fires. Contract: webdsp's
`docs/host-transport.md`.

- `audio/hostSync.js` watches `runtime.onHostTransport` and drives `playbackController.playAt(step, at, bpm)` /
  `stop()`. Host positions are quarter notes; tracker steps are sixteenths (`STEPS_PER_BEAT`).
- `playbackController.playAt` maps a step count from the start of the pattern queue (wrapping) to a queue entry and
  row, and starts the lookahead player there (`start({ initialRow, startAt })`). Rows before the start are never
  scheduled. The song's BPM is not touched; while following, the transport uses the host tempo
  (`hostBpm`, cleared by every stop) and the BPM field shows it read-only ("BPM · HOST").
- Policy: restart at the host's position when it starts, locates or loops; re-anchor on a tempo change; stop when the
  host stops, but only if the host started the playback. A Stop pressed by hand is respected until the host next
  starts or jumps.
- A host with no user-gesture requirement (`hasEmbeddedHost()`) gets its runtime at startup (`appContext.js`) so the
  first host start is not missed.
- Known limits (v1): a tempo change restarts the schedule (notes already sounding are cut), and a host loop wrap
  resyncs after the fact rather than pre-scheduling across the loop point.

## Native sequence (the host plays the song)

A host that reports `capabilities.nativeSequence` (the WebTracker plugin) plays the song itself, so playback survives
closing the plugin window and renders in an offline bounce. The page stays the editor. Contract: webdsp
`docs/native-sequence.md`.

- `audio/nativeSequence.js` compiles one cycle of the pattern queue into a webdsp `Sequence` (quarter notes). It is not a
  second compiler: every row goes through the same `compileRow` / `compileRowAutomation` the lookahead player uses, at a
  fixed 120 bpm (so seconds map exactly to quarter notes). Tempo is the DAW's, applied per block by the host.
- `audio/nativeSequenceSync.js` sends it on every project change (after 150 ms, so a burst is one send) and re-checks
  once a second for the engine becoming able to play more of it (a sample finished loading, an instrument or effect was
  created). Only a changed result is sent; a new runtime gets it again.
- `hostSync` (`native: true`) never calls `playAt`. While the host plays it hands the playback controller
  `attachHost(t)` (the newest mapping; the playheads read the position from it); a host stop calls `detachHost()`.
  While attached, Play/Stop do nothing (the host owns the transport), pattern switching and resample are refused.
- Not played natively: MIDI-output instruments (the page's Web MIDI out), `bus.gain` cell automation (it has no
  scheduled form), and a track's poly voice limit (`maxVoices`; mono is kept). A queued manual pattern switch is the
  page's; in a plugin, edit the queue instead. Track LFOs are evaluated on the 120 bpm reference clock.
