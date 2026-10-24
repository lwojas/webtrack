// Keeps a host that plays the song itself (capabilities.nativeSequence) supplied with the current Sequence (audio/nativeSequence.js).
// Every change of the project sends the whole sequence again, after a short pause so a burst of edits sends once; the host swaps it in at a
// block boundary without cutting sounding notes. A slow check also catches the engine becoming able to play more of the song (a sample
// finished loading, an instrument or effect was created), which no store event announces. A result equal to the last sent is not sent.
import { compileNativeSequence } from "./nativeSequence.js";
import { getTrackEffectId, resolveNodeParam } from "./fx.js";
import { resolveInstrumentParam } from "./instrument.js";
import { resolveEnvelopeParam } from "./instrumentEnvelope.js";
import { getPatternQueueEntries } from "../model/query.js";

const DEBOUNCE_MS = 150;
const CHECK_MS = 1000;

// getRuntime() the runtime if it is up (else null); getState() the store's state; getTrackBusIds() the track -> bus array so far.
export function createNativeSequenceSync({ getRuntime, getState, getTrackBusIds }) {
  let sentJson = "";
  let sentRuntime = null;
  let timer = null;
  let interval = null;

  function sync() {
    const runtime = getRuntime();
    if (!runtime?.getCapabilities().nativeSequence) return;
    if (runtime !== sentRuntime) {
      sentRuntime = runtime;
      sentJson = ""; // a new runtime/engine has no sequence yet
    }
    const state = getState();
    const sequence = compileNativeSequence({
      entries: getPatternQueueEntries(state.song),
      trackChannels: state.song.trackChannels,
      instruments: state.instruments,
      trackBusIds: getTrackBusIds(),
      swing: state.song.swing,
      hasSample: (id) => runtime.getSample(id) !== undefined,
      paramContext: {
        trackBusIds: getTrackBusIds(),
        instruments: state.instruments,
        effectId: getTrackEffectId,
        nodeParam: resolveNodeParam,
        instrumentParam: resolveInstrumentParam,
        sampleParam: resolveEnvelopeParam,
      },
    });
    const json = JSON.stringify(sequence);
    if (json === sentJson) return;
    sentJson = json;
    runtime.setSequence(sequence);
  }

  // Called on every event that can change the song; collects a burst into one compile.
  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      sync();
    }, DEBOUNCE_MS);
  }

  // Starts the slow readiness check (once the runtime is up).
  function start() {
    if (interval === null) interval = setInterval(sync, CHECK_MS);
    schedule();
  }

  return { schedule, start, sync };
}
