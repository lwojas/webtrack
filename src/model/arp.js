// Per-track arpeggiator: pure, deterministic note *generation* that runs inside
// audio/compile.js#compileRow, so webdsp (and MIDI output) never know an arp exists and a track
// with the arp off takes exactly the pre-arp path (compileRow only calls in here when `enabled`).
// A line-for-line port of webseq's src/model/arp.ts (the apps share no package) with the same
// test vectors; this file adds the tracker adapter at the bottom.
//
// Model. A track's notes sit one-per-row, so there is no stored chord. The arp reads them two
// ways at once:
//   * Pitch pool — the pitches of the track's notes within one BAR (16 rows) are the chord.
//   * Gate windows — each note is a window [row, row + its length): the arp plays inside it,
//     first step on the note's own row, then every `rate`. Placement therefore keeps its rhythm
//     and its rests; the arp only decides *what* sounds on each step.
// Runs are clipped at bar lines (and at the track's own loop end), so each bar is an independent
// group: its pool, step counter and random sequence start fresh, which keeps pattern loops,
// queue changes and polymetric track lengths deterministic with no state between ticks.
// Positions/lengths are in tracker steps (rows = 16ths).

export const ARP_MODES = [
  { id: "up", label: "Up" },
  { id: "down", label: "Down" },
  { id: "updown", label: "Up/Down" },
  { id: "downup", label: "Down/Up" },
  { id: "random", label: "Random" },
  { id: "played", label: "As played" },
  { id: "pattern", label: "Pattern" },
];

// Step length in rows (a row is a 16th note). Triplets and dotted values included.
export const ARP_RATES = [
  { id: "1/1", label: "1/1", steps: 16 },
  { id: "1/2", label: "1/2", steps: 8 },
  { id: "1/4.", label: "1/4.", steps: 6 },
  { id: "1/4", label: "1/4", steps: 4 },
  { id: "1/4T", label: "1/4T", steps: 8 / 3 },
  { id: "1/8.", label: "1/8.", steps: 3 },
  { id: "1/8", label: "1/8", steps: 2 },
  { id: "1/8T", label: "1/8T", steps: 4 / 3 },
  { id: "1/16.", label: "1/16.", steps: 1.5 },
  { id: "1/16", label: "1/16", steps: 1 },
  { id: "1/16T", label: "1/16T", steps: 2 / 3 },
  { id: "1/32", label: "1/32", steps: 0.5 },
];
export const DEFAULT_ARP_RATE = "1/16";

// Note-order patterns. Each value is a 1-based index into the arp's pitch pool (low to high,
// across the octave range); an index past the pool wraps round it; 0 is a rest (the step is
// skipped but still counts, so the rhythm holds).
export const ARP_PATTERNS = [
  { id: "1232", label: "1 2 3 2", steps: [1, 2, 3, 2] },
  { id: "1324", label: "1 3 2 4", steps: [1, 3, 2, 4] },
  { id: "1213", label: "1 2 1 3", steps: [1, 2, 1, 3] },
  { id: "1342", label: "1 3 4 2", steps: [1, 3, 4, 2] },
  { id: "1323", label: "1 3 2 3", steps: [1, 3, 2, 3] },
  { id: "1123", label: "1 1 2 3", steps: [1, 1, 2, 3] },
  { id: "push", label: "1 · 2 3", steps: [1, 0, 2, 3] },
  { id: "offbeat", label: "· 1 · 2", steps: [0, 1, 0, 2] },
  { id: "gallop", label: "1 1 2 · 3 3 2 ·", steps: [1, 1, 2, 0, 3, 3, 2, 0] },
  { id: "tresillo", label: "1 · · 2 · · 3 ·", steps: [1, 0, 0, 2, 0, 0, 3, 0] },
];
export const DEFAULT_ARP_PATTERN = "1232";

// Velocity step presets (levels 0..1).
export const ARP_VELOCITY_PRESETS = [
  { id: "flat", label: "Flat", steps: [1, 1, 1, 1] },
  { id: "pulse", label: "Pulse", steps: [1, 0.55, 0.75, 0.5] },
  { id: "groove", label: "Groove", steps: [0.79, 0.55, 0.67, 0.47] },
  { id: "syncopated", label: "Syncopated", steps: [1, 0.4, 0.7, 0.4, 0.9, 0.4, 0.7, 0.4] },
  { id: "rise", label: "Rise", steps: [0.4, 0.55, 0.7, 0.85, 1, 0.85, 0.7, 0.55] },
];

export const MIN_ARP_OCTAVES = 1;
export const MAX_ARP_OCTAVES = 4;
export const MIN_ARP_GATE = 0.05;
export const MAX_ARP_VELOCITY_STEPS = 16;
export const MIN_ARP_VELOCITY_STEPS = 1;

