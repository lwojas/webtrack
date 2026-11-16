// Per-instrument editor layout (ui/chrome/InstrumentPanel.jsx): named groups of controls with their
// own accent hue and size, so an instrument's panel can show hierarchy and identity. Display only —
// never read by compile or the audio engine, and never changes a parameter value.
//
//   ui = { groups: [{ id, name, hue, size, collapsed }], assign: { [controlId]: groupId } } | null
//
// hue is 0-359 or null (neutral); size is "s" | "m" | "l" (knob / row scale). A control with no
// assignment, or one pointing at a group that no longer exists, stays in the ungrouped flow.
export const GROUP_SIZES = ["s", "m", "l"];
export const MAX_GROUPS = 12;
const MAX_NAME = 24;

const clampHue = (hue) => (Number.isFinite(hue) ? ((Math.round(hue) % 360) + 360) % 360 : null);

function cleanGroup(group, fallbackId) {
  return {
    id: typeof group?.id === "string" && group.id ? group.id : fallbackId,
    name: String(group?.name ?? "").trim().slice(0, MAX_NAME) || "GROUP",
    hue: clampHue(group?.hue),
    size: GROUP_SIZES.includes(group?.size) ? group.size : "m",
    collapsed: group?.collapsed === true,
  };
}

// Any saved/in-memory shape -> a clean ui, or null when it carries nothing (so untouched instruments
// serialize to nothing, like the other additive fields).
export function normalizeInstrumentUi(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.groups)) return null;
  const seen = new Set();
  const groups = [];
  raw.groups.slice(0, MAX_GROUPS).forEach((g, i) => {
    const group = cleanGroup(g, `g${i + 1}`);
    if (seen.has(group.id)) return;
    seen.add(group.id);
    groups.push(group);
  });
  if (groups.length === 0) return null;
  const assign = {};
  for (const [controlId, groupId] of Object.entries(raw.assign ?? {})) {
    if (seen.has(groupId)) assign[controlId] = groupId;
  }
  return { groups, assign };
}

const editable = (ui) => normalizeInstrumentUi(ui) ?? { groups: [], assign: {} };

function nextGroupId(groups) {
  let n = groups.length + 1;
  while (groups.some((g) => g.id === `g${n}`)) n++;
  return `g${n}`;
}

export function addGroup(ui, name = "GROUP") {
  const next = editable(ui);
  if (next.groups.length >= MAX_GROUPS) return normalizeInstrumentUi(next);
  next.groups.push(cleanGroup({ name }, nextGroupId(next.groups)));
  return next;
}

export function updateGroup(ui, groupId, patch) {
  const next = editable(ui);
  next.groups = next.groups.map((g) => (g.id === groupId ? cleanGroup({ ...g, ...patch, id: g.id }, g.id) : g));
  return normalizeInstrumentUi(next);
}

export function removeGroup(ui, groupId) {
  const next = editable(ui);
  next.groups = next.groups.filter((g) => g.id !== groupId);
  return normalizeInstrumentUi(next);
}

// groupId null/unknown = ungrouped.
export function assignControl(ui, controlId, groupId) {
  const next = editable(ui);
  if (next.groups.some((g) => g.id === groupId)) next.assign[controlId] = groupId;
  else delete next.assign[controlId];
  return normalizeInstrumentUi(next);
}

// Splits an ordered control list into the ungrouped controls and one bucket per group (in group
// order, empty groups kept so they can still be renamed/filled). `idOf` reads a control's id.
export function layoutControls(ui, controls, idOf = (c) => c.id) {
  const clean = normalizeInstrumentUi(ui);
  if (!clean) return { ungrouped: controls, groups: [] };
  const buckets = new Map(clean.groups.map((g) => [g.id, []]));
  const ungrouped = [];
  for (const control of controls) {
    const bucket = buckets.get(clean.assign[idOf(control)]);
    (bucket ?? ungrouped).push(control);
  }
  return { ungrouped, groups: clean.groups.map((group) => ({ group, controls: buckets.get(group.id) })) };
}
