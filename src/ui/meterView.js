import { METER_LED_DB, METER_RED_LEDS } from "webdsp";

// Display side of webdsp's peak metering for the mixer. The engine measures peaks and webdsp's
// MeterTracker turns them into hold/decay state; this maps that state onto elements by toggling
// classes directly (no React state), so ~47 updates a second never cause a React render.
// Toggling a class to the value it already has does not touch the DOM, so calling this every
// animation frame is cheap.
//
// targets: { leds: Element[] (lowest first), masterStrip: Element | null,
//            trackClips: { el: Element, bus: number | undefined }[] }
export function paintMeters(tracker, nowMs, targets) {
  const lit = tracker.masterLitLeds();
  targets.leds.forEach((el, i) => {
    el.classList.toggle("meter-led--lit", i < lit);
    el.classList.toggle("meter-led--red", i >= METER_LED_DB.length - METER_RED_LEDS);
  });
  targets.masterStrip?.classList.toggle("channel-strip--clipping", tracker.masterClipping(nowMs));
  for (const { el, bus } of targets.trackClips) {
    el.classList.toggle("channel-strip__clip--on", bus !== undefined && tracker.busClipping(bus, nowMs));
  }
}