// enabled; mode (ARP_MODES); pattern (ARP_PATTERNS id, used in "pattern" mode); rate (ARP_RATES
// id); octaves 1..4; gate = fraction of a step each note sounds, 0.05..1; velocity = { mode:
// "source" (the gate note's own velocity) | "pattern" (the step levels, blended with the source by
// amount) | "accent" (the source scaled down by the levels), amount 0..1, steps: 1..16 levels
// 0..1 cycled per arp step }. The steps array is the one place a future per-step field (gate,
// accent) would grow into objects.
export function createArp() {
  return {
    enabled: false,
    mode: "up",
    pattern: DEFAULT_ARP_PATTERN,
    rate: DEFAULT_ARP_RATE,
    octaves: 1,
    gate: 0.8,
    velocity: { mode: "source", amount: 1, steps: [...ARP_VELOCITY_PRESETS[2].steps] },
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// A complete, clamped arp from partial/untrusted data. An absent arp is the disabled default.
export function normalizeArp(raw) {
  const base = createArp();
  if (!raw || typeof raw !== "object") return base;
  const rawVel = raw.velocity && typeof raw.velocity === "object" ? raw.velocity : {};
  const steps =
    Array.isArray(rawVel.steps) && rawVel.steps.length > 0
      ? rawVel.steps.slice(0, MAX_ARP_VELOCITY_STEPS).map((s) => Math.round(clamp(s, 0, 1) * 100) / 100)
      : base.velocity.steps;
  return {
    enabled: raw.enabled === true,
    mode: ARP_MODES.some((m) => m.id === raw.mode) ? raw.mode : base.mode,
    pattern: ARP_PATTERNS.some((p) => p.id === raw.pattern) ? raw.pattern : base.pattern,
    rate: ARP_RATES.some((r) => r.id === raw.rate) ? raw.rate : base.rate,
    octaves: Math.round(clamp(raw.octaves ?? base.octaves, MIN_ARP_OCTAVES, MAX_ARP_OCTAVES)),
    gate: Math.round(clamp(raw.gate ?? base.gate, MIN_ARP_GATE, 1) * 100) / 100,
    velocity: {
      mode: rawVel.mode === "pattern" || rawVel.mode === "accent" ? rawVel.mode : "source",
      amount: Math.round(clamp(rawVel.amount ?? base.velocity.amount, 0, 1) * 100) / 100,
      steps,
    },
  };
}

// A channel's arp, or the disabled default (a track from a project saved before arps).
export function arpOf(channel) {
  return normalizeArp(channel?.arp);
}

export function isArpActive(channel) {
  return channel?.arp?.enabled === true;
}

// Merges a patch into an arp; `velocity` patches merge into the existing velocity block.
export function patchArp(arp, patch) {
  const { velocity, ...rest } = patch;
  return normalizeArp({ ...arp, ...rest, velocity: velocity ? { ...arp.velocity, ...velocity } : arp.velocity });
}

// --- generation ---

const EPS = 1e-9;

// Small deterministic PRNG (mulberry32): the same group index always yields the same sequence, so
// a "random" arp replays identically every loop.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function arpRateSteps(rateId) {
  return (ARP_RATES.find((r) => r.id === rateId) ?? ARP_RATES.find((r) => r.id === DEFAULT_ARP_RATE)).steps;
}

export function arpPatternSteps(patternId) {
  return (ARP_PATTERNS.find((p) => p.id === patternId) ?? ARP_PATTERNS[0]).steps;
}

// The pitch pool the modes cycle: sorted ascending (or in play order for "As played"), repeated
// upward across the octave range. `runs` are { start, length, pitch, velocity }.
export function arpPool(arp, runs) {
  const played = runs.map((r) => r.pitch);
  const base = arp.mode === "played" ? played : [...new Set(played)].sort((a, b) => a - b);
  const out = [];
  for (let o = 0; o < arp.octaves; o++) for (const p of base) out.push(p + 12 * o);
  return out;
}

// Indices into the pool for the cyclic modes. The turning points are not repeated: up/down over
// 1 2 3 is 1 2 3 2, not 1 2 3 3 2 1.
function cycleOrder(mode, n) {
  const up = Array.from({ length: n }, (_, i) => i);
  const down = [...up].reverse();
  if (mode === "down") return down;
  if (mode === "updown") return n > 2 ? [...up, ...down.slice(1, -1)] : up;
  if (mode === "downup") return n > 2 ? [...down, ...up.slice(1, -1)] : down;
  return up;
}

// Velocity of the k-th arp step given its source note's velocity (all 0..1).
export function arpStepVelocity(source, v, k) {
  if (v.mode === "source" || v.steps.length === 0) return source;
  const level = v.steps[k % v.steps.length];
  const out = v.mode === "pattern" ? source + (level - source) * v.amount : source * (1 - v.amount * (1 - level));
  return clamp(out, 0, 1);
}

// Expands one group (a bar) of source runs into arp steps { start, length, pitch, velocity, run,
// index }. `runs` must be sorted by start with lengths already clipped to the group; `groupIndex`
// seeds the random mode. Empty in, empty out.
export function expandArpGroup(arp, runs, groupIndex = 0) {
  if (runs.length === 0) return [];
  const pool = arpPool(arp, runs);
  const n = pool.length;
  const stepLen = arpRateSteps(arp.rate);
  const order = cycleOrder(arp.mode, n);
  const patternSteps = arpPatternSteps(arp.pattern);
  const rng = mulberry32((groupIndex + 1) * 2654435761);
  const out = [];
  let k = 0;
  runs.forEach((run, runIndex) => {
    const end = run.start + run.length;
    for (let j = 0; ; j++) {
      const start = run.start + j * stepLen;
      if (start >= end - EPS) break;
      let pitch;
      if (arp.mode === "pattern") {
        const p = patternSteps[k % patternSteps.length];
        pitch = p === 0 ? null : pool[(p - 1) % n];
      } else if (arp.mode === "random") {
        pitch = pool[Math.floor(rng() * n)];
      } else {
        pitch = pool[order[k % order.length]];
      }
      if (pitch !== null) {
        out.push({
          start,
          length: Math.max(1 / 64, Math.min(stepLen * arp.gate, end - start)),
          pitch,
          velocity: arpStepVelocity(run.velocity, arp.velocity, k),
          run: runIndex,
          index: k,
        });
      }
      k++;
    }
  });
  return out;
}

// --- tracker adapter: the arp steps that start on one row ---

export const ARP_STEPS_PER_BAR = 16;

// The arp's notes that start inside [localStep, localStep + 1) for one pattern track, as
// { offset (steps after the row's own time), durationSteps, event } — `event` is the source
// note's event with the generated note/velocity, so compileEvent treats it like any other cell
// (instrument, pan, Track LFO participation all carry over). `durationOf(track, row)` is
// compile.js#noteDurationSteps, injected so this model file stays free of audio/. The bar around
// `localStep` is re-expanded on each call (16 rows at most), which is what lets any row be
// compiled alone with no state kept between ticks.
export function arpEventsAtRow(track, localStep, arp, durationOf) {
  const loopEnd = track.length ?? track.events.length;
  const barIndex = Math.floor(localStep / ARP_STEPS_PER_BAR);
  const barStart = barIndex * ARP_STEPS_PER_BAR;
  const barEnd = Math.min(barStart + ARP_STEPS_PER_BAR, loopEnd);
  const sources = [];
  const runs = [];
  // A note that began in an earlier bar and is still sounding at this bar line is a run starting
  // on the bar line, so a long note keeps arpeggiating through every bar it covers.
  for (let row = barStart - 1; row >= 0; row--) {
    const event = track.events[row];
    if (!event || event.note === null) continue;
    if (event.instrument !== null && row + durationOf(track, row) > barStart) {
      // a following note in this bar cuts the carried one short
      let cut = barEnd;
      for (let r = barStart; r < barEnd; r++) {
        if (track.events[r]?.note !== null && track.events[r]?.note !== undefined) { cut = r; break; }
      }
      if (cut <= barStart) break;
      sources.push(event);
      runs.push({
        start: barStart,
        length: Math.min(row + durationOf(track, row), cut) - barStart,
        pitch: event.note,
        velocity: (event.velocity ?? 127) / 127,
      });
    }
    break; // only the latest earlier note can still be sounding (notes are monophonic)
  }
  for (let row = barStart; row < barEnd; row++) {
    const event = track.events[row];
    if (!event || event.note === null || event.instrument === null) continue;
    sources.push(event);
    runs.push({
      start: row,
      length: Math.max(0, Math.min(durationOf(track, row), barEnd - row)),
      pitch: event.note,
      velocity: (event.velocity ?? 127) / 127,
    });
  }
  const out = [];
  for (const step of expandArpGroup(arp, runs, barIndex)) {
    if (step.start < localStep - EPS || step.start >= localStep + 1 - EPS) continue;
    out.push({
      offset: step.start - localStep,
      durationSteps: step.length,
      event: {
        ...sources[step.run],
        note: Math.max(0, Math.min(127, step.pitch)),
        velocity: Math.max(1, Math.min(127, Math.round(step.velocity * 127))),
      },
    });
  }
  return out;
}
