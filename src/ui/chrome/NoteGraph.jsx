import { useRef, useState } from "react";
import { barFraction, stepBarValue, valueAtFraction } from "../../model/noteGraph.js";

// Two rows of bars, one per editable field of the selected event (see model/noteGraph.js for which
// bars exist and the values each can take). Press and drag vertically on a bar to set it — values
// snap to what the context offers, so a chop slot's NOTE bar steps through its slices and a project
// in a key only offers that key's notes. Dragging below the first value (or double-click, Delete)
// clears a field that can be empty. A focused bar also takes Up/Down (Shift = bigger jumps).
// Edits write through `onSet` as the pointer moves, so the grid follows the drag.

function GraphBar({ bar, onSet, onDrag }) {
  const ref = useRef(null);
  const draggingRef = useRef(false);
  const [hot, setHot] = useState(false);
  const steps = bar.values.length + (bar.clearable ? 1 : 0);
  const empty = bar.value === null || bar.value === undefined;
  const fill = barFraction(bar);
  const readout = empty ? (bar.emptyLabel ?? "---") : bar.format(bar.value);

  function paint(e) {
    const rect = ref.current.getBoundingClientRect();
    const value = valueAtFraction(bar, 1 - (e.clientY - rect.top) / rect.height);
    if (value !== bar.value) onSet(bar, value);
  }
  function end() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setHot(false);
    onDrag(bar, false);
  }

  return (
    <div className={`note-graph__col${hot ? " note-graph__col--hot" : ""}`}>
      <span className={`note-graph__value${empty ? " note-graph__value--empty" : ""}`}>{readout}</span>
      <div
        ref={ref}
        className="note-graph__bar"
        // Tick marks only where steps are few enough to tell apart.
        style={steps <= 24 ? { "--steps": steps } : undefined}
        data-stepped={steps <= 24 || undefined}
        tabIndex={0}
        role="slider"
        aria-label={bar.label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={bar.values.length - 1}
        aria-valuenow={empty ? 0 : Math.max(0, bar.values.indexOf(bar.value))}
        aria-valuetext={readout}
        title={`${bar.label}${bar.hint ? ` — ${bar.hint}` : ""}. Drag to set; drag to the bottom${bar.clearable ? " or double-click to clear" : ""}.`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setHot(true);
          onDrag(bar, true);
          paint(e);
        }}
        onPointerMove={(e) => draggingRef.current && paint(e)}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => bar.clearable && !empty && onSet(bar, null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = stepBarValue(bar, e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
            if (next !== bar.value) onSet(bar, next);
          } else if ((e.key === "Delete" || e.key === "Backspace") && bar.clearable) {
            e.preventDefault();
            onSet(bar, null);
          }
        }}
      >
        <div className="note-graph__fill" style={{ height: `${fill * 100}%` }} />
      </div>
      <span className="note-graph__label">{bar.label}</span>
    </div>
  );
}

export default function NoteGraph({ bars, onSet, onDrag }) {
  return (
    <div className="note-graph">
      {[0, 1].map((row) => (
        <div className="note-graph__row" key={row}>
          {bars
            .filter((bar) => bar.row === row)
            .map((bar) => (
              <GraphBar key={bar.id} bar={bar} onSet={onSet} onDrag={onDrag} />
            ))}
        </div>
      ))}
    </div>
  );
}
