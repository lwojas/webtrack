// Cell automation: the sparse, per-cell parameter values a tracker row carries (Event.fx), seen as
// one thing whatever they target. A cell value means "from this row onward this parameter takes
// this value"; with glide it instead means "ramp from this value to the next value of the same
// parameter on this track". The automation editor (ui/chrome/AutomationEditor.jsx) is a view over
// these very entries across the rows of one track: there is no second data model.
//
// Three targets, one key scheme (a string, so it is also the lane id the editor picks and the key
// of Event.fx.glide):
//   "bus.gain"             the track bus's output gain (flat key in Event.fx)
//   "fx:<instanceId>:<id>" one parameter of one FX chain instance (Event.fx.instances)
//   "inst:<slot>:<id>"     one parameter of one instrument slot (Event.fx.instruments). The slot is
//                          named explicitly: instruments are global and a track's cells may use
//                          several, so "the instrument of this note" would be ambiguous.
// webdsp-free, like all of model/.
import { getFxParam, getFxParamsForType } from "./fxParams.js";
import { ENVELOPE_PARAMS } from "./envelopeParams.js";
import { getSynthParams } from "./instrumentParams.js";

export const BUS_GAIN_KEY = "bus.gain";

export const fxKey = (instanceId, paramId) => `fx:${instanceId}:${paramId}`;
export const instKey = (slot, paramId) => `inst:${slot}:${paramId}`;

// -> { kind: "bus"|"fx"|"inst", paramId, instanceId?, slot? } | null
export function parseKey(key) {
  if (key === BUS_GAIN_KEY) return { kind: "bus", paramId: BUS_GAIN_KEY };
  const [scope, id, ...rest] = String(key).split(":");
  const paramId = rest.join(":");
  if (!paramId || !Number.isInteger(Number(id))) return null;
  if (scope === "fx") return { kind: "fx", instanceId: Number(id), paramId };
  if (scope === "inst") return { kind: "inst", slot: Number(id), paramId };
  return null;
}

// The automatable parameters of an instrument slot, in the shape the FX catalog uses (id, label,
// min, max, default, step, unit): a synth's continuous controls, or a sample's ADSR. Stepped
// (options) controls are left out: a ramp through a switch is meaningless.
export function getInstrumentAutomationParams(instrument) {
  if (!instrument) return [];
  if (instrument.output?.type === "instrument" && instrument.output.kind) {
    return getSynthParams(instrument.output.kind).filter((p) => !p.options);
  }
  if (instrument.output?.type === "sample" || !instrument.output) return ENVELOPE_PARAMS;
  return []; // MIDI output has no parameters
}

// The parameter definition a key addresses, or null (unknown / no longer valid). `channel` is the
// track's channel (its fxChain), `instruments` the song's instrument slots.
export function getAutomationParam(key, channel, instruments) {
  const t = parseKey(key);
  if (!t) return null;
  if (t.kind === "bus") return getFxParam(BUS_GAIN_KEY) ?? null;
  if (t.kind === "fx") {
    const entry = channel?.fxChain?.find((e) => e.id === t.instanceId);
    return entry ? (getFxParamsForType(entry.type).find((p) => p.id === t.paramId) ?? null) : null;
  }
  return getInstrumentAutomationParams(instruments?.[t.slot]).find((p) => p.id === t.paramId) ?? null;
}

// The parameter's current base value (what a new entry is seeded with, so adding automation
// changes nothing audible until it is edited).
export function getBaseValue(key, channel, instruments) {
  const t = parseKey(key);
  const param = getAutomationParam(key, channel, instruments);
  if (!t || !param) return null;
  if (t.kind === "bus") return channel?.fx?.[BUS_GAIN_KEY] ?? param.default;
  if (t.kind === "fx") return channel?.fx?.instances?.[t.instanceId]?.[t.paramId] ?? param.default;
  const instrument = instruments[t.slot];
  if (instrument.output?.type === "instrument") return instrument.instrumentParams?.[t.paramId] ?? param.default;
  return instrument.envelope?.[t.paramId] ?? param.default;
}

// --- reading a cell ---

export function getCellValue(event, key) {
  const t = parseKey(key);
  if (!t || !event?.fx) return undefined;
  if (t.kind === "bus") return event.fx[BUS_GAIN_KEY];
  if (t.kind === "fx") return event.fx.instances?.[t.instanceId]?.[t.paramId];
  return event.fx.instruments?.[t.slot]?.[t.paramId];
}

export function isGlide(event, key) {
  return Boolean(event?.fx?.glide?.[key]);
}

// Every entry of a cell: [{ key, kind, paramId, instanceId?, slot?, value, glide }].
export function listCellEntries(event) {
  const fx = event?.fx;
  if (!fx) return [];
  const out = [];
  const push = (key, t, value) => out.push({ key, ...t, value, glide: Boolean(fx.glide?.[key]) });
  if (fx[BUS_GAIN_KEY] !== undefined) push(BUS_GAIN_KEY, { kind: "bus", paramId: BUS_GAIN_KEY }, fx[BUS_GAIN_KEY]);
  for (const id in fx.instances ?? {}) {
    for (const paramId in fx.instances[id]) push(fxKey(id, paramId), { kind: "fx", instanceId: Number(id), paramId }, fx.instances[id][paramId]);
  }
  for (const slot in fx.instruments ?? {}) {
    for (const paramId in fx.instruments[slot]) push(instKey(slot, paramId), { kind: "inst", slot: Number(slot), paramId }, fx.instruments[slot][paramId]);
  }
  return out;
}

// --- reading a track (the editor's lane) ---

// The lane's points over the track's own loop: [{ row, value, glide }], row ascending, rows
// 0..track.length-1 only (entries past the loop point are kept in the data but not played).
export function trackPoints(track, key) {
  const points = [];
  const length = Math.min(track.length || track.events.length, track.events.length);
  for (let row = 0; row < length; row++) {
    const value = getCellValue(track.events[row], key);
    if (value !== undefined) points.push({ row, value, glide: isGlide(track.events[row], key) });
  }
  return points;
}

// Distinct keys that have at least one point inside the track's loop, in first-appearance order.
export function trackKeys(track) {
  const seen = new Set();
  const length = Math.min(track.length || track.events.length, track.events.length);
  for (let row = 0; row < length; row++) for (const e of listCellEntries(track.events[row])) seen.add(e.key);
  return [...seen];
}

// The next row after `row` (inside the loop, no wrap) holding a value for `key`, or null.
export function nextPoint(track, row, key) {
  const length = Math.min(track.length || track.events.length, track.events.length);
  for (let r = row + 1; r < length; r++) {
    const value = getCellValue(track.events[r], key);
    if (value !== undefined) return { row: r, value };
  }
  return null;
}

// Every key that some cell sets, in any pattern (optionally only one track): which parameters are
// automated somewhere. The panels show a marker on those parameters, so an instrument parameter that
// a track's cells move, or an FX parameter with points, is visible where it is edited.
export function automatedKeys(song, trackIndex = null) {
  const keys = new Set();
  for (const pattern of song.patterns) {
    pattern.tracks.forEach((track, i) => {
      if (trackIndex !== null && i !== trackIndex) return;
      for (const event of track.events) for (const entry of listCellEntries(event)) keys.add(entry.key);
    });
  }
  return keys;
}
