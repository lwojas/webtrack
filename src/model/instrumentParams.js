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
  { id: "envMod", webdspParam: "EnvMod", label: "Env Mod", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 2, default: 0.35, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.1, step: 0.01, unit: "s" },
  { id: "legato", webdspParam: "Legato", label: "Legato", min: 0, max: 1, default: 0, step: 1, unit: "", options: BASS_LEGATO_OPTIONS },
  { id: "slide", webdspParam: "Slide", label: "Slide", min: 0, max: 0.5, default: 0, step: 0.01, unit: "s" },
];

// Pulse — mirrors webdsp's own docs/pulse-instrument.md table. A sustained rhythmic synth whose
// pump (ducking) and repeat (filter movement) lock to the tempo grid the lookahead player hands
// the engine (audio/lookaheadPlayer.js, runtime.setTempo), not to note starts. `rate` is a
// *stepped* control (`options`: one label per whole step), not a continuous value. Its ADSR is
// attack/release only (decay/sustain are private to webdsp).
// `pumpRate` is the pumper's own cycle, independent of the repeater's `rate`; its first option
// ("Link", webdsp value -1, the default) follows `rate`. Stepped options are indexed by
// (value - min), see formatSynthParamValue. `pumpAttack` shapes the pump's recovery (sharp duck ->
// long swell); `pluck` adds a per-note filter snap + pitch click + amp decay; `grit` is the
// pre-filter drive (0.5 = classic).
export const PULSE_RATE_OPTIONS = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"];
export const PULSE_PUMP_RATE_OPTIONS = ["Link", ...PULSE_RATE_OPTIONS];
export const PULSE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 440, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 60, max: 6000, default: 500, step: 1, unit: "Hz" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.25, step: 0.01, unit: "" },
  { id: "grit", webdspParam: "Grit", label: "Grit", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "pluck", webdspParam: "Pluck", label: "Pluck", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "pump", webdspParam: "Pump", label: "Pump", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "pumpRate", webdspParam: "PumpRate", label: "Pump Rate", min: -1, max: 5, default: -1, step: 1, unit: "", options: PULSE_PUMP_RATE_OPTIONS },
  { id: "pumpAttack", webdspParam: "PumpAttack", label: "Pump Attack", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "repeat", webdspParam: "Repeat", label: "Repeat", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "rate", webdspParam: "Rate", label: "Rate", min: 0, max: 5, default: 2, step: 1, unit: "", options: PULSE_RATE_OPTIONS },
  { id: "diffuse", webdspParam: "Diffuse", label: "Diffuse", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.08, step: 0.01, unit: "s" },
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

// FM — mirrors webdsp's docs/fm-instrument.md table. A sustained two-operator FM bass/lead. `ratio`
// is a *stepped* control (modulator/carrier ratio: 1/2, 1, 2, 3, 4, 5, 1.414, 3.5; odd ratios are
// hollow, the last two inharmonic/metallic). `timbre` is the resting FM depth and `snap` a bright
// onset that decays. Legato/slide behave as on the Bass.
export const FM_RATIO_OPTIONS = ["1:2", "1:1", "2:1", "3:1", "4:1", "5:1", "1.41", "3.5"];
export const FM_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 880, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "ratio", webdspParam: "Ratio", label: "Ratio", min: 0, max: 7, default: 1, step: 1, unit: "", options: FM_RATIO_OPTIONS },
  { id: "timbre", webdspParam: "Timbre", label: "Timbre", min: 0, max: 1, default: 0.35, step: 0.01, unit: "" },
  { id: "snap", webdspParam: "Snap", label: "Snap", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.75, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 2, default: 0.3, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.1, step: 0.01, unit: "s" },
  { id: "legato", webdspParam: "Legato", label: "Legato", min: 0, max: 1, default: 0, step: 1, unit: "", options: BASS_LEGATO_OPTIONS },
  { id: "slide", webdspParam: "Slide", label: "Slide", min: 0, max: 0.5, default: 0, step: 0.01, unit: "s" },
];

