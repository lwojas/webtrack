// Pure logic for the Matrix synth's patch matrix view (ui/chrome/PatchMatrixEditor.jsx): which cell is which
// control, reading the flat instrument params into webdsp's patch model, what a cable is called and does in
// plain words, and what a gesture changes. No DOM, so it is unit-tested directly. The graph analysis (what is
// feedback, where a signal goes) comes from webdsp's patchMatrix.ts; this file only decides how it reads on
// screen. The matrix is a patch bay: outs run across the top, ins down the side. A cell's control id is
// "<out><In>" in camelCase (vcoVcfIn, vcfCutoff), as in model/instrumentParams.js's MATRIX_CELL_PARAMS.

import {
  MATRIX_INS,
  MATRIX_OUTS,
  MatrixIn,
  MatrixOut,
  matrixCellOfParam,
  matrixLoop,
  matrixPatchKind,
  matrixPatches,
  matrixPath,
} from "webdsp";

/** The outs across the top: audio signals first, then the slow control signals. */
export const MATRIX_COLUMN_GROUPS = [
  { label: "Audio outs", outs: [MatrixOut.Vco, MatrixOut.Noise, MatrixOut.Vcf, MatrixOut.Vca] },
  { label: "Control outs", outs: [MatrixOut.Lfo1, MatrixOut.Lfo2, MatrixOut.Env1, MatrixOut.Env2] },
];

/** The ins down the side, by the module they belong to, in signal-path order. */
export const MATRIX_ROW_GROUPS = [
  { label: "VCO", ins: [MatrixIn.Pitch, MatrixIn.Pwm] },
  { label: "VCF", ins: [MatrixIn.VcfIn, MatrixIn.Cutoff, MatrixIn.Resonance, MatrixIn.Drive] },
  { label: "VCA", ins: [MatrixIn.VcaIn, MatrixIn.Level] },
  { label: "LFO", ins: [MatrixIn.Lfo1Rate, MatrixIn.Lfo2Rate] },
  { label: "Output", ins: [MatrixIn.Out] },
];

// Short row labels (the group label already names the module).
const IN_LABEL = {
  [MatrixIn.Pitch]: "Pitch", [MatrixIn.Pwm]: "Pulse width", [MatrixIn.VcfIn]: "Audio in", [MatrixIn.Cutoff]: "Cutoff",
  [MatrixIn.Resonance]: "Resonance", [MatrixIn.Drive]: "Drive", [MatrixIn.VcaIn]: "Audio in", [MatrixIn.Level]: "Level",
  [MatrixIn.Lfo1Rate]: "LFO 1 rate", [MatrixIn.Lfo2Rate]: "LFO 2 rate", [MatrixIn.Out]: "Output",
};
export const inLabel = (input) => IN_LABEL[input];
export const outLabel = (out) => MATRIX_OUTS[out].name;
/** "VCF in", "VCO pitch": the in with its module, for sentences. */
export const inName = (input) => MATRIX_INS[input].name;

/** The control id of a cell, as in MATRIX_CELL_PARAMS (camelCase of "<Out><In>"). */
export function cellId(out, input) {
  const name = `${MatrixOut[out]}${MatrixIn[input]}`;
  return name[0].toLowerCase() + name.slice(1);
}

/** The (out, in) a control id addresses, or null for any other control. */
export function cellOfId(id) {
  for (const o of MATRIX_OUTS) {
    for (const i of MATRIX_INS) if (cellId(o.out, i.input) === id) return { out: o.out, input: i.input };
  }
  return null;
}

/** The cables in use, from the instrument's flat params (`cellDefault` for a cell it has not stored). */
export function readPatches(params, cellDefault) {
  return matrixPatches((param) => {
    const cell = matrixCellOfParam(param);
    if (!cell) return 0;
    const id = cellId(cell.out, cell.input);
    return params?.[id] ?? cellDefault(id);
  });
}

export const findPatch = (patches, out, input) => patches.find((p) => p.out === out && p.input === input);

const isAudioIn = (input) => MATRIX_INS[input].role !== "control";

/** A new cable: an audio cable starts at unity, the amp level opens fully (it is a gate), anything else at half. */
export const defaultAmount = (input) => (isAudioIn(input) || input === MatrixIn.Level ? 1 : 0.5);

/** Gestures land on round values: 0, +-50% and +-100% attract, everything else is whole percent. */
export function snapAmount(value) {
  let v = Math.round(Math.min(1, Math.max(-1, value)) * 100) / 100;
  for (const t of [0, 0.5, 1]) if (Math.abs(Math.abs(v) - t) < 0.025) v = Math.sign(v || 1) * t;
  return v === 0 ? 0 : v;
}

/** Amount after dragging `dx` pixels sideways on a cell `width` pixels wide (a cell's width is ~100%). */
export const amountFromDrag = (start, dx, width) => snapAmount(start + dx / Math.max(1, width * 0.8));

