// Debounced local-recovery writer + restore path. Deliberately split from
// persistence/localAssetStore.js (the actual IndexedDB glue, not unit-tested — see that
// module's own doc comment) so the part that actually matters for correctness — what gets
// written, and when — stays a plain, DOM-free function test/recovery.test.js can drive with
// fake timers and an injected writer, the same split persistence/projectFile.js (pure) /
// projectIO.js (browser glue) already uses.
//
// What's written is always project *state*, never binary audio — serializeProject()'s own
// embedSampleBytes:false path turns every instrument's sample (either origin — see
// model/instrument.js's origin doc comment) into a {localAssetId, mimeType, fileName}
// reference. That's what keeps this cheap enough to run on every meaningful edit after a short
// debounce: the song/pattern data serializeProject() builds is plain, small JSON, and the one
// potentially large part — sample bytes — is written exactly once, at load/resample time
// (appContext.js#applyInstrumentSample), never touched again by this path.
import { serializeProject, deserializeProject } from "./projectFile.js";

const DEBOUNCE_MS = 1500;

// writeRecoveryState: (record) => Promise<void> — persistence/localAssetStore.js#putRecoveryState
// in production, a plain mock in tests. getNow: () => number, overridable for tests.
export function createRecoveryScheduler({ writeRecoveryState, debounceMs = DEBOUNCE_MS, getNow = () => Date.now() }) {
  let timerId = null;

  // projectId: a per-open-project identity appContext.js assigns (fresh on every explicit
  // load, so a pending write for a project that's just been replaced can't land under the new
  // one's slot — appContext.js cancels any pending write before swapping it). Writing it
  // alongside the snapshot isn't required for correctness today (there's only ever one
  // recovery slot — see localAssetStore.js's fixed RECOVERY_KEY) but keeps the record
  // self-describing for the restore-prompt UI and for a future multi-slot design.
  function schedule({ projectId, projectName, song, instruments, ui }) {
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      const project = serializeProject({ song, instruments, ui }, { embedSampleBytes: false });
      writeRecoveryState({ projectId, projectName, savedAt: getNow(), project }).catch(() => {
        // Best-effort: a failed recovery write (storage quota, a tab closed mid-write) should
        // never surface as an app error — it only ever costs the *next* crash recovery, never
        // this session's own correctness.
      });
    }, debounceMs);
  }

  // Drops a pending write without firing it — appContext.js calls this right before replacing
  // the open project (an explicit Load), so a debounced write for the *previous* project can
  // never land after the new one is already open (see module doc comment on projectId).
  function cancel() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return { schedule, cancel };
}

// Resolves a stored recovery record (localAssetStore.js#getRecoveryState's shape) back into
// {song, instruments, ui} — the same shape state/store.js#loadProject expects, so restoring
// recovered state and loading an explicit JSON file share one call site in appContext.js.
// getLocalAssetBytes: (localAssetId) => Promise<ArrayBuffer | undefined>.
export async function restoreRecoveryState(record, { loadSampleBytes, getLocalAssetBytes }) {
  return deserializeProject(record.project, { loadSampleBytes, loadLocalAssetBytes: getLocalAssetBytes });
}
