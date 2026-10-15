import { getRuntime } from "./runtime.js";
import { compileEvent } from "./compile.js";
import { voiceTracker } from "./voiceTracker.js";
import { midiOutput } from "./midiOutput.js";

// Immediate, unscheduled audition of a note while editing — bypasses the lookahead scheduler
// entirely (no `time`/`duration`, so compileEvent omits them). compileEvent is called before
// touching the audio runtime at all, so auditioning a MIDI-output instrument (see
// audio/midiOutput.js) never needs webdsp's AudioRuntime initialized in the first place —
// only the sample branch below does.
//
// For a sample instrument, this is a plain runtime.trigger() call, still going through the
// same shared voiceTracker instance audio/lookaheadPlayer.js's scheduled playback uses (see
// that module's own doc comment on why it's shared) — a track's voice-limit/mono policy
// (model/trackChannel.js) holds for a manually auditioned note exactly as it does for one
// played back from the pattern. A MIDI-output instrument has no equivalent voice-tracking
// (audio/midiOutput.js's own doc comment) and returns null — there's no handle to release
// later, same as a sample audition's own voice isn't explicitly released on key-up either.
export async function triggerPreview(event, trackChannel, instruments) {
  const compiled = compileEvent(event, trackChannel, instruments);
  if (!compiled) return null;

  if (compiled.kind === "midi") {
    midiOutput.sendImmediateNoteOn(compiled.channel, compiled.note, compiled.velocity);
    return null;
  }

  // A webdsp synthesized instrument (audio/instrument.js) — same "no voice handle to release
  // later" shape as the MIDI branch above, for a different reason: instrumentNoteOn() doesn't
  // return one, and a fresh note on the same instance just restarts it (one instance is one
  // monophonic machine). Unlike MIDI, this does need the runtime — but by the time a slot has
  // a live engineInstrumentId at all, initRuntime() must already have resolved once (that's
  // what created it), so getRuntime() here is safe.
  if (compiled.kind === "instrument") {
    const runtime = await getRuntime();
    runtime.instrumentNoteOn(compiled.instrumentId, { velocity: compiled.velocity, pan: compiled.pan, pitch: compiled.pitch, duration: compiled.duration });
    return null;
  }

  const runtime = await getRuntime();
  const toRelease = voiceTracker.reserveVoiceSlot(trackChannel.index, trackChannel);
  toRelease.forEach((handle) => runtime.release(handle));
  const handle = runtime.trigger(compiled);
  voiceTracker.registerVoice(trackChannel.index, handle);
  return handle;
}
