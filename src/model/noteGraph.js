// The note editor's graph bars (ui/chrome/NoteEditor.jsx): one bar per editable event field, dragged
// vertically to set a value. This module decides, for the event under the cursor, which bars exist
// and which values each bar can take — so the bars follow the context instead of offering raw
// 0..127 sliders: a chop slot's NOTE bar has one step per slice, a project in a key only offers that
// key's notes, INSTRUMENT only offers slots that exist, and so on. Pure data, no DOM.
//
// A bar is `{ id, row, label, field, values, value, format, toField?, clearable, hint }`:
//   values    ascending list of selectable values (bottom of the bar -> top)
//   value     the event's current value (null when the field is empty)
//   toField   maps a chosen value to what is stored (e.g. ratchet 1 and chop pitch 0 are stored as null)
//   clearable the field can be empty (null); the bar then has an "unset" slot below its first value
import { EFFECT_COMMANDS } from "./effects.js";
import { RATCHET_VALUES, normalizeRatchet, ratchetOf } from "./event.js";
import { normalizeParticipation } from "./eventLfo.js";
import { MAX_NOTE, noteForSlice, sliceCount } from "./chop.js";
import { isChromatic, isNoteInScale } from "./scale.js";
import { noteNumberToName, toHex } from "./notes.js";
import { supportsTieKind } from "./instrumentParams.js";

export const NOTE_WINDOW = 48; // chromatic NOTE bar span: four octaves around the current note
export const CHOP_PITCH_MAX = 24;

const range = (from, to, step = 1) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

// Notes the NOTE bar offers for a chromatic/sample slot: a four-octave window centred on `center`
// (the slot's root, so there are two octaves below it as well as above), or the given `windowStart`;
// filtered to the key when the project has one. A current note outside that window moves the window
// to it, and an off-key current note is still included, so neither is hidden or silently changed.
export function noteBarValues(scale, center, current = null, windowStart = null) {
  const clampStart = (n) => Math.max(0, Math.min(MAX_NOTE + 1 - NOTE_WINDOW, Math.floor(n / 12) * 12));
  let start = windowStart ?? clampStart(center - NOTE_WINDOW / 2);
  if (windowStart === null && Number.isInteger(current) && (current < start || current >= start + NOTE_WINDOW)) start = clampStart(current - NOTE_WINDOW / 2);
  const anchor = current;
  const strict = scale && !isChromatic(scale);
  const values = range(start, Math.min(MAX_NOTE, start + NOTE_WINDOW - 1)).filter((n) => !strict || isNoteInScale(scale, n));
  if (Number.isInteger(anchor) && anchor >= 0 && anchor <= MAX_NOTE && !values.includes(anchor)) values.push(anchor);
  return { start, values: values.sort((a, b) => a - b) };
}

const isChopSlot = (instrument) => instrument?.sampleMode === "chop" && instrument?.output?.type === "sample";

/** The graph bars for `event`, top row (row 0) then bottom row (row 1).
 *  ctx: { instruments, scale, octave, rowCount, defaultInstrument?, noteWindowStart? (locks the NOTE window during a drag) } */
