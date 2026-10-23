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
