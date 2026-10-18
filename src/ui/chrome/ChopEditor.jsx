import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { loadPeaks } from "../../audio/peaks.js";
import { addCue, evenCues, MAX_NOTE, MAX_SLICES, moveCue, noteForSlice, removeCue } from "../../model/chop.js";
import { noteNumberToName, toHex } from "../../model/notes.js";

const EVEN_SPLITS = [2, 4, 8, 16, 32];
const NUDGE = 0.005;

// Waveform + draggable cue points for the selected instrument, shown under the tracker grid in
// the same flex column (so it crops the grid rather than overlaying it — see App.jsx). Renders
// nothing unless opened from the instrument panel's EDIT CHOPS and the selected instrument is a
// chop-mode sample. Perf: React-only, never touches the grid/playhead modules; the canvas draws
// on peaks/resize only (no rAF loop), and a cue drag keeps a local draft and commits once on
// release so the store/engine see one update, not one per pointermove.
//
// Slices are numbered to match the notes that play them: the instrument's root note plays slice 1,
// the next semitone slice 2, and so on (audio/compile.js).
export default function ChopEditor({ store, instrumentController }) {
  const open = useStore(store, events.CHOP_EDITOR_CHANGED, (s) => s.chopEditorOpen);
  const index = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex);
  const active = useStore(
    store,
    events.INSTRUMENTS_CHANGED,
    (s) => s.instruments[index]?.sampleMode === "chop" && s.instruments[index]?.sampleId != null,
  );
  if (!open || !active) return null;
  return <ChopEditorBody key={index} store={store} instrumentController={instrumentController} index={index} />;
}

