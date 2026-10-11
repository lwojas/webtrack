// A single dedicated playhead layer, moved via `transform` inside an rAF loop that only
// writes when the row actually changed — never one DOM node per row, never touching grid row
// DOM (ECS-156 plan §4). Geometry is read from the real rendered row elements (getRowElement)
// rather than a duplicated row-height constant, so CSS stays the single source of truth.
export function createPlayheadLayer({ getRowElement, getRow, onFrame }) {
  let el = null;
  let rafId = null;
  let lastRow = -1;
  let lastFrameTime = 0;

  function paint(row) {
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
    const row = getRow();
    if (row !== lastRow) {
      lastRow = row;
      paint(row);
    }
    // Frame-cadence reporting rides this same rAF loop (not a second one started only while a
    // debug panel happens to be open) — see debug/renderStats.js / ui/debug/PerfPanel.jsx.
    if (onFrame && lastFrameTime) onFrame(frameTime - lastFrameTime);
    lastFrameTime = frameTime;
    rafId = requestAnimationFrame(loop);
  }

  function mount(containerEl) {
    el = document.createElement("div");
    el.className = "tracker-playhead";
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.right = "0";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
    containerEl.appendChild(el);
    lastRow = -1;
    lastFrameTime = 0;
    rafId = requestAnimationFrame(loop);
  }

  function unmount() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    el?.remove();
    el = null;
  }

  return { mount, unmount };
}
