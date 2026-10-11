// The complete MVP control/action surface, specified once as data rather than grown ad hoc
// (ECS-156 plan §9) — contrast with webseq's src/midi/sequencerContract.ts (1400+ lines, one
// hand-written factory per id, added ticket by ticket over the project's life). New ids go
// here, as a reviewable one-line diff, not as a new bespoke factory function.
//
// Deliberately small: transport and mixer-level only, not per-cell addressing — a much bigger
// surface better specified later if a real consumer (a midi-core adapter, say) ever needs it.

export const TRACK_COUNT = 8; // mirrors model/song.js's default — see registry.js
export const ROW_COUNT = 64; // mirrors model/song.js's default

const trackControls = Array.from({ length: TRACK_COUNT }, (_, i) => [
  { id: `track.${i}.muted`, label: `Track ${i + 1} muted`, kind: "boolean" },
  { id: `track.${i}.solo`, label: `Track ${i + 1} solo`, kind: "boolean" },
  { id: `track.${i}.volume`, label: `Track ${i + 1} volume`, kind: "number", min: 0, max: 1.5 },
]).flat();

export const CONTROLS = [
  { id: "transport.playing", label: "Transport playing", kind: "boolean" },
  { id: "transport.playheadRow", label: "Playhead row", kind: "number", min: -1, max: ROW_COUNT - 1 },
  { id: "pattern.selected", label: "Selected pattern id", kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER },
  ...trackControls,
  { id: "cursor.row", label: "Cursor row", kind: "number", min: 0, max: ROW_COUNT - 1 },
  { id: "cursor.track", label: "Cursor track", kind: "number", min: 0, max: TRACK_COUNT - 1 },
];

export const ACTIONS = [
  { id: "transport.play", label: "Play" },
  { id: "transport.stop", label: "Stop" },
];
