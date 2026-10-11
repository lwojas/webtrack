import { formatCell } from "./rowFormatting.js";
import { rowToBarBeat } from "../../model/timing.js";
import { isEmptyEvent } from "../../model/event.js";

// Builds the 64-row × 8-track grid exactly once via createElement (ECS-156 plan §4), caching
// every cell's DOM refs in a 2D array. patchCell() is the single write path for all cell
// content — a pattern switch repaints via repaintPattern() calling patchCell() for every
// cell, never a rebuild, so there's zero node allocation/garbage after mount().
export function createGridView({ trackCount, rowCount, onCellPatched, onCellClick } = {}) {
  let container = null;
  let cellRefs = null; // cellRefs[trackIndex][rowIndex] = { cellEl, noteEl, insEl, volEl, fxEl }
  let rowEls = null; // rowEls[rowIndex]

  function buildCell(trackIndex, rowIndex) {
    const cellEl = document.createElement("div");
    cellEl.className = "tracker-cell";
    cellEl.dataset.track = String(trackIndex);
    cellEl.dataset.row = String(rowIndex);

    const noteEl = document.createElement("span");
    noteEl.className = "tracker-cell__note";
    noteEl.dataset.field = "note";
    const insEl = document.createElement("span");
    insEl.className = "tracker-cell__ins";
    insEl.dataset.field = "instrument";
    const volEl = document.createElement("span");
    volEl.className = "tracker-cell__vol";
    volEl.dataset.field = "velocity";
    const fxEl = document.createElement("span");
    fxEl.className = "tracker-cell__fx";
    fxEl.dataset.field = "fx";

    cellEl.append(noteEl, insEl, volEl, fxEl);
    return { cellEl, noteEl, insEl, volEl, fxEl };
  }

  function buildRow(rowIndex) {
    const rowEl = document.createElement("div");
    rowEl.className = "tracker-row";

    const indexEl = document.createElement("span");
    indexEl.className = "tracker-row__index";
    // Bar.beat position (model/timing.js), not a hex row number — only labeled on each
    // beat's first row (tick === 0) so the label isn't repeated 4x per beat.
    const { bar, beat, tick } = rowToBarBeat(rowIndex);
    indexEl.textContent = tick === 0 ? `${bar}.${beat}` : "";
    if (tick === 0) indexEl.classList.add("tracker-row__index--beat");
    rowEl.appendChild(indexEl);

    const refsForRow = [];
    for (let t = 0; t < trackCount; t++) {
      const refs = buildCell(t, rowIndex);
      rowEl.appendChild(refs.cellEl);
      refsForRow.push(refs);
    }

    return { rowEl, refsForRow };
  }

  // Event delegation: one listener for the whole grid rather than one per cell/field, in
  // keeping with this project's minimal-DOM/minimal-listener approach (see
  // docs/ARCHITECTURE.md's rendering-architecture section).
  function handleClick(e) {
    if (!onCellClick) return;
    const cellEl = e.target.closest(".tracker-cell");
    if (!cellEl) return;
    const trackIndex = Number(cellEl.dataset.track);
    const rowIndex = Number(cellEl.dataset.row);
    const fieldEl = e.target.closest("[data-field]");
    const field = fieldEl ? fieldEl.dataset.field : "note";
    onCellClick(trackIndex, rowIndex, field);
  }

  function mount(targetEl) {
    container = document.createElement("div");
    container.className = "tracker-grid";

    rowEls = new Array(rowCount);
    cellRefs = Array.from({ length: trackCount }, () => new Array(rowCount));

    for (let r = 0; r < rowCount; r++) {
      const { rowEl, refsForRow } = buildRow(r);
      rowEls[r] = rowEl;
      refsForRow.forEach((refs, t) => {
        cellRefs[t][r] = refs;
      });
      container.appendChild(rowEl);
    }

    container.addEventListener("click", handleClick);
    targetEl.appendChild(container);
  }

  function unmount() {
    container?.removeEventListener("click", handleClick);
    container?.remove();
    container = null;
    cellRefs = null;
    rowEls = null;
  }

  function patchCell(trackIndex, rowIndex, event) {
    const refs = cellRefs?.[trackIndex]?.[rowIndex];
    if (!refs) return;
    const formatted = formatCell(event);
    refs.noteEl.textContent = formatted.note;
    refs.insEl.textContent = formatted.instrument;
    refs.volEl.textContent = formatted.velocity;
    refs.fxEl.textContent = formatted.fx;
    refs.cellEl.classList.toggle("tracker-cell--empty", isEmptyEvent(event));
    onCellPatched?.(trackIndex, rowIndex);
  }

  function repaintPattern(pattern) {
    for (let t = 0; t < trackCount; t++) {
      for (let r = 0; r < rowCount; r++) {
        patchCell(t, r, pattern.tracks[t].events[r]);
      }
    }
  }

  function getContainerElement() {
    return container;
  }

  function getRowElement(rowIndex) {
    return rowEls?.[rowIndex];
  }

  function getCellElement(trackIndex, rowIndex) {
    return cellRefs?.[trackIndex]?.[rowIndex]?.cellEl;
  }

  const FIELD_TO_REF_KEY = { note: "noteEl", instrument: "insEl", velocity: "volEl", fx: "fxEl" };

  function getFieldElement(trackIndex, rowIndex, field) {
    const refs = cellRefs?.[trackIndex]?.[rowIndex];
    if (!refs) return null;
    return refs[FIELD_TO_REF_KEY[field]] ?? null;
  }

  function getNodeCount() {
    return container ? container.querySelectorAll("*").length : 0;
  }

  return {
    mount,
    unmount,
    patchCell,
    repaintPattern,
    getContainerElement,
    getRowElement,
    getCellElement,
    getFieldElement,
    getNodeCount,
  };
}
