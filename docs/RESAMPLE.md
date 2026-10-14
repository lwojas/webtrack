# Resample, local asset storage, and the recovery cache

How webtracker captures its own playback into a new instrument, where that audio lives between
page loads, and how the local recovery cache differs from an explicit project save. Read
[`ARCHITECTURE.md`](ARCHITECTURE.md) first — this assumes you know the module map, the
Song/Event data model, and the lookahead-scheduler timing architecture.

## What this is

A header-bar control — `[ RESAMPLE ] [ 16 STEPS ▾ ]` (`ui/chrome/TransportBar.jsx`) — that
captures exactly N tracker steps of whatever's currently playing (master-bus output, after every
track's FX and the master FX chain) into a brand-new instrument slot, synced to the exact same
timing model normal playback uses. There is no wall-clock recording, no `MediaRecorder`, and no
second timing system: the capture window is an absolute engine-time range
(`webdsp`'s `AudioRuntime.armCapture({startTime, stopTime})`), the same domain as
`getCurrentTime()`/`schedule()`'s `ScheduledEvent.time`.

This required no `webdsp` engine change — `armCapture()` already existed (see its own
`ARCHITECTURE.md`, "How armed capture works") and already does exactly what this needs: a
sample-accurate window of a bus's fully-processed output, pre-flighted against
`getCapabilities().maxCaptureSeconds` (30s) so an over-long request is refused synchronously
rather than silently truncated. webtracker just never called it before this feature.

[`webseq`](../../webseq) (a sibling tracker on the same `webdsp` dependency) is the reference
implementation this is modeled on — its own `audio/transport.ts#armResample()` arms a capture
against the next boundary its lookahead scheduler is about to schedule. The one real difference:
webseq resamples *one full iteration of a specific pattern*; this resamples *the next N tracker
steps, whatever pattern(s) they belong to* — simpler, and it works across a pattern-queue
boundary during playback for free, since the step grid (`audio/lookaheadPlayer.js`'s
`stepCounter`) doesn't care which pattern is logically selected at any given step.

## The arm/capture flow

1. `ui/chrome/TransportBar.jsx`'s Resample button calls `appContext.js#handleResample(steps)`.
2. That calls `audio/playbackController.js#armResample(steps)`, which delegates to
   `audio/resampleController.js#arm()` — refused synchronously (no engine call at all) if
   nothing is playing, a resample is already in progress, or `steps * stepDurationSeconds`
   exceeds `maxCaptureSeconds`.
3. `audio/lookaheadPlayer.js`'s `tick()` calls the new optional `onStepScheduled(stepTime,
   stepDurationSeconds)` hook once per step, with that step's own *unswung grid time* — before
   swing's scheduling-time delay is added, and before that step's notes are compiled. Arming
   only ever happens between `tick()` calls (it's triggered by a UI click; JS is
   single-threaded), so whichever step `onStepScheduled` next reports is, by construction, the
   first one that hadn't been scheduled yet when `arm()` was called.
4. `resampleController.js#onStepScheduled` sees the armed request, computes
   `[stepTime, stepTime + steps * stepDurationSeconds)`, and calls `runtime.armCapture()` with
   that exact window. Using the grid time (not the swing-shifted moment notes actually fire)
   keeps the result's duration exactly `steps * stepDurationSeconds` regardless of swing: swing
   only ever shifts odd-indexed steps within a pair and never changes total duration over an
   even step count, and every supported length (4/8/16/32/64) is a power of two.
5. `armCapture()`'s result resolves with `{ metadata, channelData }` — `channelData` is one
   planar `Float32Array`-backed `ArrayBuffer` per channel, at the engine's own sample rate.
   `metadata.id` is already a live, triggerable `sampleId` in this session (`armCapture()`
   registers the capture as a runtime `Sample` itself — no separate `loadSample()` round-trip
   needed, unlike a freshly-picked file).
6. `appContext.js#handleResample` encodes that PCM as a 16-bit WAV (`audio/wav.js#encodeWav` —
   the smallest encoding `decodeAudioData` reads back universally), creates a new instrument slot
   named `Resample <steps>st-<NN>`, and assigns the result via the same
   `applyInstrumentSample()` every file-picked import goes through — see "Instrument origin and
   local asset storage" below for what that does differently for a generated sample.
7. Status (`"idle" | "armed" | "processing" | "complete" | "error"`) is reported through the
   store (`state/events.js#RESAMPLE_STATUS_CHANGED`) rather than returned, since the UI needs to
   show progress while `armed.result` is still pending, not just the final outcome. It's a
   handful of transitions per resample, not a per-frame value, so it's an ordinary store event,
   not a `requestAnimationFrame` poll the way the playhead is.

Stopping playback (`playbackController.js#stop()`) cancels any armed-but-not-yet-capturing
resample. Once the engine has actually started capturing there's no wire to cancel it (`webdsp`'s
`Capture` has no cancel — it runs to completion); `resampleController.js#cancel()` still rejects
the caller's promise immediately either way, so a resample can never hang forever, and the
capture's eventual (now-unwanted) resolution is simply ignored — a settled promise can't be
re-settled.

## Why 64 steps, and why it's safe

