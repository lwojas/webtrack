import { useRef } from "react";
import { rangeFillStyle } from "../rangeFill.js";
import {
  ARP_MODES,
  ARP_PATTERNS,
  ARP_RATES,
  ARP_VELOCITY_PRESETS,
  MAX_ARP_OCTAVES,
  MAX_ARP_VELOCITY_STEPS,
  MIN_ARP_GATE,
  MIN_ARP_VELOCITY_STEPS,
} from "../../model/arp.js";

// The arpeggiator controls (model/arp.js) for one instrument slot. The arp belongs to the
// instrument, not the track: it reads only the notes that address this instrument (bar by bar, their
// notes the chord, their lengths the windows it plays in) and plays generated notes in their place;
// the steps themselves are never changed. Rendered by InstrumentPanel.jsx under EDIT INSTRUMENT.

const VELOCITY_MODES = [
  { id: "source", label: "SRC", title: "Generated notes keep the velocity of the step they play inside" },
  { id: "pattern", label: "PAT", title: "Generated notes follow the step levels below" },
  { id: "accent", label: "ACC", title: "The step levels only ever turn the step's velocity down" },
];

// One bar per velocity step; press and drag across them to draw a pattern. Levels are 0..1 in the
// model and read 0-127 here, like the VEL column.
function ArpVelocitySteps({ steps, disabled, onChange }) {
  const ref = useRef(null);
  function paint(e) {
    const el = ref.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const index = Math.min(steps.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * steps.length)));
    const level = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)) * 100) / 100;
    if (steps[index] !== level) onChange(steps.map((v, i) => (i === index ? level : v)));
  }
  return (
    <div
      className="arp-steps"
      ref={ref}
      role="group"
      aria-label="Arp velocity steps"
      title={steps.map((v) => Math.round(v * 127)).join(" ")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        paint(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && paint(e)}
    >
      {steps.map((level, i) => (
        <div key={i} className="arp-steps__bar">
          <div className="arp-steps__fill" style={{ height: `${level * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function ArpModule({ arp, instrumentLabel, onChange }) {
  const v = arp.velocity;
  const setSteps = (steps) => onChange({ velocity: { steps } });
  function lengthDelta(d) {
    const n = Math.min(MAX_ARP_VELOCITY_STEPS, Math.max(MIN_ARP_VELOCITY_STEPS, v.steps.length + d));
    if (n === v.steps.length) return;
    setSteps(n < v.steps.length ? v.steps.slice(0, n) : [...v.steps, ...Array.from({ length: n - v.steps.length }, (_, i) => v.steps[i % v.steps.length])]);
  }
  return (
    <div className="fx-module fx-module--arp fx-module--arp-inline">
      <div className="fx-module__header">
        <span className="fx-module__title" title="The arp belongs to this instrument: other instruments on the same track are unaffected">{`ARP — ${instrumentLabel}`}</span>
        <span title={arp.enabled ? "Plays this instrument's steps, bar by bar" : "Off: this instrument's steps play as written"}>{arp.enabled ? "ON" : "OFF"}</span>
      </div>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Enabled</span>
        <button type="button" className={`fx-module__toggle${arp.enabled ? " fx-module__toggle--on" : ""}`} onClick={() => onChange({ enabled: !arp.enabled })}>
          {arp.enabled ? "ON" : "OFF"}
        </button>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Order</span>
        <select value={arp.mode} onChange={(e) => onChange({ mode: e.target.value })}>
          {ARP_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
      {arp.mode === "pattern" && (
        <label className="fx-module__field" title="Index into the chord, low to high. · is a rest.">
          <span className="fx-module__field-label">Pattern</span>
          <select value={arp.pattern} onChange={(e) => onChange({ pattern: e.target.value })}>
            {ARP_PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="fx-module__value" />
        </label>
      )}
      <label className="fx-module__field">
        <span className="fx-module__field-label">Rate</span>
        <select value={arp.rate} onChange={(e) => onChange({ rate: e.target.value })}>
          {ARP_RATES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Octaves</span>
        <input
          type="range"
          min={1}
          max={MAX_ARP_OCTAVES}
          step={1}
          value={arp.octaves}
          onChange={(e) => onChange({ octaves: Number(e.target.value) })}
          style={rangeFillStyle(arp.octaves, 1, MAX_ARP_OCTAVES)}
        />
        <span className="fx-module__value">{arp.octaves}</span>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Gate</span>
        <input
          type="range"
          min={Math.round(MIN_ARP_GATE * 100)}
          max={100}
          step={5}
          value={Math.round(arp.gate * 100)}
          onChange={(e) => onChange({ gate: Number(e.target.value) / 100 })}
          style={rangeFillStyle(Math.round(arp.gate * 100), Math.round(MIN_ARP_GATE * 100), 100)}
        />
        <span className="fx-module__value">{Math.round(arp.gate * 100)}%</span>
      </label>
      <div className="fx-module__field">
        <span className="fx-module__field-label">Velocity</span>
        <span className="arp-vel-modes">
          {VELOCITY_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.title}
              className={`fx-module__toggle arp-vel-modes__btn${v.mode === m.id ? " fx-module__toggle--on" : ""}`}
              onClick={() => onChange({ velocity: { mode: m.id } })}
            >
              {m.label}
            </button>
          ))}
        </span>
      </div>
      {v.mode !== "source" && (
        <>
          <label className="fx-module__field">
            <span className="fx-module__field-label">Amount</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(v.amount * 100)}
              onChange={(e) => onChange({ velocity: { amount: Number(e.target.value) / 100 } })}
              style={rangeFillStyle(Math.round(v.amount * 100), 0, 100)}
            />
            <span className="fx-module__value">{Math.round(v.amount * 100)}%</span>
          </label>
          <ArpVelocitySteps steps={v.steps} disabled={!arp.enabled} onChange={setSteps} />
          <div className="arp-steps-tools">
            <button type="button" className="fx-panel__target-btn" disabled={v.steps.length <= MIN_ARP_VELOCITY_STEPS} onClick={() => lengthDelta(-1)} aria-label="Fewer velocity steps">
              −
            </button>
            <span className="arp-steps-tools__count">{v.steps.length}</span>
            <button type="button" className="fx-panel__target-btn" disabled={v.steps.length >= MAX_ARP_VELOCITY_STEPS} onClick={() => lengthDelta(1)} aria-label="More velocity steps">
              +
            </button>
            <select
              value=""
              aria-label="Velocity step preset"
              onChange={(e) => {
                const preset = ARP_VELOCITY_PRESETS.find((p) => p.id === e.target.value);
                if (preset) setSteps([...preset.steps]);
              }}
            >
              <option value="">PRESET…</option>
              {ARP_VELOCITY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
