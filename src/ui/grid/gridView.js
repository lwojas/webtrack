import { formatCell } from "./rowFormatting.js";
import { rowToBarBeat } from "../../model/timing.js";
import { isEmptyEvent } from "../../model/event.js";
import { VOICE_MODES, MAX_VOICES_OPTIONS } from "../../model/trackChannel.js";

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
  onVoiceModeChange,
  onMaxVoicesChange,
} = {}) {
  let container = null;
  let cellRefs = null; // cellRefs[trackIndex][rowIndex] = { cellEl, noteEl, insEl, volEl, fxEl }
  let rowEls = null; // rowEls[rowIndex]
  let headerRowEl = null;
  let headerRefs = null; // headerRefs[trackIndex] = { cellEl, lengthEl }
  let voiceHeaderRowEl = null;
  let voiceHeaderRefs = null; // voiceHeaderRefs[trackIndex] = { cellEl, modeEl, maxEl }

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

  // A track's voice-allocation policy (model/trackChannel.js's voiceMode/maxVoices) sits in its
  // own row right below LEN rather than crowded into the same one — both are per-column, "about
  // this track" controls that belong above the column they govern, same reasoning as
  // buildHeaderCell's own doc comment above, just two separate settings rather than one.
  function buildVoiceHeaderCell(trackIndex) {
    const cellEl = document.createElement("div");
    cellEl.className = "tracker-track-header__cell tracker-track-voice-header__cell";
    cellEl.dataset.track = String(trackIndex);

    const modeEl = document.createElement("select");
    modeEl.className = "tracker-track-voice-header__mode";
    modeEl.dataset.field = "voiceMode";
    VOICE_MODES.forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode === "poly" ? "Poly" : "Mono";
      modeEl.appendChild(option);
    });

    const maxEl = document.createElement("select");
    maxEl.className = "tracker-track-voice-header__max";
    maxEl.dataset.field = "maxVoices";
    MAX_VOICES_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value);
      maxEl.appendChild(option);
    });

    cellEl.append(modeEl, maxEl);
    return { cellEl, modeEl, maxEl };
  }

  function buildVoiceHeaderRow() {
    const rowEl = document.createElement("div");
    rowEl.className = "tracker-track-header tracker-track-voice-header";

    const indexEl = document.createElement("span");
    indexEl.className = "tracker-track-header__index";
    // Same 4ch-wide label column LEN uses (.tracker-track-header__index) — "VOI" rather than
    // "VOICE" so it fits without overflowing/clipping, matching LEN's own 3-letter label.
    indexEl.textContent = "VOI";
    rowEl.appendChild(indexEl);

    const refsForHeader = [];
    for (let t = 0; t < trackCount; t++) {
      const refs = buildVoiceHeaderCell(t);
      rowEl.appendChild(refs.cellEl);
      refsForHeader.push(refs);
    }

    return { rowEl, refsForHeader };
  }

  // Same delegation shape as handleHeaderInput above, but for both <select>s' "change" (not
  // "input" — a select doesn't fire that) in the voice header row.
  function handleVoiceHeaderChange(e) {
    const cellEl = e.target.closest(".tracker-track-voice-header__cell");
    if (!cellEl) return;
    const trackIndex = Number(cellEl.dataset.track);
    const field = e.target.dataset.field;
    if (field === "voiceMode") onVoiceModeChange?.(trackIndex, e.target.value);
    else if (field === "maxVoices") onMaxVoicesChange?.(trackIndex, Number(e.target.value));
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

    const { rowEl: voiceHeaderEl, refsForHeader: refsForVoiceHeader } = buildVoiceHeaderRow();
    voiceHeaderRowEl = voiceHeaderEl;
    voiceHeaderRefs = refsForVoiceHeader;
    voiceHeaderRowEl.addEventListener("change", handleVoiceHeaderChange);
    container.appendChild(voiceHeaderRowEl);

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
    voiceHeaderRefs.forEach(({ cellEl }, t) => {
      const rect = getColumnRect(t);
      if (rect) cellEl.style.width = `${rect.width}px`;
    });
  }

  function unmount() {
    container?.removeEventListener("mousedown", handleMouseDown);
    container?.removeEventListener("mouseover", handleMouseOver);
    headerRowEl?.removeEventListener("input", handleHeaderInput);
    voiceHeaderRowEl?.removeEventListener("change", handleVoiceHeaderChange);
    container?.remove();
    container = null;
    cellRefs = null;
    rowEls = null;
    headerRowEl = null;
    headerRefs = null;
    voiceHeaderRowEl = null;
    voiceHeaderRefs = null;
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

  // Refreshes one track's voice controls — called on mount and whenever that track's channel
  // changes (state/events.js#TRACK_CHANNEL_CHANGED), same as mute/solo/volume already do
  // elsewhere; this is the grid's own copy of that same trackChannel data, not a second source
  // of truth. maxEl stays disabled (not hidden) while mono — the stored value is still there,
  // just not the thing currently governing playback, matching model/trackChannel.js's doc
  // comment on why mono doesn't force maxVoices to 1 in the data itself.
  function setHeaderVoiceSettings(trackIndex, { voiceMode, maxVoices }) {
    const refs = voiceHeaderRefs?.[trackIndex];
    if (!refs) return;
    refs.modeEl.value = voiceMode;
    refs.maxEl.value = String(maxVoices);
    refs.maxEl.disabled = voiceMode === "mono";
    refs.maxEl.title =
      voiceMode === "mono"
        ? "Mono — only one voice at a time; Max voices is ignored until this track is Poly again"
        : `Max simultaneous voices on this track: ${maxVoices}`;
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
    // A step that takes part in the track's Track LFO (Event.lfo): a subtle marker on its velocity.
    refs.cellEl.classList.toggle("tracker-cell--lfo", (event.lfo ?? 0) > 0);
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
    setHeaderVoiceSettings,
    getContainerElement,
    getRowElement,
    getCellElement,
    getColumnRect,
    getFieldElement,
    getNodeCount,
  };
}
