import { useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { FX_TYPES, getFxType, getFxParam, getFxParamsForType, formatFxValue } from "../../model/fxParams.js";

// bus.gain (model/fxParams.js) isn't one of FX_TYPES' toggleable nodes — it's the bus's own
// always-present output stage, so it gets a pinned module below instead of living in the
// add/remove chain like every other FX.
const OUTPUT_PARAM = getFxParam("bus.gain");

// A `kind: "boolean"` param (currently just filter.mode — model/fxParams.js) has no continuous
// range to slide through, so it gets its own on/off button instead of a <input type="range">
// that would otherwise only ever sit at one of two tick marks. Independent of the module
// header's own bypass (B) button above — this toggles what the FX *does*, bypass toggles
// whether it's active at all.
function FxBooleanField({ param, value, onChange }) {
  const isOn = (value ?? param.default) >= 0.5;
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={param.label}>
        {param.label}
      </span>
      <button type="button" className={`fx-module__toggle${isOn ? " fx-module__toggle--on" : ""}`} onClick={() => onChange(isOn ? 0 : 1)}>
        {formatFxValue(value ?? param.default, param)}
      </button>
    </label>
  );
}

function FxParamField({ param, value, onChange }) {
  if (param.kind === "boolean") return <FxBooleanField param={param} value={value} onChange={onChange} />;
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={param.label}>
        {param.label}
      </span>
      <input type="range" min={param.min} max={param.max} step={param.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="fx-module__value">{formatFxValue(value, param)}</span>
    </label>
  );
}

// Operates on one of two targets (see the brief's track-vs-master ownership rule, preserved
// end to end down through model/trackChannel.js#fx/fxChain and model/song.js#masterFx/
// masterFxChain):
//   - TRACK: the selected track's own insert bus — "selected" is whichever track the grid
//     cursor is on (cursor.trackIndex), the same notion of "current track" NoteEditor.jsx's
//     "TRK n" context line already uses, not a second, separate selection concept.
//   - MASTER: MASTER_BUS, via song.masterFx/masterFxChain — never reachable from a tracker
//     cell.
// Both targets render the same chain-based view: whichever FX are actually enabled (fxChain),
// not every FX the DSP can provide (model/fxParams.js's FX_PARAMS/FX_TYPES catalog) — a track
// or MASTER_BUS with nothing enabled shows just the pinned Output module and the add-FX
// control, not a wall of disabled sliders.
// fxController (appContext.js) is the only thing this component calls to change anything; it
// never imports audio/fx.js or state/store.js's FX methods directly.
export default function FxPanel({ store, fxController }) {
  const [target, setTarget] = useState("track");

  const trackIndex = useStore(store, events.CURSOR_MOVED, (s) => s.cursor.trackIndex);
  const trackName = store.getState().song.trackChannels[trackIndex]?.name ?? `TRK ${trackIndex + 1}`;

  // Fingerprints (fx values + fxChain's shape), not the mutable objects themselves — see
  // ARCHITECTURE.md's in-place-mutation gotcha (the same reason NoteEditor.jsx/ChannelStrip
  // select primitive fields, not objects).
  useStore(store, events.TRACK_FX_CHANGED, (s) => {
    const channel = s.song.trackChannels[trackIndex];
    return JSON.stringify([channel?.fx ?? {}, channel?.fxChain ?? []]);
  });
  useStore(store, events.MASTER_FX_CHANGED, (s) => JSON.stringify([s.song.masterFx, s.song.masterFxChain]));

  const song = store.getState().song;
  const fxBag = target === "track" ? song.trackChannels[trackIndex]?.fx ?? {} : song.masterFx;
  const fxChain = target === "track" ? song.trackChannels[trackIndex]?.fxChain ?? [] : song.masterFxChain;
  const availableTypes = FX_TYPES.filter((fxType) => !fxChain.some((entry) => entry.type === fxType.id));

  function handleChange(paramId, value) {
    if (target === "track") fxController.setTrackFxParam(trackIndex, paramId, value);
    else fxController.setMasterFxParam(paramId, value);
  }

  function handleAddFx(type) {
    if (!type) return;
    if (target === "track") fxController.addTrackFx(trackIndex, type);
    else fxController.addMasterFx(type);
  }

  function handleRemoveFx(type) {
    if (target === "track") fxController.removeTrackFx(trackIndex, type);
    else fxController.removeMasterFx(type);
  }

  function handleToggleBypass(type, bypassed) {
    if (target === "track") fxController.setTrackFxBypass(trackIndex, type, bypassed);
    else fxController.setMasterFxBypass(type, bypassed);
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
        <div className="fx-module fx-module--output" key="output">
          <div className="fx-module__header">
            <span className="fx-module__title">Output</span>
          </div>
          <FxParamField param={OUTPUT_PARAM} value={fxBag["bus.gain"] ?? OUTPUT_PARAM.default} onChange={(value) => handleChange("bus.gain", value)} />
        </div>

        {fxChain.map((entry) => {
          const fxType = getFxType(entry.type);
          if (!fxType) return null;
          return (
            <div className="fx-module" key={entry.type}>
              <div className="fx-module__header">
                <span className="fx-module__title">{fxType.label}</span>
                <button
                  type="button"
                  className={`fx-module__bypass${entry.bypassed ? " fx-module__bypass--active" : ""}`}
                  onClick={() => handleToggleBypass(entry.type, !entry.bypassed)}
                  title="Bypass"
                >
                  B
                </button>
                <button type="button" className="fx-module__remove" onClick={() => handleRemoveFx(entry.type)} title="Remove">
                  ×
                </button>
              </div>
              {getFxParamsForType(entry.type).map((param) => (
                <FxParamField key={param.id} param={param} value={fxBag[param.id] ?? param.default} onChange={(value) => handleChange(param.id, value)} />
              ))}
            </div>
          );
        })}

        {fxChain.length === 0 && <div className="fx-panel__empty">No FX enabled</div>}
      </div>

      {availableTypes.length > 0 && (
        <label className="fx-panel__add">
          + ADD FX
          <select value="" onChange={(e) => handleAddFx(e.target.value)}>
            <option value="">(select)</option>
            {availableTypes.map((fxType) => (
              <option key={fxType.id} value={fxType.id}>
                {fxType.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
