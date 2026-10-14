// Push's Play button (CC85) — wired to WebTrack's actual transport, not a second playback
// mechanism. Attached independently of modeController.js's grid-mode dispatch (its own
// device.onMessage subscription, same shape as encoderController.js), since Play is meaningful
// regardless of which grid content is currently showing.
import { CC_PLAY, PUSH_CHANNEL, FEEDBACK_DIM, FEEDBACK_FULL } from "./constants.js";
import * as events from "../../state/events.js";

const STATUS_CC = 0xb0 | PUSH_CHANNEL;

// togglePlayback is appContext.js's own async play/stop toggle — the same function the
// transport bar's keyboard shortcut uses (it awaits ensureDemoInstrumentsLoaded() before the
// first play(), the documented autoplay-gesture + demo-kit-load race in ARCHITECTURE.md's
// Gotcha #4). Routing through it here means Push's Play button can't accidentally start
// playback before the demo kit has finished loading, without this file re-deriving that race
// avoidance itself.
export function createPushTransportController({ device, store, togglePlayback }) {
  let lastFeedback = null;

  function sendFeedback(playing) {
    const value = playing ? FEEDBACK_FULL : FEEDBACK_DIM;
    if (lastFeedback === value) return;
    lastFeedback = value;
    device.send([STATUS_CC, CC_PLAY, value]);
  }

  function paint() {
    sendFeedback(store.getState().playing);
  }

  function handleMessage(bytes) {
    const [status, data1, data2] = bytes;
    if ((status & 0xf0) !== STATUS_CC || data1 !== CC_PLAY || data2 === 0) return;
    togglePlayback();
  }

  function attach() {
    const unsubscribeDevice = device.onMessage(handleMessage);
    const unsubscribeStore = store.subscribe(events.TRANSPORT_CHANGED, paint);
    lastFeedback = null;
    paint();
    return () => {
      unsubscribeDevice();
      unsubscribeStore();
      device.send([STATUS_CC, CC_PLAY, FEEDBACK_DIM]);
    };
  }

  // Used by appContext.js's refreshPushState() — resets the feedback diff cache and repaints
  // from the store's actual current playing state, without touching the subscription attach()
  // already owns.
  function refresh() {
    lastFeedback = null;
    paint();
  }

  return { attach, refresh };
}
