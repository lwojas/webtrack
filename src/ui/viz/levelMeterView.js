import { METER_LED_DB, METER_MAX_DB, METER_MIN_DB, METER_RED_DB, dbToUnit, peakToUnit } from "webdsp";
import { CanvasSurface } from "./canvasSurface.js";
import { paintLevelBar } from "./paint.js";
import { cssColor, withAlpha } from "./theme.js";

const TICKS = METER_LED_DB.map((db) => dbToUnit(db, METER_MIN_DB, METER_MAX_DB));
const RED_UNIT = dbToUnit(METER_RED_DB, METER_MIN_DB, METER_MAX_DB);

// The master level as a canvas bar, driven by a MeterTracker (hold/decay already applied there).
// Call draw() from the caller's frame loop; it repaints only when the bar moved by a pixel or the
// clip state changed, so a steady or silent meter costs nothing. Mirrors webseq src/viz/levelMeterView.ts.
export class LevelMeterView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas);
    this.lastPx = -1;
    this.lastClip = false;
    this.style = {
      track: cssColor(canvas, "--surface-empty", "#242b38"),
      fill: cssColor(canvas, "--emerald", "#00e676"),
      danger: cssColor(canvas, "--crimson", "#ff3366"),
      tick: withAlpha(cssColor(canvas, "--surface-2", "#000"), 0.6),
    };
  }

  draw(tracker, nowMs) {
    const unit = peakToUnit(tracker.masterLevel());
    const clipping = tracker.masterClipping(nowMs);
    const px = Math.round(unit * this.surface.height);
    if (!this.surface.dirty && px === this.lastPx && clipping === this.lastClip) return;
    this.lastPx = px;
    this.lastClip = clipping;
    const ctx = this.surface.begin();
    if (ctx) paintLevelBar(ctx, this.surface.width, this.surface.height, { unit, redUnit: RED_UNIT, ticks: TICKS, clipping }, this.style);
  }

  dispose() {
    this.surface.dispose();
  }
}
