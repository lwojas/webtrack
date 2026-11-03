import { useMemo, useRef, useState } from "react";
import { MATRIX_INS, MATRIX_OUTS } from "webdsp";
import ModBadge from "./ModBadge.jsx";
import { MATRIX_CELL_PARAMS } from "../../model/instrumentParams.js";
import {
  KIND_LABEL,
  MATRIX_COLUMN_GROUPS,
  MATRIX_ROW_GROUPS,
  amountFromDrag,
  cellId,
  defaultAmount,
  describePatch,
  findPatch,
  formatAmount,
  inLabel,
  inName,
  kindOf,
  outLabel,
  readPatches,
  snapAmount,
  wouldBeFeedback,
} from "../patchMatrixView.js";

const CELL_DEFAULTS = new Map(MATRIX_CELL_PARAMS.map((p) => [p.id, p.default]));
const cellDefault = (id) => CELL_DEFAULTS.get(id) ?? 0;
const OUTS = MATRIX_COLUMN_GROUPS.flatMap((g) => g.outs);

// The Matrix synth's patch bay as a matrix: outs run across the top, ins down the side, one cell per cable. A
// click on an empty cell patches it, dragging a patched cell sideways sets its mix, Delete removes it. A cell's
// colour is its kind: audio (cyan), control (amber), feedback (crimson); empty cells that would close a loop
// are marked before they are made. A small editor beside the grid adjusts the selected cable. The ordinary
// voice is just the default cables, so the audio path can be removed or redirected like any other cable.
// `values` is the instrument's flat control values (instrumentParams); a cell it has not stored is its default.
export default function PatchMatrixEditor({ values, onSetParam, automatedParams = [], lfoCountFor = () => 0 }) {
  const [sel, setSel] = useState(null); // { out, input }
  const [focus, setFocus] = useState(null); // { side: "out" | "in", index }
  const [hover, setHover] = useState(null);
  const dragged = useRef(false);
  // The store mutates `values` in place, so its identity cannot key a memo: derive the cables each render.
  const patches = readPatches(values, cellDefault);

  const amountOf = (c) => findPatch(patches, c.out, c.input)?.amount ?? 0;
  const setAmount = (c, v) => onSetParam(cellId(c.out, c.input), snapAmount(v));

  const onCellPointerDown = (e, c) => {
    const a0 = amountOf(c);
    if (e.button !== 0 || a0 === 0) return;
    const x0 = e.clientX;
    const width = e.currentTarget.getBoundingClientRect().width;
    dragged.current = false;
    const move = (ev) => {
      if (!dragged.current && Math.abs(ev.clientX - x0) < 4) return;
      dragged.current = true;
      setSel(c);
      onSetParam(cellId(c.out, c.input), amountFromDrag(a0, ev.clientX - x0, width));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onCellClick = (c) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (amountOf(c) === 0) onSetParam(cellId(c.out, c.input), defaultAmount(c.input));
    setSel(c);
  };

  const onGridKeyDown = (e) => {
    if (!sel) return;
    const a = amountOf(sel);
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setAmount(sel, 0);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setAmount(sel, a + (e.shiftKey ? 0.01 : 0.05));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setAmount(sel, a - (e.shiftKey ? 0.01 : 0.05));
    } else if (e.key === "Escape") {
      setSel(null);
    }
  };

  const toggleFocus = (f) => setFocus((cur) => (cur && cur.side === f.side && cur.index === f.index ? null : f));

  const statusFor = (c) => {
    const a = amountOf(c);
    const d = describePatch(c.out, c.input, a || defaultAmount(c.input), patches);
    return a !== 0
      ? `${d.title}  ${formatAmount(a)}  · ${d.name}${d.kind === "feedback" ? "  · feedback" : ""}`
      : `Patch ${d.title}  · ${d.name}${d.kind === "feedback" ? "  · would make feedback" : ""}`;
  };

  return (
    <div className="matrix-view">
      <div className="matrix-main">
        <div className="matrix-scroll">
          <div className="matrix-grid" onKeyDown={onGridKeyDown}>
            <div className="matrix-corner">{"In ↓ / Out →"}</div>
            {MATRIX_COLUMN_GROUPS.map((g) => (
              <div key={g.label} className={`matrix-group matrix-${MATRIX_OUTS[g.outs[0]].signal}`} style={{ gridColumn: `span ${g.outs.length}` }}>
                {g.label}
              </div>
            ))}
            <div />
            {OUTS.map((out) => (
              <button
                key={out}
                type="button"
                className={`matrix-out matrix-${MATRIX_OUTS[out].signal}${focus?.side === "out" && focus.index === out ? " matrix-out--focus" : ""}`}
                onClick={() => toggleFocus({ side: "out", index: out })}
                title={`Highlight everything ${outLabel(out)} is patched into`}
              >
                {outLabel(out)}
              </button>
            ))}
            {MATRIX_ROW_GROUPS.map((group) => [
              <div key={`h-${group.label}`} className="matrix-section">
                {group.label}
              </div>,
              ...group.ins.flatMap((input) => [
                <button
                  key={`r-${input}`}
                  type="button"
                  className={`matrix-in${focus?.side === "in" && focus.index === input ? " matrix-in--focus" : ""}`}
                  onClick={() => toggleFocus({ side: "in", index: input })}
                  title={`Highlight everything patched into ${inName(input)}`}
                >
                  {inLabel(input)}
                </button>,
                ...OUTS.map((out) => {
                  const c = { out, input };
                  const a = amountOf(c);
                  const id = cellId(out, input);
                  const patched = a !== 0;
                  const kind = kindOf(out, input, a || 1, patches);
                  const selected = sel?.out === out && sel.input === input;
                  const inFocus = focus && (focus.side === "out" ? focus.index === out : focus.index === input);
                  const cls = [
                    "matrix-cell",
                    patched ? `matrix-cell--patched matrix-${kind}` : "",
                    selected ? "matrix-cell--selected" : "",
                    inFocus ? "matrix-cell--focus" : "",
                    !patched && wouldBeFeedback(out, input, patches) ? "matrix-cell--would-feedback" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const left = a >= 0 ? 50 : 50 + a * 50;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={cls}
                      aria-label={`${outLabel(out)} into ${inName(input)} ${patched ? formatAmount(a) : "not patched"}`}
                      aria-pressed={selected}
                      onPointerDown={(e) => onCellPointerDown(e, c)}
                      onClick={() => onCellClick(c)}
                      onContextMenu={(e) => {
                        if (!patched) return;
                        e.preventDefault();
                        setAmount(c, 0);
                      }}
                      onPointerEnter={() => setHover(c)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(c)}
                      onBlur={() => setHover(null)}
                    >
                      {patched ? (
                        <>
                          <span className="matrix-cell__amount">
                            {kind === "feedback" ? "↻ " : ""}
                            {formatAmount(a)}
                          </span>
                          <span className="matrix-cell__bar" style={{ left: `${left}%`, width: `${Math.abs(a) * 50}%` }} />
                        </>
                      ) : (
                        <span className="matrix-cell__dot" />
                      )}
                    </button>
                  );
                }),
              ]),
            ])}
          </div>
        </div>
        <div className="matrix-status">
          {hover ? statusFor(hover) : "Click a cell to patch an out into an in · drag a patched cell sideways to set its mix · Delete or right-click removes it"}
        </div>
      </div>

      <div className="matrix-editor">
        {sel ? (
          <ConnectionEditor
            cell={sel}
            amount={amountOf(sel)}
            patches={patches}
            automated={automatedParams.includes(cellId(sel.out, sel.input))}
            lfos={lfoCountFor(cellId(sel.out, sel.input))}
            onSetAmount={(v) => setAmount(sel, v)}
            onClose={() => setSel(null)}
          />
        ) : (
          <PatchList patches={patches} onSelect={setSel} />
        )}
      </div>
    </div>
  );
}

