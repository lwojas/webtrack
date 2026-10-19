// The pure half of the automation editor (ui/chrome/AutomationEditor.jsx): how a lane's points map
// to a drawn curve, how values map to the vertical axis, and the shape templates. A lane is the
// cell-FX entries of one parameter across the rows of one track (model/cellAutomation.js), and its
// extent is that track's own loop length, so the editor follows polymeter and length changes for
// free. webdsp-free, like all of model/.
import { STEPS_PER_BAR } from "./timing.js";

// --- the vertical axis ---

// Hz / seconds ranges are drawn on a log axis (equal distance = equal ratio, the octave domain
// webdsp's LFOs use), everything else linearly. Matches webdsp's modulation-domain inference.
export function paramScale(param) {
  return param.min > 0 && (param.unit === "Hz" || param.unit === "s") ? "log" : "linear";
}

export function valueToFraction(param, value) {
  const span = param.max - param.min;
  if (span === 0) return 0;
  const t = paramScale(param) === "log" ? Math.log(Math.max(value, param.min) / param.min) / Math.log(param.max / param.min) : (value - param.min) / span;
  return Math.min(1, Math.max(0, t));
}

export function fractionToValue(param, fraction) {
  const t = Math.min(1, Math.max(0, fraction));
  const value = paramScale(param) === "log" ? param.min * Math.pow(param.max / param.min, t) : param.min + t * (param.max - param.min);
  return param.step >= 1 ? Math.min(param.max, Math.max(param.min, Math.round(value / param.step) * param.step)) : value;
}

// --- length ---

// "64 steps · 4 bars" — the lane's extent in the tracker's own units.
export function formatLaneLength(length) {
  const bars = Math.round((length / STEPS_PER_BAR) * 100) / 100;
  return `${length} step${length === 1 ? "" : "s"} · ${bars} ${bars === 1 ? "bar" : "bars"}`;
}

// --- the drawn curve ---

// Vertices [row, value] of the line to draw for `points` ([{row, value, glide}], row ascending) over
// a loop of `length` rows. Exactly what plays: a glide point ramps (a straight line) to the next
// point; any other point holds its value until the next point, then steps. After the last point the
// value holds to the end of the loop. Before the first point the parameter is at its base value,
// which is not part of the lane, so the line starts at the first point.
export function curveVertices(points, length) {
  const out = [];
  points.forEach((p, i) => {
    const next = points[i + 1];
    out.push([p.row, p.value]);
    if (next && !p.glide) out.push([next.row, p.value]); // hold, then the next point's own entry steps
  });
  const last = points[points.length - 1];
  if (last && last.row < length - 1) out.push([length - 1, last.value]);
  return out;
}

// --- templates ---

// A template is a pure shape: points { t, v, hold? } with t 0..1 across the target region and v 0..1
// across the parameter's range. `hold` means the value holds until the next point (a step); without
// it the point glides to the next one (a ramp). Two points at the same t make a jump. The same shapes
// as webseq's automation templates, so a feel learned in one app carries to the other.
const MAX_CYCLES = 64;
const smooth = (x) => x * x * (3 - 2 * x);

function cyclic(bars, perBar, samplesPerCycle, shape) {
  const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(bars * perBar)));
  const pts = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < samplesPerCycle; i++) pts.push({ t: (c + i / samplesPerCycle) / cycles, v: shape(i / samplesPerCycle) });
  }
  pts.push({ t: 1, v: shape(0) });
  return pts;
}

function steps(bars, perBar, high, low, glideUp) {
  const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(bars * perBar)));
  const pts = [];
  for (let c = 0; c < cycles; c++) {
    const a = c / cycles;
    const end = (c + 1) / cycles;
    if (glideUp === null) {
      // pulse: high, then low at the half, each held
      const mid = (c + 0.5) / cycles;
      pts.push({ t: a, v: high, hold: true }, { t: mid, v: low, hold: true });
    } else {
      pts.push({ t: a, v: glideUp ? low : high }, { t: end, v: glideUp ? high : low, hold: true });
    }
  }
  pts.push({ t: 1, v: glideUp === null ? low : glideUp ? high : low, hold: true });
  return pts;
}

