import { useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { FX_TYPES, getFxType, getFxParam, getFxParamsForType, getFxInstanceLabel, formatFxValue, isFxBooleanOn } from "../../model/fxParams.js";
import { rangeFillStyle } from "../rangeFill.js";

// bus.gain (model/fxParams.js) isn't one of FX_TYPES' toggleable nodes — it's the bus's own
// always-present output stage, so it gets a pinned module below instead of living in the
// add/remove chain like every other FX. Pan (model/trackChannel.js#pan / model/song.js#
// masterPan) lives in this same pinned module for the master side — see its own doc comment for
// why: MASTER_BUS has no ChannelStrip equivalent (ui/chrome/Mixer.jsx only renders per-track
// strips), so its pan control sits right next to bus.gain here instead.
const OUTPUT_PARAM = getFxParam("bus.gain");

// A `kind: "boolean"` param (filter.mode, filter.slope — model/fxParams.js) has no continuous
// range to slide through, so it gets its own on/off button instead of a <input type="range">
// that would otherwise only ever sit at one of two tick marks. Independent of the module
// header's own bypass (B) button above — this toggles what the FX *does*, bypass toggles
// whether it's active at all. Toggles between param.min/param.max rather than a hardcoded 0/1,
// since filter.slope's two values are webdsp's own 12/24, not a normalized flag.
function FxBooleanField({ param, value, onChange }) {
  const isOn = isFxBooleanOn(value, param);
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={param.label}>
        {param.label}
      </span>
      <button type="button" className={`fx-module__toggle${isOn ? " fx-module__toggle--on" : ""}`} onClick={() => onChange(isOn ? param.min : param.max)}>
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
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={rangeFillStyle(value, param.min, param.max)}
      />
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
// Both targets render the same chain-based view: an *ordered list of instances* (fxChain), not
// one slot per FX_TYPES kind — the same kind can appear more than once (model/trackChannel.js's
// doc comment), each with its own independent parameters, so "+ ADD FX" is never disabled for a
// kind that's already present, and each module's header is labeled via getFxInstanceLabel to
// disambiguate stacked instances of the same kind ("Filter #1", "Filter #2"). A track or
// MASTER_BUS with nothing enabled shows just the pinned Output module and the add-FX control,
// not a wall of disabled sliders.
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
  useStore(store, events.MASTER_FX_CHANGED, (s) => JSON.stringify([s.song.masterFx, s.song.masterFxChain, s.song.masterPan]));
  useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex]?.pan);

  const song = store.getState().song;
  const fxBag = target === "track" ? (song.trackChannels[trackIndex]?.fx ?? { instances: {} }) : song.masterFx;
  const fxChain = target === "track" ? (song.trackChannels[trackIndex]?.fxChain ?? []) : song.masterFxChain;
  const pan = target === "track" ? (song.trackChannels[trackIndex]?.pan ?? 0) : song.masterPan;

  function handleChange(paramId, value) {
    if (target === "track") fxController.setTrackFxParam(trackIndex, paramId, value);
    else fxController.setMasterFxParam(paramId, value);
  }

  function handleInstanceChange(instanceId, paramId, value) {
    if (target === "track") fxController.setTrackFxInstanceParam(trackIndex, instanceId, paramId, value);
    else fxController.setMasterFxInstanceParam(instanceId, paramId, value);
  }

  function handlePanChange(value) {
    if (target === "track") fxController.setTrackPan(trackIndex, value);
    else fxController.setMasterPan(value);
  }

  function handleAddFx(type) {
    if (!type) return;
    if (target === "track") fxController.addTrackFx(trackIndex, type);
    else fxController.addMasterFx(type);
  }

  function handleRemoveFx(instanceId) {
    if (target === "track") fxController.removeTrackFx(trackIndex, instanceId);
    else fxController.removeMasterFx(instanceId);
  }

  function handleToggleBypass(instanceId, bypassed) {
    if (target === "track") fxController.setTrackFxBypass(trackIndex, instanceId, bypassed);
    else fxController.setMasterFxBypass(instanceId, bypassed);
  }

  function handleMove(instanceId, direction) {
    if (target === "track") fxController.moveTrackFx(trackIndex, instanceId, direction);
    else fxController.moveMasterFx(instanceId, direction);
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
          <label className="fx-module__field">
            <span className="fx-module__field-label" title="Pan">
              Pan
            </span>
            <input type="range" min={-1} max={1} step={0.01} value={pan} onChange={(e) => handlePanChange(Number(e.target.value))} />
            <span className="fx-module__value">{pan.toFixed(2)}</span>
          </label>
        </div>

        {fxChain.map((entry, index) => {
          const fxType = getFxType(entry.type);
          if (!fxType) return null;
          const instanceValues = fxBag.instances?.[entry.id] ?? {};
          return (
            <div className="fx-module" key={entry.id}>
              <div className="fx-module__header">
                <span className="fx-module__title">{getFxInstanceLabel(fxChain, entry.id)}</span>
                <button
                  type="button"
                  className="fx-module__move"
                  onClick={() => handleMove(entry.id, -1)}
                  disabled={index === 0}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="fx-module__move"
                  onClick={() => handleMove(entry.id, 1)}
                  disabled={index === fxChain.length - 1}
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={`fx-module__bypass${entry.bypassed ? " fx-module__bypass--active" : ""}`}
                  onClick={() => handleToggleBypass(entry.id, !entry.bypassed)}
                  title="Bypass"
                >
                  B
                </button>
                <button type="button" className="fx-module__remove" onClick={() => handleRemoveFx(entry.id)} title="Remove">
                  ×
                </button>
              </div>
              {getFxParamsForType(entry.type).map((param) => (
                <FxParamField
                  key={param.id}
                  param={param}
                  value={instanceValues[param.id] ?? param.default}
                  onChange={(value) => handleInstanceChange(entry.id, param.id, value)}
                />
              ))}
            </div>
          );
        })}

        {fxChain.length === 0 && <div className="fx-panel__empty">No FX enabled</div>}
      </div>

      <label className="fx-panel__add">
        + ADD FX
        <select value="" onChange={(e) => handleAddFx(e.target.value)}>
          <option value="">(select)</option>
          {FX_TYPES.map((fxType) => (
            <option key={fxType.id} value={fxType.id}>
              {fxType.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
