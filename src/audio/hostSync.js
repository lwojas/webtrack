// Follows an external clock when the runtime has one (AudioRuntime.onHostTransport -- a DAW plugin host,
// say). It is a client of the playback controller, not part of the lookahead player: it watches the host's
// transport and calls playAt()/stop() so the queue plays where the host is. In a browser the runtime never
// reports a host transport, so none of this runs. See webdsp's docs/host-transport.md for the contract.
//
// Policy (the same as webseq's audio/hostSync.ts):
//  - The host starts, or jumps (locate, loop wrap): restart at the host's position, at the host's tempo.
//  - The host changes tempo: re-anchor at the new tempo from the host's position.
//  - The host stops: stop, but only if the host started this playback.
//  - The user pressing Stop while the host plays is respected until the host next starts/jumps; the
//    periodic refresh events do not restart it.
import { hostBeatAt, isHostDiscontinuity } from "webdsp";
import { STEPS_PER_BEAT } from "../model/timing.js";

// Never aim sooner than this after "now": the scheduler needs a tick to put the first notes in.
const START_MARGIN_SECONDS = 0.03;

// runtime: { getCurrentTime, getHostTransport, onHostTransport }
// getTransport: () => { playAt(step, at, bpm), stop() } | null -- null until it exists; events that
//   arrive earlier are applied on the next refresh.
export function createHostSync({ runtime, getTransport }) {
  let prev = null;
  let following = false;
  let pendingStart = false;

  function resync(t, transport) {
    const at = Math.max(t.time, runtime.getCurrentTime() + START_MARGIN_SECONDS);
    transport.playAt(hostBeatAt(t, at) * STEPS_PER_BEAT, at, t.bpm);
    following = true;
    pendingStart = false;
  }

  function apply(t) {
    const last = prev;
    prev = t;
    const transport = getTransport();

    if (!t.playing) {
      pendingStart = false;
      if (following && transport) {
        transport.stop();
        following = false;
      }
      return;
    }
    if (!transport) {
      pendingStart = true;
      return;
    }
    const tempoChanged = last !== null && last.bpm !== t.bpm;
    if (isHostDiscontinuity(last, t) || tempoChanged || pendingStart) resync(t, transport);
  }

  const unsubscribe = runtime.onHostTransport(apply);
  const current = runtime.getHostTransport();
  if (current) apply(current);

  return { isFollowing: () => following, dispose: unsubscribe };
}
