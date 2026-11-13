// The CC map: which MIDI CC (and channel) drives each control in ccCatalog.js. Pure data and functions, no MIDI or DOM.
//
//   bindings   { [controlId]: { cc: 0..127, channel: 0..15 | null } }   what is in effect (defaults + the user's changes)
//   overrides  the same shape, only for controls the user changed; this is all that is saved. A control added to the
//              catalog later therefore gets its default without touching anyone's saved map.
//   lookup     Map keyed by channel * 128 + cc -> [{ def, index }], rebuilt only when a binding changes, so routing a
//              message is a single Map.get. Strip controls are expanded once, one entry per MIDI channel.
import { CC_CONTROLS, CC_CONTROL_BY_ID, STRIP_COUNT } from "./ccCatalog.js";

export const STORAGE_KEY = "webtrack.midiCcMap";

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// A binding as the control accepts it, or null: strip controls only carry a CC (channel null = "follows the strip"),
// global ones also a channel.
export function normalizeBinding(def, binding) {
  if (!def || !binding || !isInt(binding.cc, 0, 127)) return null;
  if (def.scope === "strip") return { cc: binding.cc, channel: null };
  return isInt(binding.channel, 0, 15) ? { cc: binding.cc, channel: binding.channel } : null;
}

export function defaultBinding(def) {
  return normalizeBinding(def, { channel: def.default.channel ?? 0, ...def.default });
}

export function defaultBindings() {
  return Object.fromEntries(CC_CONTROLS.map((def) => [def.id, defaultBinding(def)]));
}

// Defaults with the user's overrides applied; unknown ids and malformed entries (a hand-edited or older save) are ignored.
export function resolveBindings(overrides) {
  const bindings = defaultBindings();
  for (const [id, value] of Object.entries(overrides ?? {})) {
    const def = CC_CONTROL_BY_ID.get(id);
    const binding = normalizeBinding(def, value);
    if (binding) bindings[id] = binding;
  }
  return bindings;
}

export function sameBinding(a, b) {
  return a?.cc === b?.cc && (a?.channel ?? null) === (b?.channel ?? null);
}

// The part of `bindings` that differs from the defaults.
export function diffFromDefaults(bindings) {
  const out = {};
  for (const def of CC_CONTROLS) {
    if (bindings[def.id] && !sameBinding(bindings[def.id], defaultBinding(def))) out[def.id] = bindings[def.id];
  }
  return out;
}

// Every (channel, cc) a control answers to: one for a global control, one per strip for a strip control.
function slotsOf(def, binding) {
  if (def.scope === "global") return [{ channel: binding.channel, index: 0 }];
  return Array.from({ length: STRIP_COUNT }, (_, channel) => ({ channel, index: channel }));
}

export function buildLookup(bindings) {
  const lookup = new Map();
  for (const def of CC_CONTROLS) {
    const binding = bindings[def.id];
    if (!binding) continue;
    for (const { channel, index } of slotsOf(def, binding)) {
      const key = channel * 128 + binding.cc;
      const list = lookup.get(key);
      if (list) list.push({ def, index });
      else lookup.set(key, [{ def, index }]);
    }
  }
  return lookup;
}

// Control ids that share a (channel, cc) with another control, id -> [the others]. Both still fire; the view warns.
export function findConflicts(bindings) {
  const owners = new Map();
  for (const def of CC_CONTROLS) {
    const binding = bindings[def.id];
    if (!binding) continue;
    for (const { channel } of slotsOf(def, binding)) {
      const key = channel * 128 + binding.cc;
      const list = owners.get(key) ?? [];
      if (!list.includes(def.id)) list.push(def.id);
      owners.set(key, list);
    }
  }
  const conflicts = {};
  for (const ids of owners.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) conflicts[id] = [...new Set([...(conflicts[id] ?? []), ...ids.filter((other) => other !== id)])];
  }
  return conflicts;
}

// Saved overrides survive in localStorage, per browser: a controller setup belongs to the user's hardware, not to a project.
export function loadOverrides(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (Object.keys(overrides).length === 0) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage can be blocked or full; the map still works for this session.
  }
}
