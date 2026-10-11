// A per-song mixer-level channel strip: mute/solo/volume persist across pattern switches on
// the same track, unlike the events themselves, which are per-pattern (see pattern.js).
export function createTrackChannel({ index, name, muted = false, solo = false, volume = 1.0 } = {}) {
  return {
    index,
    name: name ?? `TRK ${index + 1}`,
    muted,
    solo,
    volume,
  };
}
