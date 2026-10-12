import { useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getFxParamGroups, formatFxValue } from "../../model/fxParams.js";

const FX_GROUPS = getFxParamGroups();

// Operates on one of two targets (see the brief's track-vs-master ownership rule, preserved
// end to end down through model/trackChannel.js#fx / model/song.js#masterFx):
//   - TRACK: the selected track's own insert bus — "selected" is whichever track the grid
//     cursor is on (cursor.trackIndex), the same notion of "current track" NoteEditor.jsx's
//     "TRK n" context line already uses, not a second, separate selection concept.
//   - MASTER: MASTER_BUS, via song.masterFx — never reachable from a tracker cell.
// fxController (appContext.js's applyTrackFxParam/applyMasterFxParam) is the only thing this
// component calls to change a value; it never imports audio/fx.js or state/store.js's FX
// methods directly.
export default function FxPanel({ store, fxController }) {
  const [target, setTarget] = useState("track");

  const trackIndex = useStore(store, events.CURSOR_MOVED, (s) => s.cursor.trackIndex);
  const trackName = store.getState().song.trackChannels[trackIndex]?.name ?? `TRK ${trackIndex + 1}`;

  // Fingerprints, not the mutable fx object itself — see ARCHITECTURE.md's in-place-mutation
  // gotcha (the same reason NoteEditor.jsx/ChannelStrip select primitive fields, not objects).
  useStore(store, events.TRACK_FX_CHANGED, (s) => JSON.stringify(s.song.trackChannels[trackIndex]?.fx ?? {}));
  useStore(store, events.MASTER_FX_CHANGED, (s) => JSON.stringify(s.song.masterFx));

  const fxBag = target === "track" ? store.getState().song.trackChannels[trackIndex]?.fx ?? {} : store.getState().song.masterFx;

  function handleChange(paramId, value) {
    if (target === "track") fxController.setTrackFxParam(trackIndex, paramId, value);
    else fxController.setMasterFxParam(paramId, value);
  }

  return (
    <div className="fx-panel">
      <div className="fx-panel__header">
        <div className="fx-panel__target">
          <button
            type="button"
            className={`fx-panel__target-btn${target === "track" ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => setTarget("track")}
          >
            TRACK
          </button>
          <button
            type="button"
            className={`fx-panel__target-btn${target === "master" ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => setTarget("master")}
          >
            MASTER
          </button>
        </div>
        <span className="fx-panel__label">{target === "track" ? `TRK ${trackIndex + 1} — ${trackName}` : "MASTER BUS"}</span>
      </div>

      <div className="fx-panel__modules">
        {FX_GROUPS.map((group) => (
          <div className="fx-module" key={group.name}>
            <div className="fx-module__header">{group.name}</div>
            {group.params.map((param) => {
              const value = fxBag[param.id] ?? param.default;
              return (
                <label className="fx-module__field" key={param.id}>
                  <span className="fx-module__field-label" title={param.label}>
                    {param.label}
                  </span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={value}
                    onChange={(e) => handleChange(param.id, Number(e.target.value))}
                  />
                  <span className="fx-module__value">{formatFxValue(value, param)}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
