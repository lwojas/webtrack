import { useEffect, useRef, useState } from "react";

// F3-toggled dev panel (ECS-156 plan §4/§10). The underlying numbers (debug/renderStats.js)
// are fed continuously by the grid's own rAF loop regardless of whether this panel is open
// (see ui/grid/playheadLayer.js's onFrame); this component only needs a low-frequency
// "refresh what's on screen" loop. That refresh writes through DOM refs, not React state, so
// a human-readable stats readout doesn't itself need a 60fps React re-render — a few updates
// per second is plenty for something meant to be read, not animated.
const DISPLAY_REFRESH_MS = 200;

export default function PerfPanel({ renderStats, playbackController }) {
  const [visible, setVisible] = useState(false);
  const cellPatchRef = useRef(null);
  const nodeCountRef = useRef(null);
  const frameTimeRef = useRef(null);
  const playheadRef = useRef(null);
  const playingRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "F3") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!visible) return;

    function refresh() {
      const stats = renderStats.getStats();
      if (cellPatchRef.current) cellPatchRef.current.textContent = String(stats.cellPatchCount);
      if (nodeCountRef.current) nodeCountRef.current.textContent = String(stats.nodeCount);
      if (frameTimeRef.current) frameTimeRef.current.textContent = `${stats.avgFrameTime.toFixed(2)} ms`;
      if (playheadRef.current) playheadRef.current.textContent = String(playbackController.getPlayheadRow());
      if (playingRef.current) playingRef.current.textContent = playbackController.isPlaying() ? "yes" : "no";
    }

    refresh();
    const intervalId = setInterval(refresh, DISPLAY_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [visible, renderStats, playbackController]);

  if (!visible) return null;

  return (
    <div className="perf-panel">
      <div className="perf-panel__header">PERF (F3 to close)</div>
      <div className="perf-panel__row">
        <span>cell patches</span>
        <span ref={cellPatchRef}>0</span>
      </div>
      <div className="perf-panel__row">
        <span>grid DOM nodes</span>
        <span ref={nodeCountRef}>0</span>
      </div>
      <div className="perf-panel__row">
        <span>avg frame time</span>
        <span ref={frameTimeRef}>0.00 ms</span>
      </div>
      <div className="perf-panel__row">
        <span>playhead row</span>
        <span ref={playheadRef}>-1</span>
      </div>
      <div className="perf-panel__row">
        <span>playing</span>
        <span ref={playingRef}>no</span>
      </div>
    </div>
  );
}
