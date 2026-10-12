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
//
// `bus` (a webdsp BusId, from audio/runtime.js#ensureTrackBuses) routes this voice into its
// track's own insert-bus FX chain instead of straight to MASTER_BUS — omitted (the
// AudioRuntime default) for call sites that don't have one yet, e.g. audio/preview.js's
// audition path, which still just goes straight to the master bus.
export function compileEvent(event, trackChannel, instruments, time, durationSeconds, bus) {
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
  if (bus !== undefined && bus !== null) compiled.bus = bus;
  return compiled;
}

// One shared transport step across every track, at one absolute engine time ->
// ScheduledEvent[]. `transportStep` is the single shared clock position (lookaheadPlayer's own
// ever-advancing stepCounter); each track folds that into its own loop length via
// trackLocalStep (model/pattern.js) to get the row it's actually on right now — this is what
// makes tracks polymetric without a second clock anywhere. Tracks with no instrument assigned,
// a muted channel, or (while any channel is soloed) no solo flag are skipped entirely —
// mixer-level gating happens here, at compile time, not via a webdsp bus.
// trackBusIds: BusId[] | undefined, indexed by trackIndex (audio/runtime.js#ensureTrackBuses)
// — omitted entirely by test callers/audio/preview.js that don't need bus routing; every
// voice then just falls back to compileEvent's own "no bus means MASTER_BUS" default.
export function compileRow(pattern, trackChannels, instruments, transportStep, time, stepDurationSeconds, trackBusIds) {
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
    const bus = trackBusIds?.[trackIndex];
    const compiled = compileEvent(event, trackChannel, instruments, time, durationSteps * stepDurationSeconds, bus);
    // trackIndex rides along on the compiled event itself (not webdsp's ScheduledEvent shape —
    // audio/lookaheadPlayer.js strips it again before actually calling runtime.schedule()) so
    // whichever VoiceHandle the engine hands back for this event can be attributed back to the
    // track that triggered it — audio/voiceTracker.js's whole per-track voice-limit bookkeeping
    // depends on that correlation, and this is the one place that already knows it.
    if (compiled) events.push({ ...compiled, trackIndex });
  });

  return events;
}

// Cell-level FX automation at a row — distinct from compileRow's note triggers above: a
// sparse { trackIndex, paramId, value } entry for every Event.fx key actually set on whichever
// cell each track is on right now, folded through the exact same trackLocalStep every other
// per-track read path uses (audio/compile.js's own compileRow above, and
// audio/playbackController.js#getTrackPlayheadRow for what's drawn), so cell FX can never
// disagree with what plays or what's shown. Deliberately NOT gated by mute/solo (unlike
// compileRow) — a track's FX automation should keep latching in even while muted, same as
// turning a real mixer knob would; and deliberately never looks at song.masterFx/MASTER_BUS —
// a tracker cell can only ever address its own track's insert bus (see the brief's track-vs-
// master ownership rule).
export function compileRowFx(pattern, transportStep) {
  const changes = [];

  pattern.tracks.forEach((track, trackIndex) => {
    const localStep = trackLocalStep(track, transportStep);
    const event = track.events[localStep];
    if (!event?.fx) return;

    for (const paramId in event.fx) {
      changes.push({ trackIndex, paramId, value: event.fx[paramId] });
    }
  });

  return changes;
}