// Hypersaw — mirrors webdsp's docs/hypersaw-instrument.md table. Seven detuned saws as one stereo
// voice. `detune` is in cents (outer pair; note the Pad's `detune` is a 0..1 amount, the id is
// reused with its own range), `spread` the stereo width, `density` the centre-vs-sides mix.
export const HYPERSAW_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 880, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "detune", webdspParam: "Detune", label: "Detune", min: 0, max: 100, default: 25, step: 0.5, unit: "ct" },
  { id: "spread", webdspParam: "Spread", label: "Spread", min: 0, max: 1, default: 0.8, step: 0.01, unit: "" },
  { id: "density", webdspParam: "Density", label: "Density", min: 0, max: 1, default: 0.7, step: 0.01, unit: "" },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 200, max: 16000, default: 5000, step: 1, unit: "Hz" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 4, default: 0.01, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.02, max: 4, default: 0.5, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0.8, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 6, default: 0.4, step: 0.01, unit: "s" },
];

// PWM Beast — mirrors webdsp's docs/pwm-beast-instrument.md table. A pulse-width-modulated character
// synth: `width`/`pwm`/`rate`/`shape` set the pulse and its movement (shape 1 = the note's own
// envelope drives the width), `harmonics` is the fold stage, `drive` the asymmetric drive, `envamt`
// how far the internal envelope opens the filter. `rate` here is the PWM LFO in Hz (Pulse's `rate`
// is a stepped tempo division: same id, own range).
export const PWMBEAST_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 440, default: 55, step: 0.5, unit: "Hz", scale: "note" },
  { id: "width", webdspParam: "Width", label: "Width", min: 0.05, max: 0.95, default: 0.3, step: 0.01, unit: "" },
  { id: "pwm", webdspParam: "Pwm", label: "PWM", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "rate", webdspParam: "Rate", label: "PWM Rate", min: 0.1, max: 200, default: 3.5, step: 0.1, unit: "Hz" },
  { id: "shape", webdspParam: "Shape", label: "PWM Shape", min: 0, max: 1, default: 0.35, step: 0.01, unit: "" },
  { id: "harmonics", webdspParam: "Harmonics", label: "Harmonics", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 60, max: 8000, default: 500, step: 1, unit: "Hz" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.45, step: 0.01, unit: "" },
  { id: "envamt", webdspParam: "EnvAmount", label: "Env Amt", min: 0, max: 1, default: 0.7, step: 0.01, unit: "" },
  { id: "sub", webdspParam: "Sub", label: "Sub", min: 0, max: 1, default: 0.25, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.003, step: 0.001, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 2, default: 0.3, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.01, max: 1.5, default: 0.12, step: 0.01, unit: "s" },
];

// Digital Machines — mirror webdsp's docs/digital-machines.md tables. Five FM instruments on one
// shared kernel; Tune, Decay and the depth control (FM, or Chaos) are the first three of each.
// Thump/Metal/Crack are one-shots; Tone and Chaos are sustained when Hold > 0 (they always receive a
// `duration`, so with Hold 0 the cell length merely truncates the pluck/hit). Several ids reuse an
// existing kind's id with their own range (ratio is a 0..1 magnetic control here, not FM's step).
export const DM_TONE_STRUCTURE_OPTIONS = ["Stack", "Twin", "Fan", "Major", "Minor", "Sus"];
export const DM_THUMP_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 25, max: 400, default: 55, step: 0.5, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.05, max: 2, default: 0.45, step: 0.01, unit: "s" },
  { id: "fm", webdspParam: "Fm", label: "FM", min: 0, max: 1, default: 0.35, step: 0.01, unit: "" },
  { id: "sweep", webdspParam: "Sweep", label: "Sweep", min: 0, max: 4, default: 2, step: 0.05, unit: "oct" },
  { id: "punch", webdspParam: "Punch", label: "Punch", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "ratio", webdspParam: "Ratio", label: "Ratio", min: 0, max: 1, default: 0.17, step: 0.01, unit: "" },
  { id: "body", webdspParam: "Body", label: "Body", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.2, step: 0.01, unit: "" },
];

