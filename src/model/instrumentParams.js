import { noteNumberToName } from "./notes.js";
import { frequencyToNote, noteToFrequency } from "./pitch.js";

// Public control catalog for webdsp's synthesized instruments (AudioRuntime.createInstrument/
// setInstrumentParameter — node_modules/webdsp's docs/instruments.md). Same shape/conventions
// as model/fxParams.js's FX_PARAMS and model/envelopeParams.js's ENVELOPE_PARAMS (id/label/
// min/max/default/step/unit) — model/ stays webdsp-free (docs/EXTENDING.md's layer map);
// audio/instrument.js is the only place `webdspParam` below gets bridged to webdsp's real
// per-kind param enum (e.g. KickParam) and actually sent to the engine, the same split
// audio/fx.js has for FX_PARAMS#nodeParam.
//
// min/max/default/unit mirror webdsp's own docs/kick-instrument.md and
// docs/percussion-instruments.md tables exactly — not this app's own musical range the way
// e.g. model/fxParams.js's Filter/Delay ranges are (those genuinely aren't documented by
// webdsp itself). Every kind's are authoritative straight from the engine's own control
// contract (`getInstrumentParams` — the engine self-describes every instrument's controls),
// so there's no reason to invent different ones here.
export const KICK_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 30, max: 120, default: 50, step: 1, unit: "Hz", scale: "note" },
  { id: "pitchDrop", webdspParam: "PitchDrop", label: "Pitch Drop", min: 0, max: 4, default: 2.5, step: 0.1, unit: "oct" },
  { id: "pitchDecay", webdspParam: "PitchDecay", label: "Pitch Decay", min: 0.005, max: 0.25, default: 0.04, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 2, default: 0.45, step: 0.01, unit: "s" },
  { id: "punch", webdspParam: "Punch", label: "Punch", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

// Snare/Clap/Tom/Hi-Hat — mirror webdsp's own docs/percussion-instruments.md table exactly,
// the same hand-mirroring convention KICK_PARAMS above already follows.
export const SNARE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 100, max: 400, default: 185, step: 1, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 0.8, default: 0.22, step: 0.01, unit: "s" },
  { id: "snap", webdspParam: "Snap", label: "Snap", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
];

export const CLAP_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 600, max: 3000, default: 1300, step: 1, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 0.8, default: 0.25, step: 0.01, unit: "s" },
  { id: "spread", webdspParam: "Spread", label: "Spread", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "snap", webdspParam: "Snap", label: "Snap", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
];

export const TOM_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 60, max: 400, default: 120, step: 1, unit: "Hz", scale: "note" },
  { id: "pitchDrop", webdspParam: "PitchDrop", label: "Pitch Drop", min: 0, max: 2, default: 0.6, step: 0.1, unit: "oct" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.1, max: 1.5, default: 0.45, step: 0.01, unit: "s" },
  { id: "body", webdspParam: "Body", label: "Body", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "damp", webdspParam: "Damp", label: "Damp", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

export const HIHAT_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: -12, max: 12, default: 0, step: 1, unit: "st" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.02, max: 1.2, default: 0.08, step: 0.01, unit: "s" },
  { id: "metal", webdspParam: "Metal", label: "Metal", min: 0, max: 1, default: 0.7, step: 0.01, unit: "" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
];

