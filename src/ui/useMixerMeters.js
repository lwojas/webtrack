import { useEffect } from "react";
import { MAX_TRACK_BUSES, MeterTracker } from "webdsp";
import { peekRuntime, peekTrackBusIds } from "../audio/runtime.js";
import { paintMeters } from "./meterView.js";

// Master limiter on/off. Module-level so it survives the mixer unmounting (tab switches); it is
// applied when the runtime first appears (below) or when the button is clicked. Starts on, like
// the engine's default.
export const limiterState = { on: true };

// Feeds webdsp's peak snapshots into the mixer's meter elements. `rootRef` is the mixer; its
// [data-meter-led] (master), [data-master-strip] and [data-clip-track] (one per strip)
// descendants are found once on mount. The runtime only exists after the user starts audio, so
// the frame loop attaches to it as soon as peekRuntime() returns it — this never starts audio
// itself. Painting stops when the mixer unmounts, so a hidden mixer costs nothing.
export function useMixerMeters(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const tracker = new MeterTracker(MAX_TRACK_BUSES);
    const leds = Array.from(root.querySelectorAll("[data-meter-led]"));
    const masterStrip = root.querySelector("[data-master-strip]");
    const clipEls = Array.from(root.querySelectorAll("[data-clip-track]"));
    let unsubscribe = null;
    let attachedTo = null;
    let frame = 0;

    const draw = () => {
      const runtime = peekRuntime();
      if (runtime && runtime !== attachedTo) {
        unsubscribe?.();
        attachedTo = runtime;
        if (!limiterState.on) runtime.setMasterLimiter({ enabled: false });
        unsubscribe = runtime.onMeters((snapshot) => tracker.update(snapshot, performance.now()));
      }
      const busIds = peekTrackBusIds();
      paintMeters(tracker, performance.now(), {
        leds,
        masterStrip,
        trackClips: clipEls.map((el) => ({ el, bus: busIds[Number(el.dataset.clipTrack)] })),
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      unsubscribe?.();
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