export const DM_METAL_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 80, max: 1500, default: 320, step: 1, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.02, max: 2, default: 0.12, step: 0.01, unit: "s" },
  { id: "fm", webdspParam: "Fm", label: "FM", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "spread", webdspParam: "Spread", label: "Spread", min: 0, max: 1, default: 0.67, step: 0.01, unit: "" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
  { id: "chick", webdspParam: "Chick", label: "Chick", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.15, step: 0.01, unit: "" },
];

export const DM_TONE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 880, default: 110, step: 0.5, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 3, default: 0.5, step: 0.01, unit: "s" },
  { id: "fm", webdspParam: "Fm", label: "FM", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "structure", webdspParam: "Structure", label: "Structure", min: 0, max: 5, default: 0, step: 1, unit: "", options: DM_TONE_STRUCTURE_OPTIONS },
  { id: "ratio", webdspParam: "Ratio", label: "Ratio", min: 0, max: 1, default: 0.111, step: 0.01, unit: "" },
  { id: "damp", webdspParam: "Damp", label: "Damp", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.001, max: 0.25, default: 0.002, step: 0.001, unit: "s" },
  { id: "hold", webdspParam: "Hold", label: "Hold", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.1, step: 0.01, unit: "" },
];

export const DM_CRACK_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 80, max: 600, default: 190, step: 1, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.04, max: 1, default: 0.18, step: 0.01, unit: "s" },
  { id: "fm", webdspParam: "Fm", label: "FM", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "body", webdspParam: "Body", label: "Body", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0.6, step: 0.01, unit: "" },
  { id: "burst", webdspParam: "Burst", label: "Burst", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "tone", webdspParam: "Tone", label: "Tone", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.2, step: 0.01, unit: "" },
];

export const DM_CHAOS_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 1760, default: 220, step: 0.5, unit: "Hz", scale: "note" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.03, max: 3, default: 0.4, step: 0.01, unit: "s" },
  { id: "chaos", webdspParam: "Chaos", label: "Chaos", min: 0, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "ratio", webdspParam: "Ratio", label: "Ratio", min: 0, max: 1, default: 0.143, step: 0.01, unit: "" },
  { id: "fold", webdspParam: "Fold", label: "Fold", min: 0, max: 1, default: 0.3, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "sweep", webdspParam: "Sweep", label: "Sweep", min: 0, max: 3, default: 0, step: 0.05, unit: "oct" },
  { id: "hold", webdspParam: "Hold", label: "Hold", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
];

