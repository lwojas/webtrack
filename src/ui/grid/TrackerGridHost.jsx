import { useEffect, useRef } from "react";
import { createGridView } from "./gridView.js";
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

    function patchOneCell({ trackIndex, rowIndex }) {
      const state = store.getState();
      const pattern = getSelectedPattern(state.song);
      gridView.patchCell(trackIndex, rowIndex, pattern.tracks[trackIndex].events[rowIndex]);
    }

    function updateCursor() {
      const { trackIndex, rowIndex, field } = store.getState().cursor;
      cursorLayer.setPosition(gridView.getCellElement(trackIndex, rowIndex));

      activeFieldEl?.classList.remove("tracker-field--active");
      activeFieldEl = gridView.getFieldElement(trackIndex, rowIndex, field);
      activeFieldEl?.classList.add("tracker-field--active");
    }

    function handleCellClick(trackIndex, rowIndex, field) {
      store.selectCell(trackIndex, rowIndex, field);
    }

    function teardownGrid() {
      detachMutationCrossCheck();
      cursorLayer?.unmount();
      playheadLayer?.unmount();
      gridView?.unmount();
      activeFieldEl = null;
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
        onCellClick: handleCellClick,
        onLengthChange: handleLengthChange,
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

    const unsubscribers = [
      store.subscribe(events.CELL_CHANGED, patchOneCell),
      store.subscribe(events.PATTERN_SELECTED, handlePossibleResize),
      store.subscribe(events.PATTERN_LENGTH_CHANGED, handlePossibleResize),
      store.subscribe(events.TRACK_LENGTH_CHANGED, patchHeaderLength),
      store.subscribe(events.CURSOR_MOVED, updateCursor),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      teardownGrid();
    };
  }, [store, playbackController, renderStats]);

  return <div className="tracker-grid-host" ref={containerRef} />;
}
