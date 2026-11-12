import { useEffect, useRef, useState } from "react";
import { GainReductionHistory, MASTER_BUS, compressorCurveDb, compressorMeter, peakToDb, reductionCharacter } from "webdsp";
import { CanvasSurface } from "../viz/canvasSurface.js";
import { cssColor, withAlpha } from "../viz/theme.js";
import { peekRuntime, peekTrackBusIds } from "../../audio/runtime.js";
import { compressorPresets } from "../../audio/presets.js";
import EqCurveEditor from "./EqCurveEditor.jsx";
import LfoEditor from "./LfoEditor.jsx";
import ModBadge from "./ModBadge.jsx";
import { automatedKeys, fxKey } from "../../model/cellAutomation.js";
import { getFxModulationOptions, getSpectrumTap } from "../../audio/fx.js";
import { MAX_INSTRUMENT_LFOS } from "../../model/instrumentLfos.js";
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

// A `kind: "track"` param (comp.sidechain — model/fxParams.js) names one of the song's tracks, so it is a list of them rather
// than a slider. `trackNames` is every track's name in order; the track the FX sits on (`ownerIndex`, null on master) is left
// out because it cannot key itself. A value past the song's tracks still shows, so it can be cleared.
function FxTrackField({ param, value, onChange, trackNames, ownerIndex }) {
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={param.label}>
        {param.label}
      </span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} title="The track whose signal drives this effect">
        <option value={0}>Off (own input)</option>
        {value > trackNames.length && <option value={value}>{formatFxValue(value, param)} (missing)</option>}
        {trackNames.map((name, i) => (i === ownerIndex ? null : <option key={i} value={i + 1}>{`${i + 1} — ${name}`}</option>))}
      </select>
    </label>
  );
}

// The compressor's display: the static transfer curve (with a dot at the live input level) beside a scrolling gain-reduction
// trace, all on one canvas with its readout drawn into it, so a moving value never changes the DOM or the card's size. Fed by the
// engine's per-bus compressor meter (webdsp compressorMeter); with several compressors on one bus it shows the bus's. Runs outside
// React (one rAF loop, no state) and repaints only when the picture changed. `settingsRef` holds the instance's current
// threshold / ratio / knee; `trackIndex` null is the master bus.
const GR_RANGE_DB = 18;
const CURVE_MIN_DB = -48;
const TRACE_LEN = 150;