// Percussion Synth — mirrors webdsp's docs/percussion-synth.md: two oscillators + noise, one pitch
// sweep, FM, a resonant LP/HP, a drive stage. Registered as a one-shot (not sustained): `sustain` and
// `release` are deliberately not exposed (the engine keeps sustain 0, so a hit ends itself), which means a
// cell never needs a `duration` and a long Decay is the way to a bass/drone hit. Ids shared with other kinds
// (tune, noise, cutoff, resonance, attack, decay, drive, pitchDecay) have their own range here.
export const PERCSYNTH_WAVE_OPTIONS = ["Sine/Tri", "Saw", "Square"];
export const PERCSYNTH_FILTER_OPTIONS = ["Low-pass", "High-pass"];
export const PERCSYNTH_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 25, max: 800, default: 55, step: 0.5, unit: "Hz", scale: "note" },
  { id: "osc1Wave", webdspParam: "Osc1Wave", label: "Osc 1", min: 0, max: 2, default: 0, step: 1, unit: "", options: PERCSYNTH_WAVE_OPTIONS },
  { id: "osc1Level", webdspParam: "Osc1Level", label: "Osc 1 Lvl", min: 0, max: 1, default: 0.9, step: 0.01, unit: "" },
  { id: "osc2Wave", webdspParam: "Osc2Wave", label: "Osc 2", min: 0, max: 2, default: 1, step: 1, unit: "", options: PERCSYNTH_WAVE_OPTIONS },
  { id: "osc2Pitch", webdspParam: "Osc2Pitch", label: "Osc 2 Pitch", min: -24, max: 48, default: 12, step: 0.1, unit: "st" },
  { id: "osc2Level", webdspParam: "Osc2Level", label: "Osc 2 Lvl", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "osc2Fm", webdspParam: "Osc2Fm", label: "FM", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "pitchEnv", webdspParam: "PitchEnv", label: "Sweep", min: 0, max: 6, default: 2.5, step: 0.05, unit: "oct" },
  { id: "pitchDecay", webdspParam: "PitchDecay", label: "Sweep Time", min: 0.005, max: 2, default: 0.07, step: 0.005, unit: "s" },
  { id: "osc2Env", webdspParam: "Osc2Env", label: "Osc 2 Sweep", min: 0, max: 2, default: 1, step: 0.01, unit: "" },
  { id: "noise", webdspParam: "Noise", label: "Noise", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "noiseTone", webdspParam: "NoiseTone", label: "Noise Tone", min: 0, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "noiseDecay", webdspParam: "NoiseDecay", label: "Noise Decay", min: 0.003, max: 2, default: 0.04, step: 0.001, unit: "s" },
  { id: "filterType", webdspParam: "FilterType", label: "Filter", min: 0, max: 1, default: 0, step: 1, unit: "", options: PERCSYNTH_FILTER_OPTIONS },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 40, max: 16000, default: 5000, step: 1, unit: "Hz" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.15, step: 0.01, unit: "" },
  { id: "filterEnv", webdspParam: "FilterEnv", label: "Filter Env", min: -1, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "filterDecay", webdspParam: "FilterDecay", label: "Filter Decay", min: 0.01, max: 2, default: 0.15, step: 0.01, unit: "s" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.0005, max: 0.25, default: 0.001, step: 0.0005, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.02, max: 4, default: 0.35, step: 0.01, unit: "s" },
  { id: "drive", webdspParam: "Drive", label: "Drive", min: 0, max: 1, default: 0.2, step: 0.01, unit: "" },
];

