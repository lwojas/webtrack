import { getRuntime } from "./runtime.js";
import { compileEvent } from "./compile.js";
import { voiceTracker } from "./voiceTracker.js";

// Immediate, unscheduled audition of a note while editing — bypasses the lookahead scheduler
// entirely (no `time`/`duration`, so compileEvent omits them and this becomes a plain
// runtime.trigger() call). Still goes through the same shared voiceTracker instance
// audio/lookaheadPlayer.js's scheduled playback uses (see that module's own doc comment on why
// it's shared) — a track's voice-limit/mono policy (model/trackChannel.js) holds for a manually
// auditioned note exactly as it does for one played back from the pattern.
export async function triggerPreview(event, trackChannel, instruments) {
  const runtime = await getRuntime();
  const compiled = compileEvent(event, trackChannel, instruments);
  if (!compiled) return null;
  const toRelease = voiceTracker.reserveVoiceSlot(trackChannel.index, trackChannel);
  toRelease.forEach((handle) => runtime.release(handle));
  const handle = runtime.trigger(compiled);
  voiceTracker.registerVoice(trackChannel.index, handle);
  return handle;
}
