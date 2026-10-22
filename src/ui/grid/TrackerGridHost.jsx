import { useEffect, useRef } from "react";
import { createGridView } from "./gridView.js";
import { scaleOf } from "../../model/scale.js";
import { createPlayheadLayer } from "./playheadLayer.js";
import { createCursorLayer } from "./cursorLayer.js";
import { attachMutationCrossCheck } from "../../debug/renderStats.js";
import { getSelectedPattern } from "../../model/query.js";
import * as events from "../../state/events.js";

// The React/vanilla-DOM boundary (ECS-156 plan §3/§4): renders one container div with a ref,
// then in an effect with an empty dependency array mounts the vanilla grid/playhead/cursor
// modules into it. React never re-renders into this container again — all grid cells, the
// playhead, and the cursor are owned entirely by those modules, driven by the store's
// pub/sub, not by React props/state.
//
// The grid itself can still be torn down and rebuilt from inside this same effect: a pattern
// switch or sequence-length change can land on a pattern whose trackCount/rowCount doesn't
// match what's currently mounted (see model/mutations.js's setPatternRowCount) —
// handlePossibleResize() below detects that and rebuilds, rather than trying to resize the
// existing DOM in place.
export default function TrackerGridHost({ store, playbackController, renderStats }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let gridView = null;
    let playheadLayer = null;
    let cursorLayer = null;
    let detachMutationCrossCheck = () => {};
    let mountedTrackCount = null;
    let mountedRowCount = null;
    let activeFieldEl = null;
    // Mouse drag-select state: set on mousedown over a cell, cleared on mouseup anywhere (the
    // button can be released outside the grid entirely) — gridView.js only reports raw hover,
    // this effect decides whether a hover during one actually extends the selection.
    let isDragging = false;
    // Cells currently carrying the selection highlight class, so each CURSOR_MOVED only
    // toggles the cells whose selected-state actually changed instead of rescanning/repainting
    // the whole grid (same "patch, don't rebuild" approach as gridView.js#patchCell).
    let highlightedCells = [];

    function repaintActivePattern() {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      gridView.repaintPattern(pattern);
      pattern.tracks.forEach((track, trackIndex) => gridView.setHeaderLength(trackIndex, track.length, pattern.rowCount));
    }

    function patchHeaderLength({ trackIndex }) {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      gridView.setHeaderLength(trackIndex, pattern.tracks[trackIndex].length, pattern.rowCount);
    }

    function handleLengthChange(trackIndex, value) {
      store.setTrackLength(trackIndex, value);
    }

    // trackChannels (and their voiceMode/maxVoices) are song-level, not per-pattern — unlike
    // LEN's track.length, a pattern switch never changes them, so this only needs to run once
    // at mount and again on TRACK_CHANNEL_CHANGED, not on every handlePossibleResize.
    function syncVoiceHeaders() {
      const state = store.getState();
      state.song.trackChannels.forEach((channel, trackIndex) => gridView.setHeaderVoiceSettings(trackIndex, channel));
    }

    function handleVoiceModeChange(trackIndex, voiceMode) {
      store.setTrackChannelVoiceMode(trackIndex, voiceMode);
    }

    function handleChokeGroupChange(trackIndex, chokeGroup) {
      store.setTrackChannelChokeGroup(trackIndex, chokeGroup);
    }

    function handleMaxVoicesChange(trackIndex, maxVoices) {
      store.setTrackChannelMaxVoices(trackIndex, maxVoices);
    }

    function patchOneCell({ trackIndex, rowIndex }) {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      gridView.patchCell(trackIndex, rowIndex, pattern.tracks[trackIndex].events[rowIndex]);
    }

    // Highlights every cell inside the current selection rect (state/store.js#getSelectionRect)
    // with .tracker-cell--selected, diffed against whatever was highlighted last time rather
    // than cleared-and-reapplied wholesale, so a selection that's just 1 cell (the overwhelming
    // common case — no shift-extension in play) touches exactly one element's classList, not
    // every cell in the grid.
    function updateSelectionHighlight() {
      const rect = store.getSelectionRect();
      const nextCells = [];
      for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
        for (let r = rect.rowStart; r <= rect.rowEnd; r++) {
          nextCells.push({ t, r, el: gridView.getCellElement(t, r) });
        }
      }
      const nextKeys = new Set(nextCells.map(({ t, r }) => `${t}.${r}`));
      highlightedCells.forEach(({ t, r, el }) => {
        if (!nextKeys.has(`${t}.${r}`)) el?.classList.remove("tracker-cell--selected");
      });
      const prevKeys = new Set(highlightedCells.map(({ t, r }) => `${t}.${r}`));
      nextCells.forEach(({ t, r, el }) => {
        if (!prevKeys.has(`${t}.${r}`)) el?.classList.add("tracker-cell--selected");
      });
      highlightedCells = nextCells;
    }

    function updateCursor() {
      const { trackIndex, rowIndex, field } = store.getState().cursor;
      cursorLayer.setPosition(gridView.getCellElement(trackIndex, rowIndex));

      activeFieldEl?.classList.remove("tracker-field--active");
      activeFieldEl = gridView.getFieldElement(trackIndex, rowIndex, field);
      activeFieldEl?.classList.add("tracker-field--active");

      updateSelectionHighlight();
    }

    // mousedown starts (or restarts) a selection and begins a drag; mouseover while dragging
    // extends it to whatever cell the pointer is currently over (store.js#extendSelectionTo).
    // The drag ends on mouseup anywhere in the window, not just over the grid — the button can
    // be released after the pointer's left the grid entirely.
    function handleCellMouseDown(trackIndex, rowIndex, field, shiftKey) {
      isDragging = true;
      store.selectCell(trackIndex, rowIndex, field, { extend: shiftKey });
    }

    function handleCellMouseEnter(trackIndex, rowIndex) {
      if (!isDragging) return;
      store.extendSelectionTo(trackIndex, rowIndex);
    }

    function handleWindowMouseUp() {
      isDragging = false;
    }

    function teardownGrid() {
      detachMutationCrossCheck();
      cursorLayer?.unmount();
      playheadLayer?.unmount();
      gridView?.unmount();
      activeFieldEl = null;
      highlightedCells = [];
    }

    function buildGrid() {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      const { trackCount } = state.song;
      mountedTrackCount = trackCount;
      mountedRowCount = pattern.rowCount;

      gridView = createGridView({
        trackCount,
        rowCount: pattern.rowCount,
        onCellPatched: renderStats?.recordCellPatch,
        onCellMouseDown: handleCellMouseDown,
        onCellMouseEnter: handleCellMouseEnter,
        onLengthChange: handleLengthChange,
        onVoiceModeChange: handleVoiceModeChange,
        onChokeGroupChange: handleChokeGroupChange,
        onMaxVoicesChange: handleMaxVoicesChange,
        getScale: () => scaleOf(store.getState().song),
      });
      gridView.mount(containerRef.current);
      renderStats?.setNodeCount(gridView.getNodeCount());
      detachMutationCrossCheck = renderStats
        ? attachMutationCrossCheck(gridView.getContainerElement(), renderStats)
        : () => {};

      playheadLayer = createPlayheadLayer({
        trackCount,
        getColumnRect: gridView.getColumnRect,
        getRowElement: gridView.getRowElement,
        getTrackRow: (trackIndex) => playbackController.getTrackPlayheadRow(trackIndex),
        onFrame: renderStats?.recordFrameTime,
      });
      playheadLayer.mount(gridView.getContainerElement());

      cursorLayer = createCursorLayer();
      cursorLayer.mount(gridView.getContainerElement());

      repaintActivePattern();
      syncVoiceHeaders();
      updateCursor();
    }

    function handlePossibleResize() {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      if (state.song.trackCount !== mountedTrackCount || pattern.rowCount !== mountedRowCount) {
        teardownGrid();
        buildGrid();
      } else {
        repaintActivePattern();
      }
    }

    buildGrid();
    window.addEventListener("mouseup", handleWindowMouseUp);

    const unsubscribers = [
      store.subscribe(events.CELL_CHANGED, patchOneCell),
      store.subscribe(events.PATTERN_SELECTED, handlePossibleResize),
      store.subscribe(events.PATTERN_LENGTH_CHANGED, handlePossibleResize),
      store.subscribe(events.TRACK_LENGTH_CHANGED, patchHeaderLength),
      store.subscribe(events.TRACK_CHANNEL_CHANGED, syncVoiceHeaders),
      store.subscribe(events.SCALE_CHANGED, repaintActivePattern),
      store.subscribe(events.CURSOR_MOVED, updateCursor),
    ];

    return () => {
      window.removeEventListener("mouseup", handleWindowMouseUp);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      teardownGrid();
    };
  }, [store, playbackController, renderStats]);

  return <div className="tracker-grid-host" ref={containerRef} />;
}
