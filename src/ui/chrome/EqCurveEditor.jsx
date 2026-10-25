import { useEffect, useMemo, useRef, useState } from "react";
import { EQ_MAX_HZ, EQ_MIN_HZ, eqBandResponseDb, eqBandUses, eqCurve } from "webdsp";
import { useSpectrumCanvas } from "../viz/useSpectrumCanvas.js";
import { EQ_VIEW_DB, bandsFromValues, dbToY, freqToX, handleDb, widenedValue, widthField, xToFreq, yToDb } from "../../model/eqGeometry.js";

const W = 640;
const H = 190;
const POINTS = 192;
const SAMPLE_RATE = 48000; // the curve's shape barely depends on it; only the top octave does
const BAND_COLORS = ["#00f0ff", "#ff9d00", "#00e676", "#ff3366"];
const TYPE_NAMES = ["Bell", "Low shelf", "High shelf", "Low-pass", "High-pass", "Notch"];
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
// Live spectrum behind the curve (the EQ's output, with its input fainter): its own dB scale (dBFS), independent of the EQ's +-dB axis.
const SPECTRUM_MIN_DB = -90;
const SPECTRUM_MAX_DB = -10;
const FIELD_PARAM = { frequency: "Freq", gain: "Gain", q: "Q", shelfSlope: "ShelfSlope", slope: "Slope" };

