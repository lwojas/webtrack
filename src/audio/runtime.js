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
