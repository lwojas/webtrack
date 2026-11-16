import { useEffect, useRef } from "react";

// A rotary control: the alternate to a themed <input type="range"> in the instrument editor. Same
// value contract as the slider (min/max/step in slider units, onChange(number)), so callers pass
// what they already pass the range input. Vertical drag turns it (shift = fine), the wheel and
// arrow keys nudge it, double-click resets. An SVG arc shows the value, 270 degrees with the gap at
// the bottom; `hue` tints the arc (null = the theme accent). Role "slider" for assistive tech.
const SWEEP = 270;
const START = 135; // degrees clockwise from 12 o'clock: the arc runs 135 -> 405 (= 45)
const R = 15;
const C = 20;

function polar(deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + R * Math.cos(rad), C + R * Math.sin(rad)];
}

function arc(fromDeg, toDeg) {
  const [x0, y0] = polar(fromDeg);
  const [x1, y1] = polar(toDeg);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function knobFraction(value, min, max) {
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
}

export function snapKnobValue(raw, min, max, step) {
  const clamped = Math.min(max, Math.max(min, raw));
  if (!(step > 0)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(10))));
}

const DRAG_PX = 160; // a full sweep of drag travel

export default function Knob({ value, min, max, step = 0, onChange, onReset, label, valueText, hue = null, size = "m", disabled = false }) {
  const drag = useRef(null);
  const rootRef = useRef(null);
  const wheelRef = useRef(null);
  const fraction = knobFraction(value, min, max);
  const angle = START + fraction * SWEEP;
  const [ix, iy] = polar(angle);
  const style = hue == null ? undefined : { "--knob-accent": `hsl(${hue} 70% 58%)` };

  function commit(raw) {
    const next = snapKnobValue(raw, min, max, step);
    if (next !== value) onChange(next);
  }

  function onPointerDown(e) {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, start: value };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const perPx = (max - min) / (e.shiftKey ? DRAG_PX * 5 : DRAG_PX);
    commit(d.start + (d.y - e.clientY) * perPx);
  }

  function onPointerUp(e) {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Native, non-passive listener (React's onWheel is passive, so it can't stop the panel scrolling).
  wheelRef.current = (e) => {
    if (disabled) return;
    e.preventDefault();
    const unit = step > 0 ? step : (max - min) / 100;
    commit(value + (e.deltaY < 0 ? 1 : -1) * unit * (e.shiftKey ? 1 : 4));
  };
  useEffect(() => {
    const el = rootRef.current;
    const handler = (e) => wheelRef.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  function onKeyDown(e) {
    if (disabled) return;
    const unit = step > 0 ? step : (max - min) / 100;
    const keys = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (e.key in keys) {
      e.preventDefault();
      commit(value + keys[e.key] * unit * (e.shiftKey ? 1 : 2));
    } else if (e.key === "Home") {
      e.preventDefault();
      commit(min);
    } else if (e.key === "End") {
      e.preventDefault();
      commit(max);
    }
  }

  return (
    <div
      className={`knob knob--${size}${disabled ? " knob--disabled" : ""}`}
      ref={rootRef}
      style={style}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <svg viewBox="0 0 40 40" className="knob__svg" aria-hidden="true">
        <path className="knob__track" d={arc(START, START + SWEEP)} />
        {fraction > 0 && <path className="knob__fill" d={arc(START, angle)} />}
        <line className="knob__pointer" x1={C} y1={C} x2={ix} y2={iy} />
      </svg>
    </div>
  );
}
