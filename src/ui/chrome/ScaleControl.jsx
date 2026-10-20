import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { ROOT_NAMES, SCALES, SCALE_PRESETS, formatScale, scaleOf } from "../../model/scale.js";

// The project's key in the transport bar: root + scale, a separate list of subjective musical
// presets, and Snap. Changing any of it only changes how notes are shown and entered, never the
// notes themselves (model/scale.js). Reads a JSON fingerprint of the scale, not the song's
// mutable object (ARCHITECTURE.md's in-place-mutation gotcha).
export default function ScaleControl({ store }) {
  const json = useStore(store, events.SCALE_CHANGED, (s) => JSON.stringify(scaleOf(s.song)));
  const scale = JSON.parse(json);
  const set = (patch) => store.setScale(patch);

  return (
    <div className="transport-bar__group scale-control" title={`Key: ${formatScale(scale)}. Changing it never rewrites existing notes.`}>
      <label className="transport-bar__bpm">
        SCALE
        <select value={scale.root} onChange={(e) => set({ root: Number(e.target.value) })} aria-label="Scale root note">
          {ROOT_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <select className="scale-control__select" value={scale.scale} onChange={(e) => set({ scale: e.target.value })} aria-label="Scale">
        {SCALES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        className="scale-control__select"
        value={scale.preset ?? ""}
        onChange={(e) => e.target.value && set({ preset: e.target.value })}
        aria-label="Musical preset"
        title="Musical starting points — inspiration, not definitions of a genre. Also sets the edit octave."
      >
        <option value="">PRESETS…</option>
        <optgroup label="Musical presets (inspiration)">
          {SCALE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        type="button"
        className={`transport-bar__chip${scale.snap ? " transport-bar__chip--active" : ""}`}
        onClick={() => set({ snap: !scale.snap })}
        aria-pressed={scale.snap}
        title="Snap: played notes land on the nearest scale note (hold Shift for any semitone)."
      >
        SNAP
      </button>
    </div>
  );
}