export const formatAmount = (a) => `${a > 0 ? "+" : a < 0 ? "−" : ""}${Math.round(Math.abs(a) * 100)}%`;

const MODULE_NAME = {
  lfo1: "LFO 1", lfo2: "LFO 2", env1: "ENV 1", env2: "ENV 2", noise: "Noise", vco: "VCO", vcf: "VCF", vca: "VCA", out: "Out",
};
export const moduleName = (m) => MODULE_NAME[m];

export const KIND_LABEL = { control: "Control", audio: "Audio", feedback: "Feedback" };

// What a 100% cable does to a control in at the signal's peak (webdsp docs/matrix-instrument.md).
const FULL_SCALE = {
  [MatrixIn.Pitch]: { per: 12, format: (v) => `${v.toFixed(1)} st`, full: "1 octave" },
  [MatrixIn.Pwm]: { per: 45, format: (v) => `${Math.round(v)}% of the cycle`, full: "45% of the cycle" },
  [MatrixIn.Cutoff]: { per: 5, format: (v) => `${v.toFixed(1)} oct`, full: "5 octaves" },
  [MatrixIn.Resonance]: { per: 0.5, format: (v) => v.toFixed(2), full: "0.5" },
  [MatrixIn.Drive]: { per: 0.6, format: (v) => v.toFixed(2), full: "0.6" },
  [MatrixIn.Level]: { per: 100, format: (v) => `${Math.round(v)}%`, full: "the full level" },
  [MatrixIn.Lfo1Rate]: { per: 3, format: (v) => `${v.toFixed(1)} oct`, full: "3 octaves" },
  [MatrixIn.Lfo2Rate]: { per: 3, format: (v) => `${v.toFixed(1)} oct`, full: "3 octaves" },
};

/** "+2.8 oct" for a control in; null for an audio in (an amount there is a level). */
export function swingText(input, amount) {
  const f = FULL_SCALE[input];
  if (!f) return null;
  const v = amount * f.per;
  return `${v < 0 ? "−" : "+"}${f.format(Math.abs(v))}`;
}

/** What the amount does, in a sentence: a depth for a control in, a level for an audio in. */
export function readoutText(out, input, amount) {
  const f = FULL_SCALE[input];
  const a = Math.abs(Math.round(amount * 100));
  if (!f) return `Mixes ${outLabel(out)} into ${inName(input)} at ${a}% of its level${amount < 0 ? ", inverted" : ""}. Cables into the same in add.`;
  return `Moves ${inName(input)} by up to ${swingText(input, amount)} at the signal's peak. 100% is ${f.full}.`;
}

