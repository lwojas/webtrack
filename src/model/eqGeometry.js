// Pure geometry for the EQ curve editor (ui/chrome/EqCurveEditor.jsx): the log-frequency / dB mapping
// between graph pixels and EQ parameters, plus reading an EQ instance's catalog values (`eq.b<n><Field>`)
// into webdsp's EqBand model. No DOM, so it is unit-tested directly. The response maths comes from
// webdsp (eqCurve); this file only decides where things are drawn and what a gesture changes.
import { EQ_MAX_HZ, EQ_MIN_HZ, EQ_MAX_Q, EQ_MIN_Q, EQ_MAX_SHELF_SLOPE, EQ_MIN_SHELF_SLOPE, defaultEqBands, eqBandUses } from "webdsp";

/** Vertical range of the graph, +-dB (the engine accepts +-18). */
export const EQ_VIEW_DB = 18;

export const freqToX = (hz, width) => (Math.log(hz / EQ_MIN_HZ) / Math.log(EQ_MAX_HZ / EQ_MIN_HZ)) * width;
export const xToFreq = (x, width) => Math.min(EQ_MAX_HZ, Math.max(EQ_MIN_HZ, EQ_MIN_HZ * Math.pow(EQ_MAX_HZ / EQ_MIN_HZ, x / width)));
export const dbToY = (db, height) => height / 2 - (db / EQ_VIEW_DB) * (height / 2);
export const yToDb = (y, height) => Math.min(EQ_VIEW_DB, Math.max(-EQ_VIEW_DB, ((height / 2 - y) / (height / 2)) * EQ_VIEW_DB));

/** The four bands from an instance's values, defaults filling any missing key. */
export function bandsFromValues(values) {
  return defaultEqBands().map((def, i) => {
    const v = (field, fallback) => values?.[`eq.b${i + 1}${field}`] ?? fallback;
    return {
      enabled: v("On", 0) >= 0.5,
      type: Math.round(v("Type", def.type)),
      frequency: v("Freq", def.frequency),
      gain: v("Gain", def.gain),
      q: v("Q", def.q),
      shelfSlope: v("ShelfSlope", def.shelfSlope),
      slope: v("Slope", def.slope) >= 18 ? 24 : 12,
    };
  });
}

/** The handle's dB position: the band's gain where the type has one, else the 0 dB line. */
export const handleDb = (band) => (eqBandUses(band.type, "gain") ? band.gain : 0);

/** The "width" control a wheel/shift-drag edits: Q for bell/notch, slope S for shelves. */
export function widthField(type) {
  if (eqBandUses(type, "q")) return "q";
  if (eqBandUses(type, "shelfSlope")) return "shelfSlope";
  return null;
}

/** New width value after `steps` of gesture (positive = wider). Exponential, clamped to the engine. */
export function widenedValue(type, current, steps) {
  const next = current * Math.exp(-steps);
  if (widthField(type) === "q") return Math.min(EQ_MAX_Q, Math.max(EQ_MIN_Q, next));
  return Math.min(EQ_MAX_SHELF_SLOPE, Math.max(EQ_MIN_SHELF_SLOPE, next));
}