// Interactive EQ: the response curve is the control surface. Drag a handle = frequency (x) and gain (y);
// wheel or shift+drag = Q (bell/notch) or slope (shelves); double-click = enable/disable. The selected
// band's meaningful controls sit beside the graph, rendered by the caller's `renderField` so they keep
// the panel's usual sliders, automation badges and boolean toggles.
export default function EqCurveEditor({ values, onChange, renderField, spectrumTap, spectrumKey = "" }) {
  const svgRef = useRef(null);
  const spectrumRef = useRef(null);
  useSpectrumCanvas(spectrumRef, () => spectrumTap?.() ?? null, spectrumKey, {
    width: W, height: H, minDb: SPECTRUM_MIN_DB, maxDb: SPECTRUM_MAX_DB,
    // The EQ's output is the main fill (it moves as you drag); its input sits fainter behind it.
    main: { fill: "rgba(0, 240, 255, 0.14)", stroke: "rgba(0, 240, 255, 0.55)" },
    input: { fill: "rgba(0, 240, 255, 0.05)", stroke: "rgba(0, 240, 255, 0.2)" },
  });
  const [selected, setSelected] = useState(1);
  const drag = useRef(null);
  const wasOnAtFirstClick = useRef(false);
  const lastDown = useRef({ band: -1, at: 0 });
  // The store mutates `values` in place (the panel re-renders on a fingerprint), so its identity cannot key a
  // memo: derive the bands each render and memoise the curve on their content instead.
  const bands = bandsFromValues(values);
  const bandsKey = JSON.stringify(bands);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const curve = useMemo(() => eqCurve(bands, SAMPLE_RATE, POINTS), [bandsKey]);

  const path = (db) => Array.from(db, (v, i) => `${i ? "L" : "M"}${freqToX(curve.frequencies[i], W).toFixed(1)},${dbToY(v, H).toFixed(1)}`).join("");
  const set = (band, field, v) => onChange(`eq.b${band + 1}${field}`, v);
  const local = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onDown = (i) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(i);
    // PointerEvent.detail is always 0, so a double-click is recognised by timing: remember whether the band
    // was on before the FIRST press (the press itself enables an off band).
    if (lastDown.current.band !== i || e.timeStamp - lastDown.current.at > 500) wasOnAtFirstClick.current = bands[i].enabled;
    lastDown.current = { band: i, at: e.timeStamp };
    if (!bands[i].enabled) set(i, "On", 1);
    const wf = widthField(bands[i].type);
    drag.current = { band: i, startY: e.clientY, startWidth: wf ? bands[i][wf] : 0, width: e.shiftKey };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const b = bands[d.band];
    if (d.width) {
      const wf = widthField(b.type);
      if (wf) set(d.band, FIELD_PARAM[wf], widenedValue(b.type, d.startWidth, (e.clientY - d.startY) / 60));
      return;
    }
    const p = local(e);
    set(d.band, "Freq", Math.round(xToFreq(p.x, W)));
    if (eqBandUses(b.type, "gain")) set(d.band, "Gain", Math.round(yToDb(p.y, H) * 10) / 10);
  };
  // Wheel over a handle edits its width. React's onWheel is passive (cannot stop the page scrolling), so this is a
  // native non-passive listener that reads the latest bands through a ref.
  const latest = useRef({ bands, set });
  latest.current = { bands, set };
  useEffect(() => {
    const svg = svgRef.current;
    const onWheel = (e) => {
      const i = Number(e.target?.dataset?.band);
      if (!Number.isInteger(i)) return;
      const { bands: bs, set: setParam } = latest.current;
      const wf = widthField(bs[i].type);
      if (!wf) return;
      e.preventDefault();
      setParam(i, FIELD_PARAM[wf], widenedValue(bs[i].type, bs[i][wf], -e.deltaY / 300));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const sel = bands[selected];
  const n = selected + 1;
  const fields = ["On", "Type"].map((f) => f).concat(Object.entries(FIELD_PARAM).filter(([k]) => eqBandUses(sel.type, k)).map(([, p]) => p));

  return (
    <div className="eq-editor">
      <div className="eq-editor__main">
        <div className="eq-editor__graph-wrap">
        <canvas ref={spectrumRef} className="eq-editor__spectrum" aria-hidden="true" />
        <svg
          ref={svgRef}
          className="eq-editor__graph"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label="EQ frequency response"
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
        >
          {[-12, -6, 0, 6, 12].map((db) => (
            <g key={db}>
              <line className={db === 0 ? "eq-editor__zero" : "eq-editor__grid"} x1={0} x2={W} y1={dbToY(db, H)} y2={dbToY(db, H)} />
              <text className="eq-editor__label" x={3} y={dbToY(db, H) - 2}>{db > 0 ? `+${db}` : db}</text>
            </g>
          ))}
          {GRID_HZ.map((hz) => (
            <g key={hz}>
              <line className="eq-editor__grid" x1={freqToX(hz, W)} x2={freqToX(hz, W)} y1={0} y2={H} />
              <text className="eq-editor__label" x={freqToX(hz, W) + 2} y={H - 3}>{hz >= 1000 ? `${hz / 1000}k` : hz}</text>
            </g>
          ))}
          {bands.map((b, i) =>
            b.enabled ? (
              <path key={i} d={`${path(curve.bandDb[i])}L${W},${dbToY(0, H)}L0,${dbToY(0, H)}Z`} fill={BAND_COLORS[i]} fillOpacity={selected === i ? 0.22 : 0.1} stroke="none" />
            ) : null,
          )}
          <path className="eq-editor__curve" d={path(curve.combinedDb)} />
          {bands.map((b, i) => (
            <circle
              key={i}
              className={`eq-editor__handle${b.enabled ? "" : " eq-editor__handle--off"}`}
              cx={freqToX(b.frequency, W)}
              cy={dbToY(handleDb(b), H)}
              r={selected === i ? 9 : 7}
              stroke={BAND_COLORS[i]}
              fill={b.enabled ? BAND_COLORS[i] : "transparent"}
              onPointerDown={onDown(i)}
              data-band={i}
              onDoubleClick={() => set(i, "On", wasOnAtFirstClick.current ? 0 : 1)}
            >
              <title>{`Band ${i + 1} ${TYPE_NAMES[b.type]} ${Math.round(b.frequency)} Hz`}</title>
            </circle>
          ))}
          {bands.map((b, i) => (
            <text key={`n${i}`} className="eq-editor__num" x={freqToX(b.frequency, W)} y={dbToY(handleDb(b), H) + 3.5}>{i + 1}</text>
          ))}
        </svg>
        </div>
        <div className="eq-editor__hint">
          Drag a handle: frequency / gain. Wheel or shift-drag: Q / slope. Double-click: on/off. +-{EQ_VIEW_DB} dB, {EQ_MIN_HZ} Hz to {EQ_MAX_HZ / 1000} kHz.
        </div>
      </div>
      <div className="eq-editor__band" style={{ borderColor: BAND_COLORS[selected] }}>
        <div className="eq-editor__tabs">
          {bands.map((b, i) => (
            <button key={i} type="button" className={`eq-editor__tab${selected === i ? " eq-editor__tab--active" : ""}`} style={{ borderColor: BAND_COLORS[i] }} onClick={() => setSelected(i)}>
              {i + 1}
            </button>
          ))}
          <span className="eq-editor__readout">
            {Math.round(sel.frequency)}Hz{eqBandUses(sel.type, "gain") ? ` ${sel.gain.toFixed(1)}dB` : ""}
            {sel.enabled ? ` (${eqBandResponseDb(sel, sel.frequency, SAMPLE_RATE).toFixed(1)}dB)` : ""}
          </span>
        </div>
        {fields.map((f) => (f === "Type" ? (
          <label key={f} className="fx-module__field">
            <span className="fx-module__field-label">Type</span>
            <select value={sel.type} onChange={(e) => set(selected, "Type", Number(e.target.value))}>
              {TYPE_NAMES.map((name, v) => <option key={v} value={v}>{name}</option>)}
            </select>
            <span />
          </label>
        ) : (
          <div key={f}>{renderField(`eq.b${n}${f}`)}</div>
        )))}
      </div>
    </div>
  );
}