64 steps is 4 bars at this tracker's fixed `STEPS_PER_BEAT = 4` (`model/timing.js`). At every BPM
the transport bar allows (40–300), 64 steps' estimated duration is well under `webdsp`'s 30s
capture cap — the worst case, 40 BPM, is 24s. The captured buffer itself is a few MB, transient
(stereo float32 PCM at the engine's sample rate, freed once WAV-encoded and handed to IndexedDB),
never retained beyond that — there's no streaming/chunking concern at this scale, and no reason
to raise the ceiling without a real request for longer captures.

## Instrument origin and local asset storage

`model/instrument.js`'s `Instrument.origin` (`"import" | "resample"`) is pure provenance — the
Instrument Panel's `· R` badge — never read by `audio/compile.js`: a resampled instrument plays
exactly like an imported one once it exists.

Every instrument's sample bytes — import or resample — also get a `localAssetId`
(`persistence/localAssetStore.js`, an IndexedDB-backed store), written once at load time,
fire-and-forget, off the critical path. This is what lets `persistence/projectFile.js`'s
`serializeProject({...}, { embedSampleBytes })` do two different things depending on context —
**origin plays no part in this decision**, only `embedSampleBytes` does:

| | `embedSampleBytes: true` (explicit Save) | `embedSampleBytes: false` (recovery snapshot) |
|---|---|---|
| **import-origin** | embedded as base64 | referenced by `localAssetId` |
| **resample-origin** | embedded as base64 | referenced by `localAssetId` |

An explicit Save embeds *every* instrument's bytes, resample-origin ones included: if a saved
project is reopened by someone else, or on a different browser/profile, a resampled instrument
comes back exactly as playable as an imported one — there's no reason a `.json` someone emailed
you should silently lose a resample just because of where the audio came from, especially since
anyone who re-saves that reopened project embeds the exact same bytes right back into their own
copy anyway. Only the local recovery cache (never shared, never exported) stays reference-only,
for both origins — see below for why that one's deliberately cheap rather than portable.

## The local recovery cache (`persistence/recovery.js`)

Separate from, and far lighter-weight than, an explicit Save: `appContext.js` subscribes a
debounced (1.5s) writer to the store's song-shape-changing events (cell edits, pattern/track
structure, FX, mixer, project name, instrument changes — deliberately *not* `CURSOR_MOVED` or
`CLIPBOARD_CHANGED`, which are session-only and never read by `serializeProject()` anyway). Each
write calls `serializeProject({...}, { embedSampleBytes: false })` — every instrument (either
origin) becomes a `{localAssetId, mimeType, fileName}` reference instead of an embedded copy —
and stores the result in
IndexedDB's single `recovery` slot. The debounce exists so a burst of edits (one `CELL_CHANGED`
per keystroke) collapses into one write, not one per event; the reference-only shape exists so
that write is cheap regardless of how large the project's samples are, since the one potentially
large part — the bytes themselves — was already written once, at load/resample time, and is never
touched again by this path.

On startup, `App.jsx` calls `appContext.js#checkForRecovery()`; a non-null result shows a banner
offering **Restore** or **Discard**. Restoring (`restoreFromRecovery()`) re-resolves every
instrument's bytes from `localAssetStore` (the same `deserializeProject()` entry point an
explicit JSON load uses, just sourced differently) and loads it the same way
`loadProjectFromFile()` does.

**Keeping one project's recovery from leaking into another's** (the thing to get right here): a
per-open-project `currentProjectId` (minted fresh on every explicit load/restore) is written
alongside each snapshot, and — more importantly — `recoveryScheduler.cancel()` is called
*before* `currentProjectId` is reassigned and the new project replaces the old one in the store.
Without that ordering, a debounced write already in flight for the project being replaced could
land *after* the swap, silently overwriting the recovery slot with stale data under what's now
the wrong project's identity. An explicit Save also clears the recovery slot outright
(`dismissRecovery()`) — the snapshot only ever existed to cover the gap *before* a save, so it
would otherwise just produce an unnecessary "restore unsaved session?" prompt for a session the
user already saved and closed normally.

## What this doesn't do

- **No asset garbage collection.** A sample's `localAssetId` entry in IndexedDB isn't deleted
  when an instrument slot is reassigned or the project is abandoned. Acceptable for now (per-user
  browser storage, not a shared resource) — a real GC pass would need a reachability scan across
  every saved/recovered project reference, which is more infrastructure than this feature's scope
  justifies without a real storage-pressure complaint to size it against.
- **No multi-project recovery history.** One recovery slot (IndexedDB's fixed `"latest"` key),
  matching most trackers'/DAWs' own single-autosave-slot convention — not a per-project history.
- **No restriction on downloading a sample back out.** `ui/chrome/InstrumentPanel.jsx`'s
  per-slot DOWNLOAD button (next to LOAD) works identically for an imported or a resampled
  sample, with no gating. This app is local/offline and distributes nothing on its own; an
  explicit Save already embeds every sample's bytes in the exported `.json` regardless, so a
  download button doesn't expose anything that path doesn't already. Respecting whatever
  license a user's own imported audio carries is the user's responsibility, not something this
  app enforces.
