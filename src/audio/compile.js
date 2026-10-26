// Pure compilation from the musical model to webdsp's generic ScheduledEvent/TriggerParams
// shape — no AudioRuntime calls in this file, so it's testable with plain assertions (see
// ECS-156 plan §6).
import { trackLocalStep } from "../model/pattern.js";
import { listCellEntries, nextPoint } from "../model/cellAutomation.js";
import { isSustainedSynthKind } from "../model/instrumentParams.js";
import { effectiveVelocity } from "./trackLfo.js";
import { effectiveChokeGroup } from "../model/trackChannel.js";
import { ratchetOf } from "../model/event.js";
import { arpEventsAtRow, arpOf, isArpActive } from "../model/arp.js";

// How long an un-timed (preview/audition) note of a sustained synth kind is held.
const SUSTAINED_PREVIEW_SECONDS = 0.5;

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

// event.pan (model/event.js, editable via ui/chrome/NoteEditor.jsx's PAN slider) is a per-note
// pan offset, compiled straight into webdsp's own per-voice TriggerParams.pan (see
// node_modules/webdsp's docs/panning.md) — null (the default/unset state) omits the field
// entirely rather than sending an explicit 0, so an untouched cell plays at the sample's own
// instrument-default pan (SampleParam.Pan) with no per-note offset at all, not a per-note offset
// that happens to be zero. It composes with, and is independent of, the track/master-level bus
// pan this file's sibling pushes (audio/fx.js#setTrackPan/setMasterPan) — see docs/panning.md's
// "Where it sits in the signal path": voice pan is applied per note, before the bus sum; bus pan
// is a channel-strip control for the whole track/master, applied after BusGain. A voice panned
// left on a bus panned left is further left, never cancelling out. Only meaningful for a
// "sample" output — a MIDI output has no webdsp voice to pan.
//
// `bus` (a webdsp BusId, from audio/runtime.js#ensureTrackBuses) routes this voice into its
// track's own insert-bus FX chain instead of straight to MASTER_BUS — omitted (the
// AudioRuntime default) for call sites that don't have one yet, e.g. audio/preview.js's
// audition path, which still just goes straight to the master bus. Only meaningful for a
// "sample" output — a MIDI output has no webdsp bus to route into.
//
// Every compiled event carries a `kind` ("sample" | "midi" | "instrument") so callers
// (audio/compile.js's own compileRow, audio/lookaheadPlayer.js's tick()) can tell which engine
// it's destined for without re-deriving it from the instrument again. `kind: "midi"` events are
// not yet routed anywhere — audio/lookaheadPlayer.js still only ever calls runtime.schedule(),
// and nothing in the UI can set an instrument's output.type to "midi" yet (InstrumentPanel.jsx's
// output picker and the lookaheadPlayer-side routing both land together — see the MIDI output
// transport stage of the architecture plan), so this branch is reachable only from a test or
// a hand-built instrument object today, deliberately, rather than exposing a user-facing
// control for a path that doesn't fully work yet.
//
// `lfoClock` ({ anchorTime, bpm }, from audio/lookaheadPlayer.js) enables the track's event LFO
// (model/eventLfo.js, audio/trackLfo.js): the velocity is modulated by the LFO value at this
// event's own scheduled `time` (swing included) before any output branch below uses it, so a
// sample, a synth and a MIDI event all just receive the resulting velocity. Omitted = no
// modulation. The stored event is never changed.
export function compileEvent(event, trackChannel, instruments, time, durationSeconds, bus, lfoClock) {
  if (event.note === null || event.instrument === null) return null;
  if (trackChannel.muted) return null;

  const instrument = instruments[event.instrument];
  if (!instrument) return null;

  const velocity = time === undefined ? (event.velocity ?? 127) : effectiveVelocity(trackChannel, event, event.velocity ?? 127, time, lfoClock);

  if (instrument.output?.type === "midi") {
    if (instrument.output.channel === null || instrument.output.channel === undefined) return null;
    // event.note is sent verbatim — never offset by instrument.rootNote. rootNote exists to
    // compensate for a *sample's* unknown natural pitch (see below); a MIDI note number is
    // already the pitch as far as whatever's on the other end of the channel is concerned, so
    // there is no transposition to apply here, and no `pitch` field in this shape at all.
    const compiled = { kind: "midi", channel: instrument.output.channel, note: event.note, velocity };
    if (time !== undefined) compiled.time = time;
    if (durationSeconds !== undefined) compiled.duration = durationSeconds;
    return compiled;
  }

  // A webdsp synthesized instrument (audio/instrument.js — Kick, Snare, Clap, Tom, Hi-Hat; see
  // node_modules/webdsp's docs/instruments.md). `engineInstrumentId` is this slot's live
  // webdsp InstrumentId (model/instrument.js's own doc comment) — null until
  // audio/instrument.js#createSynthInstrument has actually created one, same "nothing to
  // address yet" gate instrument.sampleId === null is below. `pitch` is derived exactly the
  // same way the sample branch below derives it — event.note minus the instrument's rootNote —
  // since webdsp's InstrumentNoteParams.pitch is defined as "semitones on top of the
  // instrument's own `tune`", the identical convention a sample's rootNote-relative pitch
  // already uses (see node_modules/webdsp's docs/percussion-instruments.md's "Note pitch").
  // rootNote defaults to 60 (C-4), so an untouched slot playing cells on C-4 gets pitch: 0 —
  // this is what keeps existing Kick projects (authored before webdsp had a pitch field at
  // all, when this branch never read event.note) sounding unchanged. `duration` is only set for
  // *sustained* kinds (the Bass — model/instrumentParams.js#isSustainedSynthKind): webdsp's
  // drums are one-shot/self-ending, and a duration would choke them with a short release. For
  // a sustained kind, webdsp counts the note length on the audio thread from the frame the note
  // starts and releases it itself (node_modules/webdsp's docs/bass-client-guide.md), so there
  // is no JS timer. Without a given length (preview) it falls back to a short audition note
  // rather than holding forever.
  if (instrument.output?.type === "instrument") {
    if (instrument.engineInstrumentId === null || instrument.engineInstrumentId === undefined) return null;
    const level = Math.max(0, Math.min(1, (velocity / 127) * trackChannel.volume));
    const pitch = event.note - instrument.rootNote;
    const compiled = { kind: "instrument", instrumentId: instrument.engineInstrumentId, velocity: level, pitch };
    if (time !== undefined) compiled.time = time;
    if (event.pan !== null && event.pan !== undefined) compiled.pan = event.pan;
    const instrumentChoke = effectiveChokeGroup(trackChannel);
    if (instrumentChoke !== null) compiled.chokeGroup = instrumentChoke;
    if (isSustainedSynthKind(instrument.output.kind)) {
      compiled.duration = durationSeconds ?? SUSTAINED_PREVIEW_SECONDS;
    }
    return compiled;
  }

  if (instrument.sampleId === null) return null;

  // instrument.gain is deliberately not folded in here — it's pushed straight to webdsp's own
  // per-sample gain stage (SampleParam.Gain, see audio/instrumentGain.js) whenever it changes
  // or a sample loads, so the engine applies it once at the sample level rather than this
  // compiling it into every triggered event's gain by hand. Folding it in here too would
  // double-count it.
  const gain = (velocity / 127) * trackChannel.volume;
  const pitch = event.note - instrument.rootNote;

  const compiled = { kind: "sample", sampleId: instrument.sampleId, gain };
  if (instrument.sampleMode === "chop") {
    // Chop: the note picks a slice (rootNote = slice 1, +1 semitone = next slice) and never
    // transposes. A note below the root has no slice; one past the last slice is dropped by the
    // engine. See model/chop.js.
    if (pitch < 0) return null;
    compiled.region = pitch;
  } else {
    compiled.pitch = pitch;
  }
  if (time !== undefined) compiled.time = time;
  if (durationSeconds !== undefined) compiled.duration = durationSeconds;
  if (bus !== undefined && bus !== null) compiled.bus = bus;
  if (event.pan !== null && event.pan !== undefined) compiled.pan = event.pan;
  // Choke group: the engine cuts the group's other tracks' voices at this event's exact start
  // frame (webdsp docs/choke-groups.md); sources are told apart by bus, one per track.
  const chokeGroup = effectiveChokeGroup(trackChannel);
  if (chokeGroup !== null) compiled.chokeGroup = chokeGroup;
  return compiled;
}