export const AUTOMATION_TEMPLATES = [
  { id: "rampUp", label: "Ramp up", points: () => [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
  { id: "rampDown", label: "Ramp down", points: () => [{ t: 0, v: 1 }, { t: 1, v: 0 }] },
  { id: "fadeIn", label: "Fade in", toNeutral: true, points: () => Array.from({ length: 9 }, (_, i) => ({ t: i / 8, v: smooth(i / 8) })) },
  { id: "fadeOut", label: "Fade out", toNeutral: true, points: () => Array.from({ length: 9 }, (_, i) => ({ t: i / 8, v: 1 - smooth(i / 8) })) },
  { id: "swell", label: "Swell", toNeutral: true, points: () => Array.from({ length: 17 }, (_, i) => ({ t: i / 16, v: smooth(1 - Math.abs(i / 8 - 1)) })) },
  { id: "wobble", label: "Filter wobble", points: (bars) => cyclic(bars, 2, 8, (p) => 0.25 + 0.6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p))) },
  { id: "upDown", label: "Up / down", points: (bars) => cyclic(bars, 2, 2, (p) => (p < 0.5 ? 0 : 1)) },
  { id: "sine", label: "Sine", points: (bars) => cyclic(bars, 1, 16, (p) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p)) },
  { id: "pulse", label: "Pulse", points: (bars) => steps(bars, 4, 1, 0, null) },
  { id: "sawUp", label: "Saw up", points: (bars) => steps(bars, 4, 1, 0, true) },
  { id: "sawDown", label: "Saw down", points: (bars) => steps(bars, 4, 1, 0, false) },
];

export function templateById(id) {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}

// Where on the track a template lands: "all" rows of the loop, or its first / last bar. A loop of one
// bar or less has a single region. Returns [from, to) in rows.
export function templateRegion(range, length) {
  if (range === "all" || length <= STEPS_PER_BAR) return { from: 0, to: length };
  return range === "start" ? { from: 0, to: STEPS_PER_BAR } : { from: length - STEPS_PER_BAR, to: length };
}

// Concrete lane points for `template` over `range` of a loop of `length` rows, for parameter `param`
// (log-aware; stepped params rounded). Shapes span the region, t = 1 landing on its last row. The
// result replaces rows [from, to - 1] of the lane. Deterministic.
export function applyTemplate(template, range, param, length) {
  const { from, to } = templateRegion(range, length);
  const rows = to - from;
  const bars = Math.max(1, Math.round(rows / STEPS_PER_BAR));
  const raw = template.points(bars);

  const top = template.toNeutral && param.unit === "dB" && param.default > param.min && param.default < param.max ? param.default : param.max;
  const span = { min: param.min, max: top, step: param.step, unit: param.unit };
  const scale = paramScale(param);

  // On log scales a straight glide between distant values is not an exponential sweep, so each ramp
  // is split into short ones (the value moves linearly in the normalized domain between them).
  const pts = [];
  raw.forEach((p, i) => {
    pts.push(p);
    const next = raw[i + 1];
    if (scale === "log" && !p.hold && next && next.t > p.t) {
      const n = Math.min(8, Math.ceil(Math.abs(next.v - p.v) * 8));
      for (let k = 1; k < n; k++) pts.push({ t: p.t + ((next.t - p.t) * k) / n, v: p.v + ((next.v - p.v) * k) / n });
    }
  });

  const out = [];
  let last = from - 1;
  for (const p of pts) {
    let row = from + Math.min(rows - 1, Math.round(p.t * rows)); // phase-true: a cycle of N rows starts on row k*N
    if (row <= last) row = last + 1; // a jump (same t), or a point crowded onto the previous row
    if (row > to - 1) {
      // No room left: the final value wins at the last row.
      if (out.length > 0 && out[out.length - 1].row === to - 1) out.pop();
      row = to - 1;
    }
    last = row;
    const value = fractionToValue(span, Math.min(1, Math.max(0, p.v)));
    out.push({ row, value: Math.min(param.max, Math.max(param.min, value)), glide: !p.hold });
  }
  // The final point has nothing to glide to; and a closing point that only repeats a held value adds nothing.
  if (out.length > 0) out[out.length - 1].glide = false;
  if (out.length > 1 && !out[out.length - 2].glide && out[out.length - 2].value === out[out.length - 1].value) out.pop();
  return { from, to: to - 1, points: out };
}