function CompressorDisplay({ settingsRef, trackIndex }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const surface = new CanvasSurface(canvas);
    const colors = {
      grid: withAlpha(cssColor(canvas, "--text-dim", "#8a93a6"), 0.25),
      text: cssColor(canvas, "--text-dim", "#8a93a6"),
      curve: cssColor(canvas, "--text", "#e4e6eb"),
      gr: cssColor(canvas, "--amber", "#ff9d00"),
      dot: cssColor(canvas, "--cyan", "#00f0ff"),
    };
    const history = new GainReductionHistory(TRACE_LEN);
    let live = { inDb: CURVE_MIN_DB, grDb: 0 };
    let unsubscribe = null;
    let attachedTo = null;
    let frame = 0;
    let lastKey = "";

    const paint = () => {
      const w = surface.width;
      const h = surface.height;
      const s = settingsRef.current;
      const ctx = surface.begin();
      if (!ctx) return;
      ctx.font = "10px monospace";
      // Left square: transfer curve, input dB across, output dB up, -48..0.
      const size = Math.min(h - 4, w * 0.4);
      const x0 = 2;
      const y0 = 2;
      const px = (db) => x0 + ((db - CURVE_MIN_DB) / -CURVE_MIN_DB) * size;
      const py = (db) => y0 + size - ((db - CURVE_MIN_DB) / -CURVE_MIN_DB) * size;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, size, size);
      ctx.beginPath();
      ctx.moveTo(px(CURVE_MIN_DB), py(CURVE_MIN_DB));
      ctx.lineTo(px(0), py(0)); // unity
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const inDb = CURVE_MIN_DB + (i / 48) * -CURVE_MIN_DB;
        const outDb = compressorCurveDb(inDb, s);
        if (i === 0) ctx.moveTo(px(inDb), py(outDb));
        else ctx.lineTo(px(inDb), py(outDb));
      }
      ctx.strokeStyle = colors.curve;
      ctx.stroke();
      const dotIn = Math.max(CURVE_MIN_DB, Math.min(0, live.inDb));
      ctx.fillStyle = colors.dot;
      ctx.beginPath();
      ctx.arc(px(dotIn), py(compressorCurveDb(dotIn, s)), 3, 0, Math.PI * 2);
      ctx.fill();
      // Right: gain-reduction trace, 0 at the top down to -GR_RANGE_DB.
      const tx = x0 + size + 14;
      const tw = w - tx - 2;
      ctx.strokeStyle = colors.grid;
      ctx.strokeRect(tx, y0, tw, size);
      const values = history.values();
      ctx.beginPath();
      ctx.moveTo(tx, y0);
      for (let i = 0; i < values.length; i++) {
        const x = tx + (i / (values.length - 1)) * tw;
        ctx.lineTo(x, y0 + Math.min(1, -values[i] / GR_RANGE_DB) * size);
      }
      ctx.lineTo(tx + tw, y0);
      ctx.closePath();
      ctx.fillStyle = withAlpha(colors.gr, 0.35);
      ctx.fill();
      ctx.strokeStyle = colors.gr;
      ctx.stroke();
      // Readout, drawn (fixed position, never reflows).
      ctx.fillStyle = colors.text;
      ctx.textAlign = "right";
      const gr = live.grDb;
      ctx.fillText(gr > -0.1 ? "0.0 dB" : `${gr.toFixed(1)} dB · ${reductionCharacter(gr)}`, tx + tw - 4, y0 + 12);
      ctx.textAlign = "left";
      ctx.fillText("GR", tx + 4, y0 + 12);
    };

    const loop = () => {
      const runtime = peekRuntime();
      if (runtime && runtime !== attachedTo) {
        unsubscribe?.();
        attachedTo = runtime;
        unsubscribe = runtime.onMeters((snapshot) => {
          const bus = trackIndex === null ? MASTER_BUS : peekTrackBusIds()[trackIndex];
          if (bus === undefined) return;
          const m = compressorMeter(snapshot, bus);
          history.push(m.gainReductionDb);
          live = { inDb: m.inPeak > 0 ? peakToDb(m.inPeak) : CURVE_MIN_DB, grDb: m.gainReductionDb };
        });
      }
      const s = settingsRef.current;
      // Repaint only when something visible changed: the (0.1 dB, pixel-scale) live values or the settings.
      const key = `${live.inDb.toFixed(1)}|${live.grDb.toFixed(1)}|${s.threshold}|${s.ratio}|${s.knee}|${history.values()[TRACE_LEN - 1]?.toFixed(1)}`;
      if (surface.dirty || key !== lastKey) {
        lastKey = key;
        paint();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      unsubscribe?.();
      cancelAnimationFrame(frame);
      surface.dispose();
    };
  }, [settingsRef, trackIndex]);
  return <canvas ref={canvasRef} className="fx-module__display" />;
}

function CompressorPresetField({ onApply }) {
  const presets = compressorPresets();
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title="webdsp's drum-bus presets: sets threshold, ratio, attack, release, knee and makeup (threshold assumes drums peaking near -3 dBFS)">
        Preset
      </span>
      <select
        value=""
        onChange={(e) => {
          const preset = presets.find((p) => p.name === e.target.value);
          if (preset) for (const [id, value] of Object.entries(preset.values)) onApply(id, value);
        }}
      >
        <option value="">(select)</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name} title={p.purpose}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="fx-module__value" />
    </label>
  );
}

