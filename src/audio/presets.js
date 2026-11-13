// webdsp's own starting sounds, expressed in this app's param ids so the UI can apply them with its ordinary
// one-param-at-a-time setters (model/ stays webdsp-free, hence this lives next to the audio layer).
import { ELECTRIC_PRESETS, ElectricParam, SUB_BASS_PRESETS, SubBassParam, COMPRESSOR_PRESETS, presetSettings, DEFAULT_DRUM_PEAK_DB } from "webdsp";
import { ELECTRIC_PARAMS, SUB_BASS_PARAMS } from "../model/instrumentParams.js";

// A synth preset: { name: { id: value } } keyed by the catalog's ids. A preset names only the controls it changes, so
// applying one first resets every param to its catalog default (the preset's own contract: the rest stay at default).
function synthPresets(params, enumByName, presets) {
  const idByEnum = new Map(params.map((p) => [enumByName[p.webdspParam], p.id]));
  const defaults = Object.fromEntries(params.map((p) => [p.id, p.default]));
  return Object.fromEntries(
    Object.entries(presets).map(([name, values]) => [
      name,
      { ...defaults, ...Object.fromEntries(Object.entries(values).map(([key, v]) => [idByEnum.get(Number(key)), v])) },
    ]),
  );
}

export const electricPresets = () => synthPresets(ELECTRIC_PARAMS, ElectricParam, ELECTRIC_PRESETS);
export const subBassPresets = () => synthPresets(SUB_BASS_PARAMS, SubBassParam, SUB_BASS_PRESETS);

// Compressor presets (drum-bus oriented): [{ name, purpose, values: { "comp.ratio": 4, ... } }]. The threshold is placed
// below the loudest hits, assumed at webdsp's normal drum level.
export function compressorPresets() {
  return COMPRESSOR_PRESETS.map((p) => {
    const s = presetSettings(p, DEFAULT_DRUM_PEAK_DB);
    return {
      name: p.name,
      purpose: p.purpose,
      values: {
        "comp.threshold": s.threshold,
        "comp.ratio": s.ratio,
        "comp.attack": s.attack,
        "comp.release": s.release,
        "comp.knee": s.knee,
        "comp.makeup": s.makeup,
      },
    };
  });
}
