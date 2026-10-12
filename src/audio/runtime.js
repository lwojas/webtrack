import { AudioRuntime } from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";

// The only call site for AudioRuntime.create(). Lazily creates and resumes the runtime once,
// on first call — callers (playbackController.play(), a file-load handler) must call this
// from inside a user gesture handler, since resume() requires one.
let runtimePromise = null;

export function initRuntime() {
  if (!runtimePromise) {
    runtimePromise = AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl }).then(async (runtime) => {
      await runtime.resume();
      return runtime;
    });
  }
  return runtimePromise;
}

export function getRuntime() {
  if (!runtimePromise) {
    throw new Error("Audio runtime not initialized yet — call initRuntime() first.");
  }
  return runtimePromise;
}

// One webdsp bus per track, allocated lazily and exactly once per track index — the same
// idempotent-cached-promise shape initRuntime() above uses (ARCHITECTURE.md's Gotcha #4),
// so whichever call site asks first (a user dragging an FX slider before ever pressing Play,
// or playbackController.play() wiring up note routing) wins without creating a track's bus
// twice. Shared by both: audio/compile.js's compileRow uses the returned array to route note
// voices into their track's own bus instead of straight to MASTER_BUS; audio/fx.js's
// setTrackFxParam uses it to resolve which bus a track's FX panel/cell automation targets.
// See webdsp's AudioRuntime.createBus() — synchronous and real-time-safe, not a worklet
// round-trip, so growing this array costs nothing beyond the one-time initRuntime() wait.
let trackBusIds = null;

export async function ensureTrackBuses(trackCount) {
  const runtime = await initRuntime();
  if (!trackBusIds) trackBusIds = [];
  for (let i = trackBusIds.length; i < trackCount; i++) {
    trackBusIds.push(runtime.createBus());
  }
  return trackBusIds;
}