function FxParamField({ param, value, onChange, automated = false, lfos = 0, trackNames = [], ownerIndex = null }) {
  if (param.kind === "track") return <FxTrackField param={param} value={value} onChange={onChange} trackNames={trackNames} ownerIndex={ownerIndex} />;
  if (param.kind === "boolean") return <FxBooleanField param={param} value={value} onChange={onChange} />;
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={param.label}>
        {param.label}
        <ModBadge automated={automated} lfos={lfos} />
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

// The MODULATION section of one FX module: the instance's own stackable LFOs (webdsp's per-effect
// LFO bank — the same bank, and the same LfoEditor, a synth's modulation slot uses). The option
// lists and the modulatable parameters come from the engine; a kind with none shows nothing.
// `lfoTrackIndex` is the track index, or null for the master chain.
function FxModulation({ entry, lfoTrackIndex, fxController }) {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    getFxModulationOptions(entry.type)
      .then((o) => !cancelled && setOptions(o))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.type]);
  if (!options || options.targets.length === 0) return null;
  const lfos = entry.lfos ?? [];
  const labelFor = (id) => getFxParam(id)?.label ?? id;
  const preferred = options.targets.find((t) => /cutoff|mix|gain/.test(t)) ?? options.targets[0];
  return (
    <div className="fx-module__modulation">
      <div className="note-editor__section">MODULATION</div>
      {lfos.map((lfo, i) => (
        <LfoEditor
          key={i}
          lfo={lfo}
          lfoIndex={i}
          options={options}
          labelFor={labelFor}
          onChange={(patch) => fxController.setFxLfo(lfoTrackIndex, entry.id, i, patch)}
          onRemove={() => fxController.removeFxLfo(lfoTrackIndex, entry.id, i)}
        />
      ))}
      <button
        type="button"
        className="fx-panel__target-btn"
        disabled={lfos.length >= Math.min(options.maxLfos, MAX_INSTRUMENT_LFOS)}
        onClick={() => fxController.addFxLfo(lfoTrackIndex, entry.id, preferred)}
      >
        + ADD LFO
      </button>
    </div>
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

  // Parameters of this track's instances that cells automate (track view only: a cell cannot reach
  // the master bus), as a primitive fingerprint so the panel re-renders when it changes.
  const automatedFx = useStore(store, events.CELL_CHANGED, (s) => (target === "track" ? [...automatedKeys(s.song, trackIndex)].filter((k) => k.startsWith("fx:")).sort().join(",") : "")).split(",");

  const song = store.getState().song;
  // Track names for a sidechain pick; the fingerprint re-renders the panel when a name changes.
  useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels.map((c) => c.name).join("\u0000"));
  const trackNames = song.trackChannels.map((c, i) => c.name || `TRK ${i + 1}`);
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

  // The compressor display reads its curve settings from a ref it can poll without re-rendering; refreshed every render.
  const compRef = useRef({});
  function compSettings(values) {
    compRef.current = {
      threshold: values["comp.threshold"] ?? getFxParam("comp.threshold").default,
      ratio: values["comp.ratio"] ?? getFxParam("comp.ratio").default,
      knee: values["comp.knee"] ?? getFxParam("comp.knee").default,
    };
    return compRef;
  }

  function renderParamFields(entry, instanceValues) {
    return getFxParamsForType(entry.type).map((param) => (
      <FxParamField
        key={param.id}
        param={param}
        value={instanceValues[param.id] ?? param.default}
        onChange={(value) => handleInstanceChange(entry.id, param.id, value)}
        automated={automatedFx.includes(fxKey(entry.id, param.id))}
        lfos={(entry.lfos ?? []).filter((l) => l.target === param.id).length}
        trackNames={trackNames}
        ownerIndex={target === "track" ? trackIndex : null}
      />
    ));
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
            <div className={`fx-module${entry.type === "eq" ? " fx-module--eq" : ""}${entry.type === "compressor" ? " fx-module--wide" : ""}`} key={entry.id}>
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
              {entry.type === "eq" ? (
                <EqCurveEditor
                  values={instanceValues}
                  spectrumTap={() => getSpectrumTap(target, trackIndex, entry.id)}
                  spectrumKey={`${target}:${trackIndex}:${entry.id}`}
                  onChange={(paramId, value) => handleInstanceChange(entry.id, paramId, value)}
                  renderField={(paramId) => {
                    const param = getFxParam(paramId);
                    return (
                      <FxParamField
                        param={param}
                        value={instanceValues[paramId] ?? param.default}
                        onChange={(value) => handleInstanceChange(entry.id, paramId, value)}
                        automated={automatedFx.includes(fxKey(entry.id, paramId))}
                        lfos={(entry.lfos ?? []).filter((l) => l.target === paramId).length}
                      />
                    );
                  }}
                />
              ) : entry.type === "compressor" ? (
                <>
                  <CompressorDisplay settingsRef={compSettings(instanceValues)} trackIndex={target === "track" ? trackIndex : null} />
                  <CompressorPresetField onApply={(paramId, value) => handleInstanceChange(entry.id, paramId, value)} />
                  {renderParamFields(entry, instanceValues)}
                </>
              ) : (
                renderParamFields(entry, instanceValues)
              )}
              <FxModulation entry={entry} lfoTrackIndex={target === "track" ? trackIndex : null} fxController={fxController} />
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
