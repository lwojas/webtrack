// Counters fed from the only two call sites that ever mutate grid content — gridView.js's
// patchCell (an single-cell edit, or one call of many inside a bank/pattern repaint) — so
// "what causes DOM mutations" is exact, not estimated (ECS-156 plan §4/§10). Frame timing is
// fed from playheadLayer.js's own rAF loop, which runs whenever the grid is mounted, not only
// while a debug panel happens to be open.
const MAX_FRAME_SAMPLES = 60;

export function createRenderStats() {
  let cellPatchCount = 0;
  let nodeCount = 0;
  let frameTimes = [];

  function recordCellPatch() {
    cellPatchCount += 1;
  }

  function recordFrameTime(ms) {
    frameTimes.push(ms);
    if (frameTimes.length > MAX_FRAME_SAMPLES) frameTimes.shift();
  }

  // Computed once at grid build time and cached — a fixed-size grid never needs this
  // recomputed during normal operation.
  function setNodeCount(count) {
    nodeCount = count;
  }

  function getStats() {
    const avgFrameTime = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
    return { cellPatchCount, nodeCount, avgFrameTime };
  }

  function reset() {
    cellPatchCount = 0;
  }

  return { recordCellPatch, recordFrameTime, setNodeCount, getStats, reset };
}

// playheadLayer.js/cursorLayer.js each mount one leaf div (.tracker-playhead per track,
// .tracker-cursor) directly into the same container this cross-check observes, repositioned via
// continuous style/transform attribute writes that are deliberately *not* patchCell calls (see
// each file's own doc comment — they're a separate, by-design overlay mechanism, not cell
// content). Without excluding them, leaving playback running for even a few seconds floods this
// cross-check with mutations from the playhead alone (one MutationRecord per track per row
// change, i.e. continuously while playing), permanently past the threshold and drowning out any
// real signal the check exists to catch.
const OVERLAY_LAYER_SELECTOR = ".tracker-playhead, .tracker-cursor";

function isOverlayMutation(mutation) {
  return mutation.target instanceof Element && mutation.target.matches(OVERLAY_LAYER_SELECTOR);
}

// Dev-only safety net: cross-checks real DOM mutations inside the grid container against
// renderStats' self-reported patchCell count, catching any future code path that bypasses
// patchCell (e.g. someone touching innerHTML directly). Each patchCell call writes up to 4
// characterData mutations (note/ins/vol/fx), so the observed count is compared against a
// multiple of the reported count rather than a strict 1:1 match. No-op (and not even
// constructed) outside dev builds — zero cost in production.
export function attachMutationCrossCheck(containerEl, renderStats) {
  if (!import.meta.env.DEV) return () => {};

  let observedMutations = 0;
  const observer = new MutationObserver((mutations) => {
    observedMutations += mutations.filter((mutation) => !isOverlayMutation(mutation)).length;
    const reported = renderStats.getStats().cellPatchCount;
    if (observedMutations > reported * 4 + 8) {
      console.warn(
        `[renderStats] observed ${observedMutations} DOM mutations inside the grid but only ` +
          `${reported} patchCell() calls were recorded — something may be bypassing patchCell.`,
      );
    }
  });
  observer.observe(containerEl, { childList: true, subtree: true, characterData: true, attributes: true });

  return () => observer.disconnect();
}