// Bass — mirrors webdsp's own docs/bass-instrument.md table. Unlike the drums it is a
// *sustained* voice with its own internal filter and ADSR (attack/decay/sustain/release are
// instrument params here, not the sample-style EnvelopeParams), and it is a mono bass line
// instrument: see SYNTH_KINDS' `sustained`/`rootNote` below.
// Legato/slide: with Legato on, a note landing while the previous one is still held (note length
// >= its step) continues the same voice (no re-attack) and its pitch glides over Slide seconds;
// a gap between notes re-attacks normally. Legato is a stepped Off/On control like Pulse's Rate.
export const BASS_LEGATO_OPTIONS = ["Off", "On"];
export const BASS_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 110, default: 55, step: 0.5, unit: "Hz", scale: "note" },
  { id: "body", webdspParam: "Body", label: "Body", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "bite", webdspParam: "Bite", label: "Bite", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 40, max: 4000, default: 400, step: 1, unit: "Hz" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.25, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 2, default: 0.35, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.1, step: 0.01, unit: "s" },
  { id: "legato", webdspParam: "Legato", label: "Legato", min: 0, max: 1, default: 0, step: 1, unit: "", options: BASS_LEGATO_OPTIONS },
  { id: "slide", webdspParam: "Slide", label: "Slide", min: 0, max: 0.5, default: 0, step: 0.01, unit: "s" },
  // Filter Mod: how far the note's timbre envelope moves the cutoff (0 = static filter). Bite no
  // longer sets this; it is only onset drive and velocity -> timbre.
  { id: "filterMod", webdspParam: "FilterMod", label: "Filter Mod", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
];

// Pulse — mirrors webdsp's own docs/pulse-instrument.md table. A sustained rhythmic synth whose
// pump (ducking) and repeat (filter movement) lock to the tempo grid the lookahead player hands
// the engine (audio/lookaheadPlayer.js, runtime.setTempo), not to note starts. `rate` is a
// *stepped* control (`options`: one label per whole step), not a continuous value. Its ADSR is
// attack/release only (decay/sustain are private to webdsp).
export const PULSE_RATE_OPTIONS = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"];
export const PULSE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 440, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 60, max: 6000, default: 500, step: 1, unit: "Hz" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.25, step: 0.01, unit: "" },
  { id: "pump", webdspParam: "Pump", label: "Pump", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "repeat", webdspParam: "Repeat", label: "Repeat", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "rate", webdspParam: "Rate", label: "Rate", min: 0, max: 5, default: 2, step: 1, unit: "", options: PULSE_RATE_OPTIONS },
  { id: "diffuse", webdspParam: "Diffuse", label: "Diffuse", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.08, step: 0.01, unit: "s" },
  // Filter Mod: how far each repeat cycle opens the filter (0 = static). Repeat is only the
  // rhythmic drive (grit) per cycle now.
  { id: "filterMod", webdspParam: "FilterMod", label: "Filter Mod", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
];

// Pad — mirrors webdsp's docs/pad-instrument.md table. A sustained, free-running stereo ensemble
// pad (not tempo-synced). A new note on a sounding slot moves the previous one into its release,
// so consecutive notes overlap without extra slots; chords still need one slot per voice. Its
// attack/release are long (up to 8 s / 12 s), unlike Bass and Pulse.
export const PAD_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 440, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "movement", webdspParam: "Movement", label: "Movement", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "detune", webdspParam: "Detune", label: "Detune", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "space", webdspParam: "Space", label: "Space", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.02, max: 8, default: 0.8, step: 0.01, unit: "s" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.1, max: 12, default: 3, step: 0.1, unit: "s" },
];

