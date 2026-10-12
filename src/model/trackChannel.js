// A per-song mixer-level channel strip: mute/solo/volume persist across pattern switches on
// the same track, unlike the events themselves, which are per-pattern (see pattern.js).
//
// FX is a three-layer model (model/fxParams.js has the full doc comment on the catalog side):
//   1. FX_TYPES/FX_PARAMS — every FX the DSP knows how to provide. Catalog, not per-track.
//   2. `fxChain` — which of those FX_TYPES are actually *enabled* on this track right now, in
//      the order the FX panel (ui/chrome/FxPanel.jsx) lists them. One entry per enabled type:
//      { type: "delay", bypassed: false }. This is what's new — before this existed, every FX
//      was implicitly "present" everywhere, just resting at its own neutral value.
//   3. `fx` — this track's insert-bus parameter *values*, { [fxParamId]: value }, for whichever
//      params belong to an enabled fxChain entry (plus bus.gain, always present/ungated — see
//      model/fxParams.js). Set by the FX panel and latched by cell automation during playback
//      (audio/compile.js#compileRowFx). Not cleared when an FX is removed from fxChain, so
//      re-enabling it restores the last values rather than resetting to defaults.
// `bypassed` on an fxChain entry pushes that type's FX_TYPES#bypassValues to the engine without
// touching the stored values in `fx` — a temporary mute distinct from removing the FX outright
// (model/mutations.js#setTrackFxBypass vs. #removeTrackFx).
//
// A pattern's per-cell Event.fx is distinct from all of this: it's a sparse override that
// latches onto whichever of these *current* values playback is already using, validated against
// fxChain at write time (model/mutations.js#setCellFxParam) so a cell can never reference an FX
// this track doesn't have enabled.
export function createTrackChannel({ index, name, muted = false, solo = false, volume = 1.0, fx = {}, fxChain = [] } = {}) {
  return {
    index,
    name: name ?? `TRK ${index + 1}`,
    muted,
    solo,
    volume,
    fx,
    fxChain,
  };
}
