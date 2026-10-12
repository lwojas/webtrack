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
    // Sparse FX automation: { [fxParamId]: value } | null — only the parameters actually set
    // at this cell (model/fxParams.js is the id catalog). A value here means "this track's
    // insert bus takes this value from this cell onward"; a param absent from this map is left
    // wherever it last was — never reset (see audio/compile.js#compileRowFx). Distinct from the
    // older effectCommand/effectParam single-slot tracker command above, which this doesn't
    // replace.
    fx: null,
  };
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
    (!event.fx || Object.keys(event.fx).length === 0)
  );
}

// A plain `{ ...event }` spread would alias the same `fx` object between source and clone —
// an edit to one cell's fx map would then silently leak into every cell pasted/duplicated from
// it (see model/mutations.js#pasteEvent/duplicatePattern, and the in-place-mutation habits
// docs/ARCHITECTURE.md's Gotcha #1 already warns about elsewhere in this codebase).
export function cloneEvent(event) {
  return { ...event, fx: event.fx ? { ...event.fx } : null };
}
