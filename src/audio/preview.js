import { getRuntime } from "./runtime.js";
import { compileEvent } from "./compile.js";

// Immediate, unscheduled audition of a note while editing — bypasses the lookahead scheduler
// entirely (no `time`/`duration`, so compileEvent omits them and this becomes a plain
// runtime.trigger() call).
export async function triggerPreview(event, trackChannel, instruments) {
  const runtime = await getRuntime();
  const compiled = compileEvent(event, trackChannel, instruments);
  if (!compiled) return null;
  return runtime.trigger(compiled);
}
