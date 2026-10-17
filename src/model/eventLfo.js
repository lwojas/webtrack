// Track LFO model — the tracker's counterpart of webseq's Track LFO (docs/TRACK_LFO.md). A
// track-level LFO that modulates *event* properties, today the velocity of the notes that opt
// in, at the moment each note is scheduled. It never touches the synth, the stored cell velocity
// or the audio signal path; audio/trackLfo.js evaluates it and audio/compile.js applies it.
// webdsp-free like the rest of model/: waveform and division are webdsp's own names.
//
// Stored: the track's LFO config (trackChannel.eventLfo — per song, so it survives pattern
// switches) and each step's participation (Event.lfo, 0..1 | null). Not stored: the effective
// velocity, a runtime value of playback.

export const EVENT_LFO_WAVEFORMS = ["sine", "triangle", "square", "saw"];
export const EVENT_LFO_WAVEFORM_LABELS = { sine: "SINE", triangle: "TRI", square: "SQ", saw: "SAW" };
export const EVENT_LFO_MIN_RATE_HZ = 0.01;
export const EVENT_LFO_MAX_RATE_HZ = 40;
export const DEFAULT_EVENT_LFO_DIVISION = "1/4";

export function createEventLfo() {
  return {
    enabled: false,
    target: "velocity",
    waveform: "sine",
    sync: true,
    rateHz: 1,
    division: DEFAULT_EVENT_LFO_DIVISION,
    // 0..1 of the full velocity range: 1 = the LFO swings velocity by +-127 at full participation.
    depth: 0.25,
  };
}

// A channel's LFO, or the disabled default (a track from a project saved before Track LFO).
export function eventLfoOf(channel) {
  return channel?.eventLfo ?? createEventLfo();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// Merges a patch into a LFO and clamps its numeric fields.
export function patchEventLfo(lfo, patch) {
  const next = { ...lfo, ...patch };
  next.rateHz = clamp(next.rateHz, EVENT_LFO_MIN_RATE_HZ, EVENT_LFO_MAX_RATE_HZ);
  next.depth = clamp(next.depth, 0, 1);
  return next;
}

// A step's participation, normalised: 0..1 in hundredths, null for "not taking part".
export function normalizeParticipation(amount) {
  if (amount === null || amount === undefined) return null;
  const a = Math.round(clamp(amount, 0, 1) * 100) / 100;
  return a === 0 ? null : a;
}

// Rate is edited on a log slider (0.01-40 Hz spans four decades).
export const EVENT_LFO_RATE_STEPS = 1000;
export function rateToSlider(hz) {
  return Math.round((Math.log(hz / EVENT_LFO_MIN_RATE_HZ) / Math.log(EVENT_LFO_MAX_RATE_HZ / EVENT_LFO_MIN_RATE_HZ)) * EVENT_LFO_RATE_STEPS);
}
export function sliderToRate(v) {
  return EVENT_LFO_MIN_RATE_HZ * Math.pow(EVENT_LFO_MAX_RATE_HZ / EVENT_LFO_MIN_RATE_HZ, v / EVENT_LFO_RATE_STEPS);
}
export function formatEventLfoRate(hz) {
  return `${hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : String(Math.round(hz))}Hz`;
}