// Plain names for what a cable sounds like, by what drives it and what it drives. Starting points for the
// reader, not engine behaviour; the engine only knows out, amount, in.
const NORMAL_AUDIO = {
  "vco>vcfin": ["Oscillator into the filter", "The usual path: the oscillator goes through the filter."],
  "vcf>vcain": ["Filter into the amp", "The usual path: the filtered sound goes to the amp."],
  "vca>out": ["Amp to the output", "The usual path: what the amp passes is what you hear."],
  "noise>vcfin": ["Noise through the filter", "Adds noise to what the filter sees. With the oscillator removed, a filtered noise voice."],
  "vco>vcain": ["Skip the filter", "The raw oscillator goes straight into the amp, bypassing the filter."],
  "vco>out": ["Skip filter and amp", "The oscillator goes straight to the output with no envelope: a constant tone."],
  "noise>vcain": ["Noise into the amp", "Raw noise shaped only by the amp."],
  "noise>out": ["Raw noise", "Noise straight to the output, with no filter or amp."],
  "vcf>out": ["Skip the amp", "The filter goes straight to the output, with no envelope on the level."],
  "vco>cutoff": ["Audio-rate FM", "The oscillator is fast enough to act as tone: it adds metallic sidebands to the filter."],
  "vco>level": ["Ring mod", "Multiplies the amp by the oscillator. Bells and robot tones."],
  "noise>cutoff": ["Rough filter", "Noise on the cutoff roughens the tone."],
  "noise>pitch": ["Random pitch", "A random walk of the pitch."],
};
const LFO_SOUNDS = {
  [MatrixIn.Pitch]: ["Vibrato", "Slow pitch wobble. Small for vibrato, large for sirens."],
  [MatrixIn.Pwm]: ["Pulse sweep", "Moves the pulse width for a thick, chorused tone."],
  [MatrixIn.Cutoff]: ["Wobble", "Opens and closes the filter in time with the LFO."],
  [MatrixIn.Resonance]: ["Resonance pulse", "The filter rings more, then less, on each cycle."],
  [MatrixIn.Drive]: ["Pumping grit", "Distortion swells and recedes with the LFO."],
  [MatrixIn.Level]: ["Tremolo", "Level rises and falls with the LFO."],
  [MatrixIn.Lfo1Rate]: ["Rate sweep", "The other LFO makes this one speed up and slow down."],
  [MatrixIn.Lfo2Rate]: ["Rate sweep", "The other LFO makes this one speed up and slow down."],
};
const ENV_SOUNDS = {
  [MatrixIn.Pitch]: ["Pitch drop", "Each note starts off pitch and glides in. Kicks and zaps."],
  [MatrixIn.Pwm]: ["Pulse snap", "Pulse width moves over the life of the note."],
  [MatrixIn.Cutoff]: ["Filter sweep", "The note opens bright and closes dark. The basis of a pluck."],
  [MatrixIn.Resonance]: ["Squelch", "Resonance peaks as the note starts."],
  [MatrixIn.Drive]: ["Attack bite", "Extra grit on the first moments of a note."],
  [MatrixIn.Level]: ["Amp shape", "Sets how loud the note is over time."],
  [MatrixIn.Lfo1Rate]: ["Rate over the note", "The LFO speeds up or slows down as the note plays."],
  [MatrixIn.Lfo2Rate]: ["Rate over the note", "The LFO speeds up or slows down as the note plays."],
};
const FEEDBACK_SOUNDS = {
  [MatrixIn.Cutoff]: ["Growl", "The filter hears itself. Its output moves its own cutoff, which changes the level and the waveshape; negative amounts do the opposite."],
  [MatrixIn.Resonance]: ["Ring", "Output level pushes resonance. Loud notes ring, quiet ones stay clean."],
  [MatrixIn.Drive]: ["Overload", "Output level pushes the drive: the louder it gets, the harder the filter saturates."],
  [MatrixIn.Pitch]: ["Scream", "The output bends the oscillator pitch. Small amounts detune, large amounts tear the tone into FM noise."],
  [MatrixIn.Pwm]: ["Tear", "The output moves the pulse width. The oscillator shimmers and splits."],
  [MatrixIn.VcfIn]: ["Filter into itself", "The output returns to the filter's input, thickening the resonance."],
  [MatrixIn.VcaIn]: ["Amp into itself", "The amp feeds its own input: the sound sustains and distorts."],
};

function sound(out, input, kind) {
  const o = MATRIX_OUTS[out];
  const i = MATRIX_INS[input];
  if (kind === "feedback") {
    if (out === MatrixOut.Vco && input === MatrixIn.Pitch) return ["Self-FM", "The oscillator modulates itself. Harmonics multiply and the tone turns grainy."];
    return FEEDBACK_SOUNDS[input] ?? ["Feedback", "The signal is taken back upstream. It is limited, so it cannot run away."];
  }
  const generic = ["Patch", "Routes this signal into that parameter."];
  if (o.key.startsWith("lfo")) return i.role === "control" ? (LFO_SOUNDS[input] ?? generic) : ["LFO as a tone", "A slow wave in the signal path. At high rates the LFO is an oscillator."];
  if (o.key.startsWith("env")) return i.role === "control" ? (ENV_SOUNDS[input] ?? generic) : ["Envelope as a signal", "The envelope itself goes through the path: a thump or a click."];
  return NORMAL_AUDIO[`${o.key}>${i.key}`] ?? ["Audio cable", "Routes this signal into that in."];
}

const others = (patches, out, input) => patches.filter((p) => !(p.out === out && p.input === input));

/** Whether patching (out, in) would close a loop with the other cables present. */
export const wouldBeFeedback = (out, input, patches) => matrixLoop({ out, input, amount: 1 }, others(patches, out, input)) !== null;

/** The kind a cable is, or would be, with the other cables present: "control" | "audio" | "feedback". */
export const kindOf = (out, input, amount, patches) => matrixPatchKind({ out, input, amount }, others(patches, out, input));

/** Everything the editor says about one cable: its kind, name, what the amount does, where the signal goes
 * (null when nothing connects the in's module to the output) and the loop it closes (null if none). */
export function describePatch(out, input, amount, patches) {
  const rest = others(patches, out, input);
  const loop = matrixLoop({ out, input, amount }, rest);
  const kind = kindOf(out, input, amount, patches);
  const [name, text] = sound(out, input, kind);
  // Judge the route with this cable in place, so a cable that is the only link to the output counts.
  const route = matrixPath(input, [...rest, { out, input, amount: amount || 1 }]);
  return {
    kind,
    title: `${outLabel(out)} → ${inName(input)}`,
    name,
    text,
    readout: readoutText(out, input, amount),
    path: route ? [outLabel(out), inName(input), ...route.slice(1).map(moduleName)] : null,
    loop: loop ? loop.map(moduleName) : null,
  };
}
