export function createEmptyEvent() {
  return {
    note: null,
    instrument: null,
    velocity: null,
    pan: null,
    effectCommand: null,
    effectParam: null,
    // Steps the note holds for. null = auto (hold until the next non-empty note on the same
    // track, or a 1-step default — see audio/compile.js#noteDurationSteps).
    length: null,
    // Sparse FX automation: { "bus.gain"?: value, instances?: { [instanceId]: { [fxParamId]:
    // value } } } | null — only the parameters actually set at this cell (model/fxParams.js is
    // the id catalog), mirroring trackChannel.fx's own shape (model/trackChannel.js's doc
    // comment) so a cell can unambiguously automate one specific stacked FX instance's parameter
    // (e.g. the *second* of two Filters on this track), not just "whichever Filter." A value here
    // means "this track's insert bus takes this value from this cell onward"; a param absent
    // from this map is left wherever it last was — never reset (see audio/compile.js#
    // compileRowFx). Distinct from the older effectCommand/effectParam single-slot tracker
    // command above, which this doesn't replace.
    fx: null,
  };
}

// A cell's fx map is empty once it has no flat "bus.gain" entry and no (or no populated)
// per-instance bags — model/mutations.js#removeFxEntry/removeCellFxInstanceEntry are what
// collapse a map back down to this as its last key is removed.
function isEmptyFx(fx) {
  if (!fx) return true;
  const keys = Object.keys(fx).filter((key) => key !== "instances");
  const hasInstanceValues = fx.instances && Object.values(fx.instances).some((bag) => Object.keys(bag).length > 0);
  return keys.length === 0 && !hasInstanceValues;
}

export function isEmptyEvent(event) {
  return (
    event.note === null &&
    event.instrument === null &&
    event.velocity === null &&
    event.pan === null &&
    event.effectCommand === null &&
    event.effectParam === null &&
    event.length === null &&
    isEmptyFx(event.fx)
  );
}

// A plain `{ ...event }` spread would alias the same `fx` object (and its nested `instances`
// bags) between source and clone — an edit to one cell's fx map would then silently leak into
// every cell pasted/duplicated from it (see model/mutations.js#pasteEvent/duplicatePattern, and
// the in-place-mutation habits docs/ARCHITECTURE.md's Gotcha #1 already warns about elsewhere in
// this codebase). One level deeper than before fx.instances existed: each instance's own param
// bag needs its own copy too, not just the outer fx object and the shared `instances` container.
export function cloneEvent(event) {
  if (!event.fx) return { ...event, fx: null };
  const instances = event.fx.instances
    ? Object.fromEntries(Object.entries(event.fx.instances).map(([id, bag]) => [id, { ...bag }]))
    : undefined;
  return { ...event, fx: { ...event.fx, ...(instances ? { instances } : {}) } };
}
