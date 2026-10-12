import { formatCell } from "./rowFormatting.js";
import { rowToBarBeat } from "../../model/timing.js";
import { isEmptyEvent } from "../../model/event.js";

// Builds the 64-row × 8-track grid exactly once via createElement (ECS-156 plan §4), caching
// every cell's DOM refs in a 2D array. patchCell() is the single write path for all cell
// content — a pattern switch repaints via repaintPattern() calling patchCell() for every
// cell, never a rebuild, so there's zero node allocation/garbage after mount().
export function createGridView({
  trackCount,
  rowCount,
  onCellPatched,
  onCellMouseDown,
  onCellMouseEnter,
  onLengthChange,
} = {}) {
  let container = null;
  let cellRefs = null; // cellRefs[trackIndex][rowIndex] = { cellEl, noteEl, insEl, volEl, fxEl }
  let rowEls = null; // rowEls[rowIndex]
  let headerRowEl = null;
  let headerRefs = null; // headerRefs[trackIndex] = { cellEl, lengthEl }

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

  // A track's own playback length (model/pattern.js) lives above its column, inside the grid
  // itself, rather than in the mixer strip below — it's the one per-track control that's about
  // *this* position in the timeline (how far this column loops before repeating), so it reads
  // naturally sitting right over the column it governs. Sticky-positioned (see the CSS) so it
  // stays pinned to the top of the scrollable grid host while rows scroll past underneath it.
  function buildHeaderCell(trackIndex) {
    const cellEl = document.createElement("div");
    cellEl.className = "tracker-track-header__cell";
    cellEl.dataset.track = String(trackIndex);

    const lengthEl = document.createElement("input");
    lengthEl.type = "number";
    lengthEl.className = "tracker-track-header__length";
    lengthEl.min = "1";
    cellEl.appendChild(lengthEl);

    return { cellEl, lengthEl };
  }

  function buildHeaderRow() {
    const rowEl = document.createElement("div");
    rowEl.className = "tracker-track-header";

    const indexEl = document.createElement("span");
    indexEl.className = "tracker-track-header__index";
    indexEl.textContent = "LEN";
    rowEl.appendChild(indexEl);

    const refsForHeader = [];
    for (let t = 0; t < trackCount; t++) {
      const refs = buildHeaderCell(t);
      rowEl.appendChild(refs.cellEl);
      refsForHeader.push(refs);
    }

    return { rowEl, refsForHeader };
  }

  // Delegated the same way handleClick is below, on the header row alone — it never reaches
  // handleClick's own listener on the grid container, since header cells aren't `.tracker-cell`.
  function handleHeaderInput(e) {
    if (!onLengthChange) return;
    const cellEl = e.target.closest(".tracker-track-header__cell");
    if (!cellEl) return;
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    onLengthChange(Number(cellEl.dataset.track), value);
  }

  // Event delegation: one listener for the whole grid rather than one per cell/field, in
  // keeping with this project's minimal-DOM/minimal-listener approach (see
  // docs/ARCHITECTURE.md's rendering-architecture section). mousedown (not click) starts both
  // an ordinary single-cell selection and a drag-select — TrackerGridHost.jsx owns the "is a
  // drag in progress" flag and decides what mouseover does with it; this module only reports
  // raw cell coordinates, same separation as onCellPatched/onLengthChange below.
  function handleMouseDown(e) {
    if (!onCellMouseDown) return;
    const cellEl = e.target.closest(".tracker-cell");
    if (!cellEl) return;
    const trackIndex = Number(cellEl.dataset.track);
    const rowIndex = Number(cellEl.dataset.row);
    const fieldEl = e.target.closest("[data-field]");
    const field = fieldEl ? fieldEl.dataset.field : "note";
    onCellMouseDown(trackIndex, rowIndex, field, e.shiftKey);
  }

  function handleMouseOver(e) {
    if (!onCellMouseEnter) return;
    const cellEl = e.target.closest(".tracker-cell");
    if (!cellEl) return;
    onCellMouseEnter(Number(cellEl.dataset.track), Number(cellEl.dataset.row));
  }

  function mount(targetEl) {
    container = document.createElement("div");
    container.className = "tracker-grid";

    const { rowEl: headerEl, refsForHeader } = buildHeaderRow();
    headerRowEl = headerEl;
    headerRefs = refsForHeader;
    headerRowEl.addEventListener("input", handleHeaderInput);
    container.appendChild(headerRowEl);

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

    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mouseover", handleMouseOver);
    targetEl.appendChild(container);

    // Each header cell's width is measured off the real rendered data column (same "measure
    // the real DOM instead of duplicating a width constant" approach as
    // ui/grid/playheadLayer.js#getColumnRect / ui/grid/cursorLayer.js), so the LEN control
    // lines up with the column it controls regardless of the note/ins/vol/fx field widths —
    // not a layout computed independently via the header cell's own (different) content.
    headerRefs.forEach(({ cellEl }, t) => {
      const rect = getColumnRect(t);
      if (rect) cellEl.style.width = `${rect.width}px`;
    });
  }

  function unmount() {
    container?.removeEventListener("mousedown", handleMouseDown);
    container?.removeEventListener("mouseover", handleMouseOver);
    headerRowEl?.removeEventListener("input", handleHeaderInput);
    container?.remove();
    container = null;
    cellRefs = null;
    rowEls = null;
    headerRowEl = null;
    headerRefs = null;
  }

  // Refreshes one track's header input to the given pattern's data — called whenever the
  // selected pattern (or just this one track's length) changes, same patch-not-rebuild
  // approach patchCell uses for grid content.
  function setHeaderLength(trackIndex, length, maxLength) {
    const refs = headerRefs?.[trackIndex];
    if (!refs) return;
    refs.lengthEl.max = String(maxLength);
    refs.lengthEl.value = String(length);
    refs.lengthEl.title = `Playback length: ${length} steps (of ${maxLength})`;
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

  // A track column's horizontal extent, read off its own row-0 cell rather than a duplicated
  // column-width constant (same "measure the real DOM" approach getRowElement/getCellElement
  // already use) — every row's cell in a column shares the same left/width, since columns
  // never move or resize (ui/grid/TrackerGridHost.jsx's own doc comment). What the per-track
  // playhead layer uses to position each track's playhead div.
  function getColumnRect(trackIndex) {
    const cellEl = cellRefs?.[trackIndex]?.[0]?.cellEl;
    if (!cellEl) return null;
    return { left: cellEl.offsetLeft, width: cellEl.offsetWidth };
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
    setHeaderLength,
    getContainerElement,
    getRowElement,
    getCellElement,
    getColumnRect,
    getFieldElement,
    getNodeCount,
  };
}