// Edge — mirrors webdsp's docs/edge-instrument.md: clean, sharp plucks, stabs and leads. A band-limited
// oscillator whose brightness is a harmonic count (enveloped by the tone envelope), a signed pitch
// transient, and two filter stages (LP12/LP24/HP12/band-pass) with single/series/parallel routing and
// one LFO. Sustained: it brings its own root (tune 220 Hz = A-3 = note 57) and a cell's length is the
// note's `duration`, so a pluck (sustain 0) ends itself and a lead (sustain 1) holds for the cell.
// Ids shared with other kinds (tune, shape, detune, cutoff, resonance, spread, attack, decay, sustain,
// release, pitchEnv, pitchDecay, filterEnv) have their own ranges here.
export const EDGE_ROUTING_OPTIONS = ["Filter A", "Series", "Parallel"];
export const EDGE_FILTER_OPTIONS = ["LP 12", "LP 24", "HP 12", "Band-pass"];
export const EDGE_PARAMS = [
  { id: "tune", webdspParam: "Tune", label: "Tune", min: 27.5, max: 1760, default: 220, step: 0.5, unit: "Hz", scale: "note" },
  { id: "shape", webdspParam: "Shape", label: "Shape", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "bright", webdspParam: "Bright", label: "Bright", min: 0, max: 1, default: 0.55, step: 0.01, unit: "" },
  { id: "brightEnv", webdspParam: "BrightEnv", label: "Bright Env", min: -1, max: 1, default: 0.4, step: 0.01, unit: "" },
  { id: "detune", webdspParam: "Detune", label: "Detune", min: 0, max: 50, default: 0, step: 0.5, unit: "ct" },
  { id: "pitchEnv", webdspParam: "PitchEnv", label: "Pitch Env", min: -24, max: 24, default: 3, step: 0.1, unit: "st" },
  { id: "pitchDecay", webdspParam: "PitchDecay", label: "Pitch Time", min: 0.002, max: 0.4, default: 0.025, step: 0.001, unit: "s" },
  { id: "routing", webdspParam: "Routing", label: "Routing", min: 0, max: 2, default: 1, step: 1, unit: "", options: EDGE_ROUTING_OPTIONS },
  { id: "filterA", webdspParam: "FilterA", label: "Filter A", min: 0, max: 3, default: 0, step: 1, unit: "", options: EDGE_FILTER_OPTIONS },
  { id: "filterB", webdspParam: "FilterB", label: "Filter B", min: 0, max: 3, default: 2, step: 1, unit: "", options: EDGE_FILTER_OPTIONS },
  { id: "cutoff", webdspParam: "Cutoff", label: "Cutoff", min: 40, max: 16000, default: 3000, step: 1, unit: "Hz" },
  { id: "spread", webdspParam: "Spread", label: "B Offset", min: -4, max: 4, default: -3, step: 0.05, unit: "oct" },
  { id: "resonance", webdspParam: "Resonance", label: "Resonance", min: 0, max: 1, default: 0.1, step: 0.01, unit: "" },
  { id: "filterEnv", webdspParam: "FilterEnv", label: "Filter Env", min: -1, max: 1, default: 0.5, step: 0.01, unit: "" },
  { id: "toneDecay", webdspParam: "ToneDecay", label: "Tone Decay", min: 0.01, max: 2, default: 0.18, step: 0.01, unit: "s" },
  { id: "lfoRate", webdspParam: "LfoRate", label: "LFO Rate", min: 0.1, max: 20, default: 5, step: 0.1, unit: "Hz" },
  { id: "lfoPitch", webdspParam: "LfoPitch", label: "LFO > Pitch", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "lfoFilter", webdspParam: "LfoFilter", label: "LFO > Filter", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "attack", webdspParam: "Attack", label: "Attack", min: 0.0005, max: 0.25, default: 0.001, step: 0.0005, unit: "s" },
  { id: "decay", webdspParam: "Decay", label: "Decay", min: 0.01, max: 4, default: 0.3, step: 0.01, unit: "s" },
  { id: "sustain", webdspParam: "Sustain", label: "Sustain", min: 0, max: 1, default: 0, step: 0.01, unit: "" },
  { id: "release", webdspParam: "Release", label: "Release", min: 0.005, max: 2, default: 0.08, step: 0.005, unit: "s" },
];

// One entry per webdsp InstrumentKind, mirroring the `{ id, name, category, params }` shape
// `runtime.getCapabilities().instruments` itself reports (node_modules/webdsp's
// docs/instruments.md) — model/ stays webdsp-free (docs/EXTENDING.md's layer map) so this is a
// hand-mirror, not a live read, but it means this one table is both the param catalog lookup
// (SYNTH_PARAMS_BY_KIND below) and the only place UI code needs to iterate to list every synth
// kind (ui/chrome/InstrumentPanel.jsx's output-type buttons) — not a second, separate list of
// instrument names.
// Source gain: webdsp gives every synth kind one shared "gain" control (InstrumentCommonParam.Gain,
// dB, default 0 = unity) applied to the instrument's output before it reaches its bus — before the
// track's FX chain and the mixer fader. It is the first control of every kind (spliced in below),
// so the editor, cell automation and the engine push treat it like any other control; audio/
// instrument.js resolves its `webdspParam` to the shared id instead of a per-kind enum member.
// A sample slot has the same stage as `gain` (linear, SampleParam.Gain) — see SOURCE_GAIN_* below.
export const SOURCE_GAIN_MIN_DB = -24;
export const SOURCE_GAIN_MAX_DB = 12;
export const SOURCE_GAIN_PARAM = {
  id: "gain", webdspParam: "Gain", label: "Gain", min: SOURCE_GAIN_MIN_DB, max: SOURCE_GAIN_MAX_DB, default: 0, step: 0.1, unit: "dB",
};