export function buildNoteGraph(event, ctx) {
  const { instruments, scale, octave = 4, rowCount = 16, defaultInstrument = null } = ctx;
  // An empty cell is shaped by the instrument a note typed there would get (the selected one).
  const instrument = instruments[event.instrument ?? defaultInstrument];
  const chop = isChopSlot(instrument);
  const bars = [];

  // --- NOTE: slices for a chop slot, otherwise the (key-filtered) note window ---
  if (chop) {
    const slices = Math.max(1, sliceCount(instrument.cues));
    const root = instrument.rootNote ?? 60;
    const values = range(0, slices - 1)
      .map((s) => noteForSlice(root, s))
      .filter((n) => n !== null);
    if (event.note !== null && !values.includes(event.note)) values.push(event.note);
    values.sort((a, b) => a - b);
    bars.push({ id: "note", row: 0, label: "SLICE", field: "note", values, value: event.note, clearable: true, format: (n) => `S${String(n - root + 1).padStart(2, "0")}`, hint: `${slices} slices` });
  } else {
    // Centre on the sample slot's root note; a synth has no root, so the edit octave stands in.
    const center = instrument?.output?.type === "sample" ? (instrument.rootNote ?? 60) : octave * 12;
    const { start, values } = noteBarValues(scale, center, event.note, ctx.noteWindowStart ?? null);
    bars.push({ id: "note", row: 0, label: "NOTE", field: "note", values, value: event.note, clearable: true, format: noteNumberToName, window: start, hint: scale && !isChromatic(scale) ? "key notes only" : "" });
  }

  bars.push({ id: "velocity", row: 0, label: "VEL", field: "velocity", values: range(0, 127), value: event.velocity, clearable: true, format: (v) => toHex(v, 2), hint: "0-127" });

  // --- chop slots: per-note transpose on top of the slot's chop pitch ---
  if (chop && event.note !== null) {
    bars.push({ id: "chopTranspose", row: 0, label: "PITCH", field: "chopTranspose", values: range(-CHOP_PITCH_MAX, CHOP_PITCH_MAX), value: event.chopTranspose ?? 0, clearable: false, toField: (v) => (v === 0 ? null : v), format: (v) => `${v > 0 ? "+" : ""}${v}st`, hint: "semitones, this note" });
  }

  // --- LENGTH: 1..pattern rows, empty = auto ---
  bars.push({ id: "length", row: 0, label: "LEN", field: "length", values: range(1, Math.max(1, rowCount)), value: event.length, clearable: true, format: (v) => String(v), emptyLabel: "auto", hint: "steps" });

  bars.push({ id: "ratchet", row: 0, label: "RATCH", field: "ratchet", values: [...RATCHET_VALUES], value: ratchetOf(event), clearable: false, toField: normalizeRatchet, format: (v) => (v === 1 ? "off" : `×${v}`), hint: "retriggers" });

  if (event.note !== null && instrument?.output?.type === "instrument" && supportsTieKind(instrument.output.kind)) {
    bars.push({ id: "tie", row: 0, label: "TIE", field: "tie", values: [0, 1], value: event.tie ? 1 : 0, clearable: false, toField: (v) => (v ? true : null), format: (v) => (v ? "on" : "off"), hint: "slide into next" });
  }

  // --- bottom row: pan, track LFO and the fx command ---
  bars.push({ id: "pan", row: 1, label: "PAN", field: "pan", values: range(-1, 1, 0.05), value: event.pan ?? 0, clearable: false, format: (v) => (Math.abs(v) < 0.025 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`), hint: "L ↔ R" });
  bars.push({ id: "lfo", row: 1, label: "LFO", field: "lfo", values: range(0, 1, 0.05), value: event.lfo ?? 0, clearable: false, toField: normalizeParticipation, format: (v) => `${Math.round(v * 100)}%`, hint: "track LFO" });
  bars.push({ id: "effectCommand", row: 1, label: "FX", field: "effectCommand", values: EFFECT_COMMANDS.map((c) => c.id), value: event.effectCommand, clearable: true, format: (id) => EFFECT_COMMANDS.find((c) => c.id === id)?.code ?? "?", hint: "command" });
  bars.push({ id: "effectParam", row: 1, label: "PARAM", field: "effectParam", values: range(0, 255), value: event.effectParam, clearable: true, format: (v) => toHex(v, 2), hint: "fx value" });

  return bars;
}

function nearestIndex(values, v) {
  if (typeof v === "string") return Math.max(0, values.indexOf(v));
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
  return best;
}

/** Where a bar's fill ends, 0..1 (0 when the field is empty). A clearable bar reserves its lowest
 * slot for "unset", so a set value is always visibly above an empty one. */
export function barFraction(bar) {
  if (bar.value === null || bar.value === undefined) return 0;
  const i = nearestIndex(bar.values, bar.value);
  if (bar.clearable) return (i + 1) / bar.values.length;
  return bar.values.length === 1 ? 1 : i / (bar.values.length - 1);
}

/** The bar value for a pointer at `fraction` (0 = bottom, 1 = top) of the bar's height; `null` means
 * "clear the field" (clearable bars only, the bottom slot). */
export function valueAtFraction(bar, fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  const n = bar.values.length;
  if (bar.clearable) {
    const slot = Math.min(n, Math.floor(f * (n + 1))); // 0 = unset, 1..n = values
    return slot === 0 ? null : bar.values[slot - 1];
  }
  return bar.values[Math.min(n - 1, Math.round(f * (n - 1)))];
}

/** The stored field value for a chosen bar value (null clears). */
export function fieldValue(bar, value) {
  if (value === null) return null;
  return bar.toField ? bar.toField(value) : value;
}

/** The bar value one step up/down from the current one (big = a larger jump), clamped; stepping down
 * from the lowest value of a clearable bar clears it. */
export function stepBarValue(bar, dir, big = false) {
  const n = bar.values.length;
  const jump = big ? Math.max(2, Math.round(n / 8)) : 1;
  const cur = bar.value === null || bar.value === undefined ? -1 : nearestIndex(bar.values, bar.value);
  const next = cur + dir * jump;
  if (next < 0) return bar.clearable ? null : bar.values[0];
  return bar.values[Math.min(n - 1, next)];
}
