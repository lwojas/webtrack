import { LFO_RATE_STEPS, LFO_WAVEFORM_LABELS, formatLfoRate, rateToSlider, sliderToRate } from "../../model/instrumentLfos.js";
import { rangeFillStyle } from "../rangeFill.js";

// One LFO of a modulation section: waveform, free/BPM sync, rate or division, amount and target.
// Purely presentational and owner-agnostic: the synth editor (InstrumentPanel.jsx) and every FX
// module (FxPanel.jsx) render the same LFO the same way, since both are webdsp's one LFO bank.
//   lfo       { waveform, sync, rateHz, division, amount, target }
//   options   { waveforms, divisions, targets } as built by the audio layer for that owner
//   labelFor  target id -> display label
export default function LfoEditor({ lfo, lfoIndex, options, labelFor, onChange, onRemove }) {
  const set = onChange;
  const targetKnown = options.targets.includes(lfo.target);
  return (
    <div className="lfo-row">
      <div className="lfo-row__head">
        <span>LFO {lfoIndex + 1}</span>
        <button type="button" className="fx-panel__target-btn" onClick={onRemove}>
          REMOVE
        </button>
      </div>
      <div className="fx-panel__target">
        {options.waveforms.map((w) => (
          <button
            type="button"
            key={w}
            className={`fx-panel__target-btn${lfo.waveform === w ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => set({ waveform: w })}
          >
            {LFO_WAVEFORM_LABELS[w] ?? w.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="fx-panel__target">
        <button type="button" className={`fx-panel__target-btn${lfo.sync ? "" : " fx-panel__target-btn--active"}`} onClick={() => set({ sync: false })}>
          FREE
        </button>
        <button type="button" className={`fx-panel__target-btn${lfo.sync ? " fx-panel__target-btn--active" : ""}`} onClick={() => set({ sync: true })}>
          BPM
        </button>
      </div>
      {lfo.sync ? (
        <label className="fx-module__field">
          <span className="fx-module__field-label">Division</span>
          <select value={options.divisions.includes(lfo.division) ? lfo.division : ""} onChange={(e) => set({ division: e.target.value })}>
            {options.divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="fx-module__value" />
        </label>
      ) : (
        <label className="fx-module__field">
          <span className="fx-module__field-label">Rate</span>
          <input
            type="range"
            min={0}
            max={LFO_RATE_STEPS}
            step={1}
            value={rateToSlider(lfo.rateHz)}
            onChange={(e) => set({ rateHz: sliderToRate(Number(e.target.value)) })}
            style={rangeFillStyle(rateToSlider(lfo.rateHz), 0, LFO_RATE_STEPS)}
          />
          <span className="fx-module__value">{formatLfoRate(lfo.rateHz)}</span>
        </label>
      )}
      <label className="fx-module__field">
        <span className="fx-module__field-label">Amount</span>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={Math.round(lfo.amount * 100)}
          onChange={(e) => set({ amount: Number(e.target.value) / 100 })}
          style={rangeFillStyle(Math.round(lfo.amount * 100), -100, 100)}
        />
        <span className="fx-module__value">{Math.round(lfo.amount * 100)}%</span>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Target</span>
        <select value={lfo.target} onChange={(e) => set({ target: e.target.value })}>
          {!targetKnown && <option value={lfo.target}>{labelFor(lfo.target)} (n/a)</option>}
          {options.targets.map((t) => (
            <option key={t} value={t}>
              {labelFor(t)}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
    </div>
  );
}
