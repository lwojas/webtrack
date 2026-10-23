# The project in a host's session

When a host with its own sessions is present (`getHostState()` from webdsp, e.g. a DAW plugin), the project is saved there
instead of in the page's storage. In a browser `getHostState()` is null and nothing here runs. Contract: webdsp's
`docs/host-state.md`.

- `persistence/hostState.js`: the snapshot is the same record the local recovery write already builds (the project
  serialized with sample *references*, `embedSampleBytes: false`) as JSON, with each sample's bytes as a blob keyed by its
  `localAssetId` (from the instruments in memory). Stamped `app: "webtracker"`, `format: 1`; the project inside keeps its
  own `formatVersion`.
- **Publishing** rides the existing debounced recovery writer: with a host, its write publishes instead of writing
  IndexedDB. Only edits publish.
- **Restoring**: `hostState.onRestore` answers once with the saved snapshot, or `null` for a new session.
  `restoreFromRecovery(record, { getLocalAssetBytes })` installs it, with the bytes from the snapshot's blobs. Another
  app's snapshot, an unknown format or unreadable data means "start fresh".
- **The demo kit** (loaded over slots 0 and 1 on the first gesture) must not overwrite a restored project, so in a host it
  waits for the answer (`hostRestored`): skipped when a project was restored, loaded as usual on `null` or when the host
  does not answer within 3 s.
- **In a host there is no gesture veil** (the runtime needs no click) and no local recovery slot or restore prompt (a
  shared slot would be shared by every instance). Saving a project file leaves the host session tracking the project.
