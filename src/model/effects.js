// A small, extensible registry of effect command ids — data slots only for MVP (ECS-156).
// The event.effectCommand/effectParam fields are editable and hex-displayed, but no entry
// here is wired to a real webdsp setNodeParameter/setVoiceParameter call yet. Adding a real
// effect later means filling in applyEffect's branch for that id, not changing the event
// shape or the grid UI.
// `code` is the single-character tracker-style column glyph (e.g. "U07") used by the grid's
// fx column — see ui/grid/rowFormatting.js.
export const EFFECT_COMMANDS = [
  { id: "pitch-slide-up", code: "U", label: "Pitch slide up" },
  { id: "pitch-slide-down", code: "D", label: "Pitch slide down" },
  { id: "volume-fade", code: "V", label: "Volume fade" },
];

export function getEffectCommand(id) {
  return EFFECT_COMMANDS.find((command) => command.id === id);
}

// Extension point for post-MVP: apply an effect command's real-time behavior against the
// audio engine. Intentionally a no-op for MVP — see ECS-156 plan §6/§12.
export function applyEffect(_event, _context) {}