function ChopEditorBody({ store, instrumentController, index }) {
  const name = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.name ?? "");
  const rootNote = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.rootNote ?? 60);
  // The cue array is replaced (never mutated) by setInstrumentCues, so its identity is a safe
  // snapshot for useSyncExternalStore.
  const cues = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.cues ?? NO_CUES);
  const buffer = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleAsset?.buffer ?? null);
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(null);
  const [peaks, setPeaks] = useState(undefined); // undefined = loading, null = unavailable
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const shown = draft ?? cues;

  useEffect(() => {
    let live = true;
    setPeaks(undefined);
    loadPeaks(buffer).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [buffer]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx || !peaks) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = getComputedStyle(wrap).getPropertyValue("--cyan").trim() || "currentColor";
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length))];
      const half = Math.max(0.5, p * mid);
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
  }, [peaks]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const setCues = (next) => instrumentController.setCues(index, next);
  const fractionAt = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onCuePointerDown = (i) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { index: i, moved: false };
    setSelected(i);
  };
  const onCuePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    setDraft(moveCue(draft ?? cues, drag.index, fractionAt(e.clientX)));
  };
  const onCuePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved && draft) setCues(draft);
    setDraft(null);
  };
  const onCueKeyDown = (i) => (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setCues(moveCue(cues, i, cues[i] + (e.key === "ArrowLeft" ? -NUDGE : NUDGE)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setCues(removeCue(cues, i));
      setSelected(null);
    }
  };
  const onWaveformPointerDown = (e) => {
    const next = addCue(cues, fractionAt(e.clientX));
    if (next.length === cues.length) return;
    setCues(next);
    setSelected(next.findIndex((c) => !cues.includes(c)));
  };

  const bounds = [0, ...shown, 1];
  const atMax = shown.length + 1 >= MAX_SLICES;
  const canRemove = selected !== null && selected < cues.length;

  return (
    <div className="chop-editor">
      <div className="chop-editor__bar">
        <span className="chop-editor__title">
          CHOPS — {toHex(index)} {name}
        </span>
        <span className="chop-editor__label">SLICES</span>
        {EVEN_SPLITS.map((n) => (
          <button
            key={n}
            type="button"
            className={`fx-panel__target-btn${cues.length + 1 === n ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => setCues(evenCues(n))}
            title={`Split evenly into ${n} slices`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="fx-panel__target-btn"
          disabled={!canRemove}
          onClick={() => {
            setCues(removeCue(cues, selected));
            setSelected(null);
          }}
        >
          REMOVE CUE
        </button>
        <button type="button" className="fx-panel__target-btn" disabled={cues.length === 0} onClick={() => setCues([])}>
          CLEAR
        </button>
        <span className="chop-editor__label">ROOT</span>
        <button type="button" className="fx-panel__target-btn" disabled={rootNote <= 0} onClick={() => instrumentController.setRootNote(index, rootNote - 12)} title="Root down an octave">
          -12
        </button>
        <button type="button" className="fx-panel__target-btn" disabled={rootNote <= 0} onClick={() => instrumentController.setRootNote(index, rootNote - 1)} title="Root down a semitone">
          -
        </button>
        <span className="chop-editor__root" title="The note that plays slice 1">
          {noteNumberToName(rootNote)}
        </span>
        <button type="button" className="fx-panel__target-btn" disabled={rootNote >= MAX_NOTE} onClick={() => instrumentController.setRootNote(index, rootNote + 1)} title="Root up a semitone">
          +
        </button>
        <button type="button" className="fx-panel__target-btn" disabled={rootNote >= MAX_NOTE} onClick={() => instrumentController.setRootNote(index, rootNote + 12)} title="Root up an octave">
          +12
        </button>
        <button type="button" className="fx-panel__target-btn chop-editor__close" onClick={() => instrumentController.setChopEditorOpen(false)}>
          CLOSE
        </button>
      </div>
      <div ref={wrapRef} className="chop-editor__wave" onPointerDown={atMax ? undefined : onWaveformPointerDown}>
        <canvas ref={canvasRef} />
        {peaks === null && <span className="chop-editor__empty">Waveform unavailable</span>}
        {bounds.slice(0, -1).map((from, i) => (
          <span key={i} className="chop-editor__slice" style={{ left: `${from * 100}%`, width: `${(bounds[i + 1] - from) * 100}%` }}>
            {i + 1}
            {noteForSlice(rootNote, i) !== null && ` ${noteNumberToName(noteForSlice(rootNote, i))}`}
          </span>
        ))}
        {shown.map((cue, i) => (
          <div
            key={i}
            className={`chop-editor__cue${selected === i ? " chop-editor__cue--selected" : ""}`}
            style={{ left: `${cue * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label={`Cue point ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(cue * 100)}
            onPointerDown={onCuePointerDown(i)}
            onPointerMove={onCuePointerMove}
            onPointerUp={onCuePointerUp}
            onPointerCancel={onCuePointerUp}
            onKeyDown={onCueKeyDown(i)}
            onFocus={() => setSelected(i)}
          />
        ))}
      </div>
      <div className="chop-editor__pads" role="group" aria-label="Slices and the notes that play them">
        {bounds.slice(0, -1).map((_, i) => {
          const note = noteForSlice(rootNote, i);
          return (
            <button
              key={i}
              type="button"
              className={`fx-panel__target-btn chop-editor__pad${note === null ? " chop-editor__pad--unmapped" : ""}`}
              onPointerDown={() => instrumentController.auditionSlice(index, i)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && instrumentController.auditionSlice(index, i)}
              title={note === null ? `Slice ${i + 1} is beyond the note range` : `Slice ${i + 1} — played by ${noteNumberToName(note)}; tap to audition`}
            >
              <span className="chop-editor__pad-slice">{i + 1}</span>
              <span className="chop-editor__pad-note">{note === null ? "--" : noteNumberToName(note)}</span>
            </button>
          );
        })}
      </div>
      <div className="chop-editor__hint">
        {cues.length === 0
          ? "Tap the waveform to add cue points, or pick an even split."
          : `${cues.length + 1} slices. A cell's note picks the slice: the root note (${noteNumberToName(rootNote)}) plays slice 1, each semitone up the next. Tap a pad to audition it.`}
      </div>
    </div>
  );
}

const NO_CUES = [];
