// A per-song mixer-level channel strip: mute/solo/volume persist across pattern switches on
// the same track, unlike the events themselves, which are per-pattern (see pattern.js).
//
// `fx` is this track's insert-bus FX baseline — { [fxParamId]: value } (model/fxParams.js is
// the id catalog), set by the FX panel (ui/chrome/FxPanel.jsx) and latched by cell automation
// during playback (audio/compile.js#compileRowFx). Distinct from a pattern's per-cell
// Event.fx: this is the resting value a track's bus parameter has right now, same role
// mute/solo/volume already play for the mixer.
export function createTrackChannel({ index, name, muted = false, solo = false, volume = 1.0, fx = {} } = {}) {
  return {
    index,
    name: name ?? `TRK ${index + 1}`,
    muted,
    solo,
    volume,
    fx,
  };
}
