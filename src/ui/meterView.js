// Display side of webdsp's peak metering for the mixer's DOM parts: the "clipping" flag on the master
// strip and the per-track clip dots. The master LEVEL is a canvas (ui/viz/levelMeterView.js), drawn
// the same way as the EQ spectrum. webdsp's MeterTracker supplies hold/decay state; this maps it onto
// elements by toggling classes directly (no React state), so ~47 updates a second never cause a React
// render. Toggling a class to the value it already has does not touch the DOM, so calling this every
// animation frame is cheap.
//
// targets: { masterStrip: Element | null, trackClips: { el: Element, bus: number | undefined }[] }
export function paintMeters(tracker, nowMs, targets) {
  targets.masterStrip?.classList.toggle("channel-strip--clipping", tracker.masterClipping(nowMs));
  for (const { el, bus } of targets.trackClips) {
    el.classList.toggle("channel-strip__clip--on", bus !== undefined && tracker.busClipping(bus, nowMs));
  }
}
