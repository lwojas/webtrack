// Pure compilation from the musical model to webdsp's generic ScheduledEvent/TriggerParams
// shape — no AudioRuntime calls in this file, so it's testable with plain assertions (see
// ECS-156 plan §6).
import { trackLocalStep } from "../model/pattern.js";

// How many steps a note holds for. An explicit Event.length wins (set via the note editor —
// see ui/chrome/NoteEditor.jsx); otherwise falls back to the original auto behavior: hold
// until the next non-empty note on the same track, or a 1-step default if none follows before
// the track's own playback loop ends (track.length — model/pattern.js — not necessarily the
// full events array, for a track shortened below the pattern's grid size).
export function noteDurationSteps(track, rowIndex) {
  const explicitLength = track.events[rowIndex]?.length;
  if (typeof explicitLength === "number" && explicitLength > 0) return explicitLength;

  const loopEnd = track.length ?? track.events.length;
  for (let i = rowIndex + 1; i < loopEnd; i++) {
    if (track.events[i].note !== null) return i - rowIndex;
  }
  return 1;
}

// event.pan is modeled (model/event.js) and editable, but webdsp has no per-voice pan
// parameter yet (see its ARCHITECTURE.md, "Intentionally deferred") — nothing to wire it to
// until the engine grows one, so it's deliberately not read here.
export function compileEvent(event, trackChannel, instruments, time, durationSeconds) {
  if (event.note === null || event.instrument === null) return null;
  if (trackChannel.muted) return null;

  const instrument = instruments[event.instrument];
  if (!instrument || instrument.sampleId === null) return null;

  const velocity = event.velocity ?? 127;
  const gain = (velocity / 127) * trackChannel.volume * instrument.gain;
  const pitch = event.note - instrument.rootNote;

  const compiled = { sampleId: instrument.sampleId, gain, pitch };
  if (time !== undefined) compiled.time = time;
  if (durationSeconds !== undefined) compiled.duration = durationSeconds;
  return compiled;
}

// One shared transport step across every track, at one absolute engine time ->
// ScheduledEvent[]. `transportStep` is the single shared clock position (lookaheadPlayer's own
// ever-advancing stepCounter); each track folds that into its own loop length via
// trackLocalStep (model/pattern.js) to get the row it's actually on right now — this is what
// makes tracks polymetric without a second clock anywhere. Tracks with no instrument assigned,
// a muted channel, or (while any channel is soloed) no solo flag are skipped entirely —
// mixer-level gating happens here, at compile time, not via a webdsp bus.
export function compileRow(pattern, trackChannels, instruments, transportStep, time, stepDurationSeconds) {
  const soloActive = trackChannels.some((channel) => channel.solo);
  const events = [];

  pattern.tracks.forEach((track, trackIndex) => {
    const trackChannel = trackChannels[trackIndex];
    if (!trackChannel) return;
    if (soloActive && !trackChannel.solo) return;

    const localStep = trackLocalStep(track, transportStep);
    const event = track.events[localStep];
    if (!event) return;

    const durationSteps = noteDurationSteps(track, localStep);
    const compiled = compileEvent(event, trackChannel, instruments, time, durationSteps * stepDurationSeconds);
    if (compiled) events.push(compiled);
  });

  return events;
}