// Two notes closer than this start on the same engine frame (a frame is ~21 us at 48 kHz).
const SAME_START_SECONDS = 5e-6;

// Choke-group tie-break for the events of one step: which of them must not play because a track
// later in track order, in the same group, starts a note at the same instant. Last track wins, so
// the outcome never depends on queue order (the engine has no priority concept). The engine would
// cut the loser on its own start frame anyway; dropping it up front makes the result explicit.
// Notes at different times are not ties: the later one cuts the earlier. Events without a
// chokeGroup or a time (previews) are never dropped. Returns the events to keep.
export function dropSimultaneousChokeLosers(events) {
  const grouped = events
    .filter((e) => e.chokeGroup !== undefined && e.time !== undefined)
    .sort((a, b) => a.time - b.time);
  const losers = new Set();
  for (let i = 0; i < grouped.length; i++) {
    for (let j = i + 1; j < grouped.length && grouped[j].time - grouped[i].time <= SAME_START_SECONDS; j++) {
      const a = grouped[i];
      const b = grouped[j];
      if (a.chokeGroup !== b.chokeGroup || a.trackIndex === b.trackIndex) continue;
      losers.add(a.trackIndex < b.trackIndex ? a : b);
    }
  }
  return losers.size === 0 ? events : events.filter((e) => !losers.has(e));
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
// Each returned event carries compileEvent's own `kind` tag unchanged — this function doesn't
// filter or partition by it; whichever caller eventually routes "midi"-kind events to a real
// MIDI output (rather than runtime.schedule(), as today) does that downstream, not here.
export function compileRow(pattern, trackChannels, instruments, transportStep, time, stepDurationSeconds, trackBusIds, lfoClock) {
  const soloActive = trackChannels.some((channel) => channel.solo);
  const events = [];
  const arpInstruments = [];
  instruments.forEach((instrument, index) => {
    if (isArpActive(instrument)) arpInstruments.push(index);
  });

  pattern.tracks.forEach((track, trackIndex) => {
    const trackChannel = trackChannels[trackIndex];
    if (!trackChannel) return;
    if (soloActive && !trackChannel.solo) return;

    const localStep = trackLocalStep(track, transportStep);
    const bus = trackBusIds?.[trackIndex];

    // The arp belongs to the instrument (model/arp.js, instrument.arp): every arp-enabled
    // instrument sounds whatever it generates for this row from *its own* notes on this track —
    // zero, one or several notes, at sub-row offsets inside the row. Everything downstream
    // (velocity/LFO, sample/synth/MIDI branches, voice limits) sees ordinary events. A cell whose
    // instrument has the arp off (or no arp) takes the original path below, untouched.
    for (const instrumentIndex of arpInstruments) {
      const items = arpEventsAtRow(track, localStep, arpOf(instruments[instrumentIndex]), noteDurationSteps, (e) => e.instrument === instrumentIndex);
      for (const item of items) {
        const compiled = compileEvent(
          item.event,
          trackChannel,
          instruments,
          time + item.offset * stepDurationSeconds,
          item.durationSteps * stepDurationSeconds,
          bus,
          lfoClock,
        );
        if (compiled) events.push({ ...compiled, trackIndex });
      }
    }

    const event = track.events[localStep];
    if (!event) return;
    // This cell's note is played by its instrument's arp (above), not as written.
    if (event.note !== null && isArpActive(instruments[event.instrument])) return;

    const durationSteps = noteDurationSteps(track, localStep);
    // Ratchet (Event.ratchet): the note's own length split into n equal slots, one real trigger at the
    // front of each, so synth envelopes and samples restart every time. The swung `time` is the whole
    // step's, so the hits never swing individually. n = 1 is exactly the single event below.
    const hits = ratchetOf(event);
    const slotSeconds = (durationSteps * stepDurationSeconds) / hits;
    // trackIndex rides along on the compiled event itself (not webdsp's ScheduledEvent shape —
    // audio/lookaheadPlayer.js strips it again before actually calling runtime.schedule()) so
    // whichever VoiceHandle the engine hands back for this event can be attributed back to the
    // track that triggered it — audio/voiceTracker.js's whole per-track voice-limit bookkeeping
    // depends on that correlation, and this is the one place that already knows it.
    for (let hit = 0; hit < hits; hit++) {
      const compiled = compileEvent(event, trackChannel, instruments, time + hit * slotSeconds, slotSeconds, bus, lfoClock);
      if (compiled) events.push({ ...compiled, trackIndex });
    }
  });

  return dropSimultaneousChokeLosers(events);
}

// Cell-level FX automation at a row — distinct from compileRow's note triggers above: a sparse
// { trackIndex, instanceId, paramId, value } entry for every Event.fx key actually set on
// whichever cell each track is on right now, folded through the exact same trackLocalStep every
// other per-track read path uses (audio/compile.js's own compileRow above, and
// audio/playbackController.js#getTrackPlayheadRow for what's drawn), so cell FX can never
// disagree with what plays or what's shown. Deliberately NOT gated by mute/solo (unlike
// compileRow) — a track's FX automation should keep latching in even while muted, same as
// turning a real mixer knob would; and deliberately never looks at song.masterFx/MASTER_BUS —
// a tracker cell can only ever address its own track's insert bus (see the brief's track-vs-
// master ownership rule).
//
// instanceId is `null` for the one flat, non-chain entry (bus.gain — model/event.js#fx's own
// doc comment) and the real chain-instance id for everything under fx.instances — callers
// (audio/playbackController.js) branch on it to pick the matching audio/fx.js setter
// (setTrackFxParam vs. setTrackFxInstanceParam).
export function compileRowFx(pattern, transportStep) {
  const changes = [];

  pattern.tracks.forEach((track, trackIndex) => {
    const localStep = trackLocalStep(track, transportStep);
    const event = track.events[localStep];
    if (!event?.fx) return;

    for (const paramId in event.fx) {
      if (paramId === "instances" || paramId === "instruments" || paramId === "glide") continue;
      changes.push({ trackIndex, instanceId: null, paramId, value: event.fx[paramId] });
    }
    for (const instanceId in event.fx.instances ?? {}) {
      const bag = event.fx.instances[instanceId];
      for (const paramId in bag) {
        changes.push({ trackIndex, instanceId: Number(instanceId), paramId, value: bag[paramId] });
      }
    }
  });

  return changes;
}

// Cell automation of FX instances and instrument slots at a row, as parameter writes to schedule on
// the audio clock (webdsp scheduleParams): one descriptor per entry of whichever cell each track is
// on, folded through the same trackLocalStep as everything else. The (swung) time of the row is the
// caller's; this only says *what*:
//
//   { trackIndex, kind: "fx" | "inst", instanceId | slot, paramId, value }              a step
//   { ..., from, value, ramp }                                                          a glide
//
// A glide entry ramps (seconds, from its own value) to the next value of the same parameter on this
// track, found inside the track's own loop with no wrap: after the last point of a loop it simply
// holds. The next cell's own entry steps to its value at the ramp's end, so the two agree.
// bus.gain is not here: it has no scheduled form and stays on compileRowFx's immediate path.
// Like compileRowFx, deliberately not gated by mute/solo.
export function compileRowAutomation(pattern, transportStep, stepDuration = 0) {
  const out = [];
  pattern.tracks.forEach((track, trackIndex) => {
    const local = trackLocalStep(track, transportStep);
    for (const entry of listCellEntries(track.events[local])) {
      if (entry.kind === "bus") continue;
      const item = { trackIndex, kind: entry.kind, paramId: entry.paramId, value: entry.value };
      if (entry.kind === "fx") item.instanceId = entry.instanceId;
      else item.slot = entry.slot;
      if (entry.glide) {
        const next = nextPoint(track, local, entry.key);
        if (next && stepDuration > 0) {
          item.from = entry.value;
          item.value = next.value;
          item.ramp = (next.row - local) * stepDuration;
        }
      }
      out.push(item);
    }
  });
  return out;
}