// One entry per webdsp InstrumentKind, mirroring the `{ id, name, category, params }` shape
// `runtime.getCapabilities().instruments` itself reports (node_modules/webdsp's
// docs/instruments.md) — model/ stays webdsp-free (docs/EXTENDING.md's layer map) so this is a
// hand-mirror, not a live read, but it means this one table is both the param catalog lookup
// (SYNTH_PARAMS_BY_KIND below) and the only place UI code needs to iterate to list every synth
// kind (ui/chrome/InstrumentPanel.jsx's output-type buttons) — not a second, separate list of
// instrument names.
export const SYNTH_KINDS = [
  { id: "kick", name: "Kick", category: "drum", params: KICK_PARAMS },
  { id: "snare", name: "Snare", category: "drum", params: SNARE_PARAMS },
  { id: "clap", name: "Clap", category: "drum", params: CLAP_PARAMS },
  { id: "tom", name: "Tom", category: "drum", params: TOM_PARAMS },
  { id: "hihat", name: "Hi-Hat", category: "drum", params: HIHAT_PARAMS },
  // `sustained`: the note is held for its tracker note length (compile.js passes `duration`) and
  // released by the engine, sample-accurately; one-shot drums never get one (it would choke them).
  // `rootNote`: the tracker note that plays the instrument at its own `tune` (event.note -
  // rootNote = webdsp's note `pitch`). Bass tune defaults to 55 Hz = A-1 = note 33, so a bass line
  // is written at its real pitch instead of 27 semitones below a C-4 root.
  { id: "bass", name: "Bass", category: "bass", params: BASS_PARAMS, sustained: true, rootNote: 33 },
  // Pulse tune defaults to 110 Hz = A-2 = note 45 (webdsp's pulse-client-guide.md).
  { id: "pulse", name: "Pulse", category: "synth", params: PULSE_PARAMS, sustained: true, rootNote: 45 },
  // Pad tune defaults to 110 Hz = A-2 = note 45, like Pulse (webdsp's docs/pad-instrument.md).
  { id: "pad", name: "Pad", category: "synth", params: PAD_PARAMS, sustained: true, rootNote: 45 },
];

// Registry of every synthesized-instrument kind's own param catalog, keyed by the same string
// `Instrument.output.kind` (model/instrument.js) uses. Derived from SYNTH_KINDS above rather
// than hand-listed again.
export const SYNTH_PARAMS_BY_KIND = Object.fromEntries(SYNTH_KINDS.map((k) => [k.id, k.params]));

export function getSynthKind(kind) {
  return SYNTH_KINDS.find((k) => k.id === kind);
}

export function isSustainedSynthKind(kind) {
  return getSynthKind(kind)?.sustained === true;
}

// The tracker root note a synth kind plays at its own tune; 60 (model/instrument.js's default)
// for kinds that do not specify one.
export const DEFAULT_ROOT_NOTE = 60;
export function synthKindRootNote(kind) {
  return getSynthKind(kind)?.rootNote ?? DEFAULT_ROOT_NOTE;
}

export function getSynthParams(kind) {
  return SYNTH_PARAMS_BY_KIND[kind] ?? [];
}

export function getSynthParam(kind, id) {
  return getSynthParams(kind).find((param) => param.id === id);
}

export function defaultSynthParamValues(kind) {
  return Object.fromEntries(getSynthParams(kind).map((param) => [param.id, param.default]));
}

function decimalsForStep(step) {
  if (!step || step >= 1) return 0;
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Slider-facing view of a param. Hz params flagged `scale: "note"` are driven in note-number
// (semitone) space so equal slider steps are equal musical intervals; the stored/webdsp value
// stays Hz. The note range is the catalog's Hz range narrowed to whole notes inside it.
export function synthParamControl(param) {
  if (param.scale !== "note") {
    return { min: param.min, max: param.max, step: param.step, toSlider: (v) => v, fromSlider: (v) => v };
  }
  return {
    min: Math.ceil(frequencyToNote(param.min) - 1e-9),
    max: Math.floor(frequencyToNote(param.max) + 1e-9),
    step: 1,
    toSlider: (hz) => frequencyToNote(hz),
    fromSlider: (note) => Math.min(param.max, Math.max(param.min, noteToFrequency(note))),
  };
}

export function formatSynthParamValue(value, param) {
  if (value === null || value === undefined || !param) return "--";
  if (param.scale === "note") {
    const note = frequencyToNote(value);
    const nearest = Math.round(note);
    const cents = Math.round((note - nearest) * 100);
    return cents === 0 ? noteNumberToName(nearest) : `${noteNumberToName(nearest)} ${cents > 0 ? "+" : ""}${cents}c`;
  }
  if (param.options) return param.options[Math.round(value)] ?? "--";
  if (param.unit === "st") return `${value > 0 ? "+" : ""}${Number(value).toFixed(decimalsForStep(param.step))} st`;
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
