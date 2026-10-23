// What the host should play when a MIDI key is pressed, for a host that plays incoming MIDI itself (webdsp's runtime.setMidiRoute; see
// webdsp docs/midi-routing.md). It is what audio/preview.js's audition of a note plays (compileEvent for the selected instrument on the
// cursor's track), written as a route so the host can do it without the page. The page still receives the MIDI (note entry into the
// pattern); it just must not also make the sound, which input/midiInputSource.js knows from `isRouted`.
import { effectiveChokeGroup } from "../model/trackChannel.js";
import { isSustainedSynthKind } from "../model/instrumentParams.js";
import { scaleOf } from "../model/scale.js";

// The route for the selected instrument on the cursor's track, or null when the page has to play the note itself or nothing plays:
// a muted track; a MIDI-output instrument (it sends MIDI out, which only the page can); an instrument with nothing to play yet; Snap on
// (the page snaps the played note to the scale before it is heard and written, a raw key from the host would not be snapped); a resample
// in progress (it records the master output, so nothing may be played over it, as with the page's audition).
// `knowsSample(id)` says whether the engine has the sample yet.
export function routeForAudition({ song, instruments, selectedInstrumentIndex, trackChannel, resampleStatus, knowsSample }) {
  if (!trackChannel || trackChannel.muted) return null;
  if (resampleStatus === "armed" || resampleStatus === "processing") return null;
  if (scaleOf(song).snap) return null;
  const instrument = instruments[selectedInstrumentIndex];
  if (!instrument) return null;
  const choke = effectiveChokeGroup(trackChannel);
  const chokeGroup = choke === null ? {} : { chokeGroup: choke };
  const gain = Math.max(0, Math.min(1, trackChannel.volume));

  if (instrument.output?.type === "midi") return null;

  if (instrument.output?.type === "instrument") {
    if (instrument.engineInstrumentId === null || instrument.engineInstrumentId === undefined) return null;
    return {
      kind: "instrument",
      id: instrument.engineInstrumentId,
      unityNote: instrument.rootNote,
      gain,
      ...(isSustainedSynthKind(instrument.output.kind) ? { holdUntilKeyUp: true } : {}),
      ...chokeGroup,
    };
  }

  if (instrument.sampleId === null || instrument.sampleId === undefined || !knowsSample(instrument.sampleId)) return null;
  return {
    kind: "sample",
    id: instrument.sampleId,
    unityNote: instrument.rootNote,
    gain,
    ...(instrument.sampleMode === "chop" ? { chop: true } : {}),
    ...(trackChannel.voiceMode === "mono" ? { mono: true } : {}),
    ...chokeGroup,
  };
}

// Keeps the host's route in step with the store. `getRuntime()` is the runtime if it is up (else null), `getState()` the store's state.
// sync() computes the route and sends it only when it changed; isRouted() says whether the host is currently playing notes from a route.
export function createMidiRouteSync({ getRuntime, getState }) {
  let sent = null;

  function sync() {
    const runtime = getRuntime();
    if (!runtime?.getCapabilities().midiRouting) return;
    const state = getState();
    const route = routeForAudition({
      song: state.song,
      instruments: state.instruments,
      selectedInstrumentIndex: state.selectedInstrumentIndex,
      trackChannel: state.song.trackChannels[state.cursor.trackIndex],
      resampleStatus: state.resampleStatus,
      knowsSample: (id) => runtime.getSample(id) !== undefined,
    });
    if (JSON.stringify(route) === JSON.stringify(sent)) return;
    sent = route;
    runtime.setMidiRoute(route);
  }

  return { sync, isRouted: () => sent !== null };
}
