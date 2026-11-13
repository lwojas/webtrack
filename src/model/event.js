// The ratchet counts a note can have; 1 is "normal" and is stored as null.
export const RATCHET_VALUES = [1, 2, 3, 4, 6, 8];

// A note's ratchet as playback uses it: always one of RATCHET_VALUES (a loaded project is not
// trusted), 1 when absent or unknown.
export function ratchetOf(event) {
  const r = event?.ratchet;
  return RATCHET_VALUES.includes(r) ? r : 1;
}

// The value to store for a chosen ratchet: null for "normal" (and anything unsupported), so
// untouched notes stay identical to ones saved before ratchets existed.
export function normalizeRatchet(value) {
  const r = Number(value);
  return RATCHET_VALUES.includes(r) && r > 1 ? r : null;
}

// Pitch ratchet: each retrigger of a ratcheted note can sound at its own pitch (OctaMED-style rolls).
// Event.ratchetPitch is a linear step in semitones per hit (hit i plays i * step above the note);
// Event.ratchetPattern names a preset whose offsets cycle across the hits and win over the step.
export const RATCHET_PITCH_MAX = 12;
export const RATCHET_PATTERNS = [
  { id: "oct", label: "0 +12", offsets: [0, 12] },
  { id: "fifth", label: "0 +7", offsets: [0, 7] },
  { id: "major", label: "0 +4 +7", offsets: [0, 4, 7] },
  { id: "minor", label: "0 +3 +7", offsets: [0, 3, 7] },
  { id: "arp", label: "0 +4 +7 +12", offsets: [0, 4, 7, 12] },
  { id: "updown", label: "0 +5 +7 +5", offsets: [0, 5, 7, 5] },
  { id: "drop", label: "0 -12", offsets: [0, -12] },
  { id: "fall", label: "0 -3 -5 -7", offsets: [0, -3, -5, -7] },
];

// Semitones added to hit `hit` (0-based) of a ratcheted note. 0 for a plain note, so untouched notes compile as before.
export function ratchetPitchOffset(event, hit) {
  if (ratchetOf(event) === 1) return 0;
  const pattern = RATCHET_PATTERNS.find((p) => p.id === event?.ratchetPattern);
  if (pattern) return pattern.offsets[hit % pattern.offsets.length];
  const step = Number(event?.ratchetPitch);
  return Number.isFinite(step) ? Math.round(step) * hit : 0;
}

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
    // Track LFO participation (model/eventLfo.js): 0..1, or null = this step plays at its own
    // velocity. Authored like velocity; the effective velocity is computed at playback.
    lfo: null,
    // Ratchet: how many evenly spaced retriggers this note plays across its own length (see
    // RATCHET_VALUES). null = 1, a normal single trigger. A property of the note, not extra rows.
    ratchet: null,
    // Pitch ratchet (only with a ratchet > 1): semitones added per hit, and/or a preset pattern id (RATCHET_PATTERNS). null = none.
    ratchetPitch: null,
    ratchetPattern: null,
    // Chop transpose: semitones added to the instrument's chopPitch for this note (chop slots only), null = 0.
    chopTranspose: null,
    // Tie: this note is held through the next note on the track, which glides in with no re-attack (a
    // 303-style slide). true | null; only meaningful for a synth with a legato mode (supportsTieKind).
    tie: null,
    // Chord: this note is the ROOT of a chord (model/chord.js: { type, inversion, spread, offsets? }), played as one trigger
    // per tone. null = a plain note.
    chord: null,
    // Sparse FX automation: { "bus.gain"?: value, instances?: { [instanceId]: { [fxParamId]:
    // value } } } | null — only the parameters actually set at this cell (model/fxParams.js is
    // the id catalog), mirroring trackChannel.fx's own shape (model/trackChannel.js's doc
    // comment) so a cell can unambiguously automate one specific stacked FX instance's parameter
    // (e.g. the *second* of two Filters on this track), not just "whichever Filter." A value here
    // means "this track's insert bus takes this value from this cell onward"; a param absent
    // from this map is left wherever it last was — never reset (see audio/compile.js#
    // compileRowFx). Distinct from the older effectCommand/effectParam single-slot tracker
    // command above, which this doesn't replace.
    // Two further optional keys, both sparse like the above: `instruments: { [slotIndex]: {
    // [paramId]: value } }` automates an instrument slot's controls (named explicitly: instruments
    // are global, not bound to the track — model/cellAutomation.js), and `glide: { [key]: true }`
    // marks entries that ramp to the next value of the same parameter on this track instead of
    // stepping. model/cellAutomation.js describes the key scheme and reads all of it uniformly.
    fx: null,
  };
}

// A cell's fx map is empty once it has no flat "bus.gain" entry and no (or no populated)
// per-instance bags — model/mutations.js#removeFxEntry/removeCellFxInstanceEntry are what
// collapse a map back down to this as its last key is removed.
function isEmptyFx(fx) {
  if (!fx) return true;
  // `glide` only qualifies an existing value, so it never makes a cell non-empty on its own.
  const keys = Object.keys(fx).filter((key) => key !== "instances" && key !== "instruments" && key !== "glide");
  const hasBag = (bags) => bags && Object.values(bags).some((bag) => Object.keys(bag).length > 0);
  return keys.length === 0 && !hasBag(fx.instances) && !hasBag(fx.instruments);
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
    (event.lfo ?? null) === null &&
    (event.ratchet ?? null) === null &&
    (event.tie ?? null) === null &&
    isEmptyFx(event.fx)
  );
}

// True when the event holds anything a note track plays — a note, instrument, velocity, pan,
// command, length, LFO, ratchet or tie — as opposed to FX automation alone.
export function hasNoteData(event) {
  return !isEmptyEvent({ ...event, fx: null });
}

// The event reduced to its FX automation: what a send track keeps of a pasted or filled cell.
export function fxOnlyEvent(event) {
  return { ...createEmptyEvent(), fx: cloneEvent(event).fx };
}

// A plain `{ ...event }` spread would alias the same `fx` object (and its nested `instances`
// bags) between source and clone — an edit to one cell's fx map would then silently leak into
// every cell pasted/duplicated from it (see model/mutations.js#pasteEvent/duplicatePattern, and
// the in-place-mutation habits docs/ARCHITECTURE.md's Gotcha #1 already warns about elsewhere in
// this codebase). One level deeper than before fx.instances existed: each instance's own param
// bag needs its own copy too, not just the outer fx object and the shared `instances` container.
export function cloneEvent(event) {
  if (event.chord) event = { ...event, chord: { ...event.chord, ...(event.chord.offsets ? { offsets: [...event.chord.offsets] } : {}) } };
  if (!event.fx) return { ...event, fx: null };
  const cloneBags = (bags) => Object.fromEntries(Object.entries(bags).map(([id, bag]) => [id, { ...bag }]));
  const extra = {};
  if (event.fx.instances) extra.instances = cloneBags(event.fx.instances);
  if (event.fx.instruments) extra.instruments = cloneBags(event.fx.instruments);
  if (event.fx.glide) extra.glide = { ...event.fx.glide };
  return { ...event, fx: { ...event.fx, ...extra } };
}
