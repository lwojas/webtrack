// One dedicated playhead div per track column, each moved independently via `transform` inside
// a single shared rAF loop — never one DOM node per row, never touching grid row/cell DOM
// (ECS-156 plan §4). A column's left/width is measured once at mount from the real rendered
// cell geometry (getColumnRect) and never touched again: columns never move or resize, only
// which row each one highlights does (see ui/grid/TrackerGridHost.jsx's doc comment on the
// grid staying a fixed rectangle). Each div only repaints when getTrackRow(trackIndex)
// actually changes, so N independent, polymetrically-wrapping playheads cost exactly the same
// one rAF loop a single shared playhead used to.
export function createPlayheadLayer({ trackCount, getColumnRect, getRowElement, getTrackRow, onFrame }) {
  let els = [];
  let rafId = null;
  let lastRows = [];
  let lastFrameTime = 0;

  function paintTrack(trackIndex, row) {
    const el = els[trackIndex];
    if (row < 0) {
      el.style.visibility = "hidden";
      return;
    }
    const rowEl = getRowElement(row);
    if (!rowEl) return;
    el.style.visibility = "visible";
    el.style.height = `${rowEl.offsetHeight}px`;
    el.style.transform = `translateY(${rowEl.offsetTop}px)`;
  }

  function loop(frameTime) {
    for (let t = 0; t < trackCount; t++) {
      const row = getTrackRow(t);
      if (row !== lastRows[t]) {
        lastRows[t] = row;
        paintTrack(t, row);
      }
    }
    // Frame-cadence reporting rides this same rAF loop (not a second one started only while a
    // debug panel happens to be open) — see debug/renderStats.js / ui/debug/PerfPanel.jsx.
    if (onFrame && lastFrameTime) onFrame(frameTime - lastFrameTime);
    lastFrameTime = frameTime;
    rafId = requestAnimationFrame(loop);
  }

  function mount(containerEl) {
    els = Array.from({ length: trackCount }, (_, trackIndex) => {
      const el = document.createElement("div");
      el.className = "tracker-playhead";
      el.style.position = "absolute";
      el.style.top = "0";
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
      const rect = getColumnRect(trackIndex);
      if (rect) {
        el.style.left = `${rect.left}px`;
        el.style.width = `${rect.width}px`;
      }
      containerEl.appendChild(el);
      return el;
    });
    lastRows = new Array(trackCount).fill(-1);
    lastFrameTime = 0;
    rafId = requestAnimationFrame(loop);
  }

  function unmount() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    els.forEach((el) => el.remove());
    els = [];
    lastRows = [];
  }

  return { mount, unmount };
}