function ConnectionEditor({ cell, amount, patches, automated, lfos, onSetAmount, onClose }) {
  const d = describePatch(cell.out, cell.input, amount || defaultAmount(cell.input), patches);
  const patched = amount !== 0;
  return (
    <div className={`matrix-connection matrix-${d.kind}`}>
      <div className="matrix-connection__head">
        <span className="matrix-connection__title">{d.title}</span>
        <span className="matrix-connection__kind">{KIND_LABEL[d.kind]}</span>
        <button type="button" className="fx-panel__target-btn" onClick={onClose} title="Back to the list of cables">
          DONE
        </button>
      </div>
      <label className="fx-module__field">
        <span className="fx-module__field-label" title="Mix">
          Mix
          <ModBadge automated={automated} lfos={lfos} />
        </span>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={Math.round(amount * 100)}
          onChange={(e) => onSetAmount(Number(e.target.value) / 100)}
          aria-label={`Mix of ${d.title}`}
        />
        <span className="fx-module__value">{patched ? formatAmount(amount) : "off"}</span>
      </label>
      <div className="fx-panel__target matrix-connection__actions">
        <button type="button" className="fx-panel__target-btn" disabled={!patched} onClick={() => onSetAmount(-amount)} title="Flip the sign: the signal then acts the other way">
          INVERT
        </button>
        <button type="button" className="fx-panel__target-btn matrix-connection__remove" disabled={!patched} onClick={() => onSetAmount(0)} title="Remove the cable (a mix of 0 is no cable)">
          REMOVE
        </button>
      </div>
      <div className="matrix-note">{patched ? d.readout : `Not patched. Set a mix above, or click the cell again to start at ${formatAmount(defaultAmount(cell.input))}.`}</div>
      <div className="matrix-sound">
        <span className="matrix-sound__name">{d.name}</span>
        <span className="matrix-sound__text">{d.text}</span>
      </div>
      {d.path ? (
        <div className="matrix-path" aria-label="Signal path">
          {d.path.map((step, i) => (
            <span key={i} className="matrix-path__step">
              {i > 0 && <span className="matrix-path__arrow">{"→"}</span>}
              <span className={i < 2 ? "matrix-path__patch" : ""}>{step}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="matrix-note">Goes nowhere you can hear: nothing connects {inName(cell.input)}&apos;s module to the output.</div>
      )}
      {d.loop && <div className="matrix-loop">Loop: {d.loop.join(" → ")}. It closes with one sample of delay and is limited, so it cannot run away.</div>}
    </div>
  );
}

function PatchList({ patches, onSelect }) {
  const order = { feedback: 0, audio: 1, control: 2 };
  const rows = useMemo(
    () => patches.map((p) => ({ p, kind: kindOf(p.out, p.input, p.amount, patches) })).sort((a, b) => order[a.kind] - order[b.kind]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(patches)],
  );
  return (
    <div className="matrix-connection">
      <div className="matrix-connection__head">
        <span className="matrix-connection__title">CABLES</span>
        <span className="matrix-connection__kind">{patches.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="matrix-note">Nothing is patched, so the voice is silent. Click a cell to connect an out to an in.</div>
      ) : (
        <div className="matrix-patch-list">
          {rows.map(({ p, kind }) => (
            <button key={`${p.out}-${p.input}`} type="button" className={`matrix-patch-row matrix-${kind}`} onClick={() => onSelect({ out: p.out, input: p.input })}>
              <span className="matrix-patch-row__kind">{kind === "feedback" ? "↻ FB" : kind === "audio" ? "AUD" : "MOD"}</span>
              <span className="matrix-patch-row__name">
                {MATRIX_OUTS[p.out].name} {"→"} {MATRIX_INS[p.input].name}
              </span>
              <span className="matrix-patch-row__amount">{formatAmount(p.amount)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="matrix-note">Select a cable to adjust its mix. Outs run across the top, ins down the side.</div>
    </div>
  );
}