// dB <-> linear for the sample slot's `gain` (linear since before the dB display existed; kept so
// saved projects load unchanged). 0 dB is exactly 1; a stored 0 (silence) reads as the minimum.
export function gainToDb(gain) {
  return gain > 0 ? Math.max(SOURCE_GAIN_MIN_DB, 20 * Math.log10(gain)) : SOURCE_GAIN_MIN_DB;
}
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}
export function formatGainDb(db) {
  return `${Number(db).toFixed(1)} dB`;
}

const SYNTH_KIND_DEFS = [
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
  // FM tune defaults to 110 Hz = A-2 = note 45 (webdsp's docs/fm-instrument.md).
  { id: "fm", name: "FM", category: "synth", params: FM_PARAMS, sustained: true, rootNote: 45 },
  // Hypersaw tune defaults to 110 Hz = A-2 = note 45 (webdsp's docs/hypersaw-instrument.md).
  { id: "hypersaw", name: "Hypersaw", category: "synth", params: HYPERSAW_PARAMS, sustained: true, rootNote: 45 },
  // PWM Beast tune defaults to 55 Hz = A-1 = note 33 (webdsp's docs/pwm-beast-instrument.md).
  { id: "pwmbeast", name: "PWM Beast", category: "synth", params: PWMBEAST_PARAMS, sustained: true, rootNote: 33 },
  // Digital Machines (webdsp's docs/digital-machines.md). Tone tunes to 110 Hz = A-2 = note 45, Chaos to
  // 220 Hz = A-3 = note 57; the one-shots keep the default root.
  { id: "dm_thump", name: "FM Thump", category: "digital", params: DM_THUMP_PARAMS },
  { id: "dm_metal", name: "FM Metal", category: "digital", params: DM_METAL_PARAMS },
  { id: "dm_tone", name: "FM Tone", category: "digital", params: DM_TONE_PARAMS, sustained: true, rootNote: 45 },
  { id: "dm_crack", name: "FM Crack", category: "digital", params: DM_CRACK_PARAMS },
  { id: "dm_chaos", name: "FM Chaos", category: "digital", params: DM_CHAOS_PARAMS, sustained: true, rootNote: 57 },
  // Percussion Synth (webdsp's docs/percussion-synth.md): a one-shot at the default root, like the drums.
  { id: "percsynth", name: "Perc Synth", category: "synth", params: PERCSYNTH_PARAMS },
  // Edge (webdsp's docs/edge-instrument.md): sustained, tunes to 220 Hz = A-3 = note 57.
  { id: "edge", name: "Edge", category: "synth", params: EDGE_PARAMS, sustained: true, rootNote: 57 },
];

// Registry of every synthesized-instrument kind's own param catalog, keyed by the same string
// `Instrument.output.kind` (model/instrument.js) uses. Derived from SYNTH_KINDS above rather
// than hand-listed again.
export const SYNTH_KINDS = SYNTH_KIND_DEFS.map((kind) => ({ ...kind, params: [SOURCE_GAIN_PARAM, ...kind.params] }));

export const SYNTH_PARAMS_BY_KIND = Object.fromEntries(SYNTH_KINDS.map((k) => [k.id, k.params]));

export function getSynthKind(kind) {
  return SYNTH_KINDS.find((k) => k.id === kind);
}

// Can a note of this synth kind be tied (a 303-style slide into the held note)? It needs a legato mode.
export function supportsTieKind(kind) {
  return getSynthKind(kind)?.params.some((p) => p.id === "legato") === true;
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
  if (param.options) return param.options[Math.round(value - (param.min ?? 0))] ?? "--";
  if (param.unit === "dB") return formatGainDb(value);
  if (param.unit === "st") return `${value > 0 ? "+" : ""}${Number(value).toFixed(decimalsForStep(param.step))} st`;
  return `${Number(value).toFixed(decimalsForStep(param.step))}${param.unit}`;
}
