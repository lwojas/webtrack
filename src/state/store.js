import {
  selectPattern as selectPatternModel,
  setEventField,
  setTrackChannelMuted as setTrackChannelMutedModel,
  setTrackChannelSolo as setTrackChannelSoloModel,
  setTrackChannelVolume as setTrackChannelVolumeModel,
  setTrackChannelVoiceMode as setTrackChannelVoiceModeModel,
  setTrackChannelMaxVoices as setTrackChannelMaxVoicesModel,
  setTrackFxParam as setTrackFxParamModel,
  setMasterFxParam as setMasterFxParamModel,
  setCellFxParam as setCellFxParamModel,
  addTrackFx as addTrackFxModel,
  removeTrackFx as removeTrackFxModel,
  setTrackFxBypass as setTrackFxBypassModel,
  addMasterFx as addMasterFxModel,
  removeMasterFx as removeMasterFxModel,
  setMasterFxBypass as setMasterFxBypassModel,
  setPatternRowCount,
  setTrackLength as setTrackLengthModel,
  setSongName,
  addPattern as addPatternModel,
  appendPatternToQueue as appendPatternToQueueModel,
  removeFromPatternQueue as removeFromPatternQueueModel,
  duplicatePattern as duplicatePatternModel,
  deletePattern as deletePatternModel,
  renamePattern as renamePatternModel,
} from "../model/mutations.js";
import { createInstrumentSlot } from "../model/instrument.js";
import { rowCountForBars } from "../model/timing.js";
import { getSelectedPattern } from "../model/query.js";
import { clearRect, captureBlock, tileBlockIntoRect } from "../model/selectionOps.js";
import * as events from "./events.js";

// The order cursor.field cycles through on ArrowLeft/ArrowRight within a track, before
// wrapping to the neighboring track (ECS-156 plan §8). Effect command/param aren't part of
// this MVP's keyboard cursor flow — see src/input/editController.js's doc comment.
const CURSOR_FIELDS = ["note", "instrument", "velocity"];

function createEmitter() {
  const listeners = new Map(); // eventName -> Set<fn>
  return {
    on(eventName, fn) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(fn);
      return () => listeners.get(eventName)?.delete(fn);
    },
    emit(eventName, payload) {
      listeners.get(eventName)?.forEach((fn) => fn(payload));
    },
  };
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

// A small pub/sub over Song + UI state. Vanilla UI modules call subscribe(EVENT, fn)
// directly; React chrome reads the same store via state/useStore.js's useSyncExternalStore
// wrapper — one source of truth, not two parallel state systems (ECS-156 plan §4).
export function createStore({ song, instruments }) {
  const emitter = createEmitter();

  const state = {
    song,
    instruments,
    cursor: { trackIndex: 0, rowIndex: 0, field: "note" },
    // The opposite corner of the selection rect from the cursor (getSelectionRect() below) —
    // collapses back onto the cursor on every plain navigation/click, so an unextended
    // selection is always the same 1x1 cell the cursor already pointed at (see moveCursor/
    // selectCell's own doc comments).
    selectionAnchor: { trackIndex: 0, rowIndex: 0 },
    // A copied selection block ({ width, height, block } | null — src/model/selectionOps.js),
    // read by pasteSelection/fillSelection. Session-only, like cursor/editMode — never
    // persisted (src/persistence/projectFile.js has no reason to round-trip a clipboard).
    clipboard: null,
    // MVP starts in edit mode so keyboard note entry works immediately — Esc toggles it.
    editMode: true,
    editStep: 1,
    octave: 4,
    selectedInstrumentIndex: 0,
    playing: false,
    patternSwitchPending: false,
  };

  function getState() {
    return state;
  }

  function subscribe(eventName, fn) {
    return emitter.on(eventName, fn);
  }

  // The pattern the tracker edits/displays — explicit project state (song.selectedPatternId),
  // not UI/session state, since it's meaningful musical state a reopened project restores.
  function selectPattern(patternId) {
    selectPatternModel(state.song, patternId);
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
  }

  // Pattern Manager actions: create a new pattern (appended to the queue and selected),
  // requeue an existing one (appended again, selection unchanged), or remove one queue slot
  // (refused if it would empty the queue — see model/mutations.js).
  function addPattern(name) {
    const pattern = addPatternModel(state.song, { name });
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    return pattern;
  }

  function appendPatternToQueue(patternId) {
    appendPatternToQueueModel(state.song, patternId);
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
  }

  function removeFromPatternQueue(queueIndex) {
    const previousSelectedId = state.song.selectedPatternId;
    removeFromPatternQueueModel(state.song, queueIndex);
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    if (state.song.selectedPatternId !== previousSelectedId) {
      emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    }
  }

  // Duplicates a pattern (new id, independent copy of its events) without touching the
  // queue — see model/mutations.js#duplicatePattern for why that's deliberate.
  function duplicatePattern(patternId) {
    const pattern = duplicatePatternModel(state.song, patternId);
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    return pattern;
  }

  // Deletes a pattern from the pool and every queue slot referencing it (refused for the last
  // remaining pattern — see model/mutations.js#deletePattern).
  function deletePattern(patternId) {
    const previousSelectedId = state.song.selectedPatternId;
    deletePatternModel(state.song, patternId);
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    if (state.song.selectedPatternId !== previousSelectedId) {
      emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    }
  }

  // Inline rename from the Pattern Manager's list — re-emits PATTERN_SELECTED too (even though
  // selection itself hasn't changed) so anything reading the selected pattern's live name, like
  // TransportBar's readout, refreshes along with the Pattern Manager's own lists.
  function renamePattern(patternId, name) {
    renamePatternModel(state.song, patternId, name);
    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
  }

  // bars: 1-8 (see model/timing.js#MAX_BARS). Resizes the selected pattern in place — no
  // playback-side handling is needed because lookaheadPlayer/compileRow already read
  // pattern.rowCount fresh every tick, even mid-playback.
  function setSequenceLength(bars) {
    const { selectedPatternId } = state.song;
    setPatternRowCount(state.song, selectedPatternId, rowCountForBars(bars));
    emitter.emit(events.PATTERN_LENGTH_CHANGED, { patternId: selectedPatternId });
  }

  // A single track's own playback loop length, within whichever pattern is currently selected
  // (model/mutations.js#setTrackLength) — no playback-side handling needed beyond this, since
  // audio/compile.js reads track.length fresh every tick via model/pattern.js#trackLocalStep,
  // same as pattern.rowCount already does.
  function setTrackLength(trackIndex, length) {
    const { selectedPatternId } = state.song;
    setTrackLengthModel(state.song, selectedPatternId, trackIndex, length);
    emitter.emit(events.TRACK_LENGTH_CHANGED, { trackIndex });
  }

  // Used by audio/playbackController.js's onTransportChange callback (wired in appContext.js).
  function setTransport(playing) {
    state.playing = playing;
    emitter.emit(events.TRANSPORT_CHANGED, { playing });
  }

  function setBpm(bpm) {
    state.song.bpm = Math.max(1, bpm);
    emitter.emit(events.TRANSPORT_CHANGED, { bpm: state.song.bpm });
  }

  function setCell(trackIndex, rowIndex, field, value) {
    const { selectedPatternId } = state.song;
    setEventField(state.song, { patternId: selectedPatternId, trackIndex, rowIndex }, field, value);
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  function normalizeRect(a, b) {
    return {
      trackStart: Math.min(a.trackIndex, b.trackIndex),
      trackEnd: Math.max(a.trackIndex, b.trackIndex),
      rowStart: Math.min(a.rowIndex, b.rowIndex),
      rowEnd: Math.max(a.rowIndex, b.rowIndex),
    };
  }

  // The current selection, as a rect of (trackIndex, rowIndex) corners — derived from the
  // cursor and its anchor rather than tracked as its own piece of state, so every existing way
  // of moving the cursor (keyboard nav, a plain click, shift+click/shift+arrow extension, mouse
  // drag) already keeps it correct with zero extra bookkeeping. Collapses to the cursor's own
  // cell whenever nothing has been shift-extended — the same single-cell "selection" copy/paste
  // and Backspace/Delete always implicitly worked on before this existed.
  function getSelectionRect() {
    return normalizeRect(state.cursor, state.selectionAnchor);
  }

  function emitCellChangedInRect(rect) {
    for (let t = rect.trackStart; t <= rect.trackEnd; t++) {
      for (let r = rect.rowStart; r <= rect.rowEnd; r++) {
        emitter.emit(events.CELL_CHANGED, { trackIndex: t, rowIndex: r });
      }
    }
  }

  // Backspace/Delete's target (src/input/editController.js) — clears every cell in the current
  // selection. A 1x1 selection (no shift-extension) clears exactly the one cell it always did,
  // so this is a strict superset of the old single-cell clearCell, not a behavior change for
  // that case.
  function clearSelection() {
    const pattern = getSelectedPattern(state.song);
    const rect = getSelectionRect();
    clearRect(pattern, rect);
    emitCellChangedInRect(rect);
  }

  // Ctrl/Cmd+C (src/input/editController.js) and the toolbar's Copy button: snapshots the
  // current selection rect into state.clipboard as an independent block of clones, so later
  // edits to the source cells can never leak into a paste/fill (model/selectionOps.js#
  // captureBlock). A 1x1 selection copies exactly the one event the old single-cell clipboard
  // did.
  function copySelection() {
    const pattern = getSelectedPattern(state.song);
    const rect = getSelectionRect();
    state.clipboard = {
      width: rect.trackEnd - rect.trackStart + 1,
      height: rect.rowEnd - rect.rowStart + 1,
      block: captureBlock(pattern, rect),
    };
    emitter.emit(events.CLIPBOARD_CHANGED, {});
  }

  // Ctrl/Cmd+V and the toolbar's Paste button: pastes the clipboard block anchored at the
  // cursor's own cell, ignoring the rest of whatever the current selection rect might be —
  // the same "paste lands where the cursor is" place single-cell paste always landed at, just
  // generalized to however big a block was last copied. Clips at the song's own track/row
  // bounds instead of wrapping or erroring on an oversized paste near an edge.
  function pasteSelection() {
    if (!state.clipboard) return;
    const { trackCount } = state.song;
    const pattern = getSelectedPattern(state.song);
    const { trackIndex, rowIndex } = state.cursor;
    const rect = {
      trackStart: trackIndex,
      trackEnd: Math.min(trackIndex + state.clipboard.width - 1, trackCount - 1),
      rowStart: rowIndex,
      rowEnd: Math.min(rowIndex + state.clipboard.height - 1, pattern.rowCount - 1),
    };
    tileBlockIntoRect(pattern, rect, state.clipboard.block);
    emitCellChangedInRect(rect);
  }

  // Repeat / Fill Right / Fill Down (ui/chrome/SelectionToolbar.jsx): tiles the clipboard's
  // block across the *current* selection rect — which the user grows past the copied block
  // first (shift+click/shift+arrow/drag), then invokes one of the three for. All three call
  // this same function: they differ only in which axis the toolbar considers them relevant
  // for, and therefore enables them for (a selection wider than one track for Fill Right, taller
  // than one row for Fill Down, either for Repeat) — never in the tiling itself
  // (model/selectionOps.js#tileBlockIntoRect). A no-op if nothing's been copied yet.
  function fillSelection() {
    if (!state.clipboard) return;
    const pattern = getSelectedPattern(state.song);
    const rect = getSelectionRect();
    tileBlockIntoRect(pattern, rect, state.clipboard.block);
    emitCellChangedInRect(rect);
  }

  // One entry in a cell's sparse FX automation map (model/event.js#fx; ui/chrome/NoteEditor.jsx
  // is the editing surface) — value === null removes that entry. Reuses CELL_CHANGED, the same
  // event every other per-cell write already emits, rather than a dedicated event (see
  // setCell/clearSelection above).
  function setCellFx(trackIndex, rowIndex, paramId, value) {
    const { selectedPatternId } = state.song;
    setCellFxParamModel(state.song, { patternId: selectedPatternId, trackIndex, rowIndex }, paramId, value);
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  // A track's FX panel/cell-automation baseline (model/trackChannel.js#fx) — called directly
  // by the FX panel (ui/chrome/FxPanel.jsx) and by appContext.js's wiring of
  // playbackController's onTrackFxChange callback, so model state stays in sync with whichever
  // of the two actually changed it. Doesn't touch the audio engine itself — that's
  // audio/fx.js#setTrackFxParam, called separately by whichever of those two call sites needs
  // the real runtime.setNodeParameter() too (appContext.js's applyTrackFxParam bundles both
  // for the FX panel's own direct use).
  function setTrackFxParam(trackIndex, paramId, value) {
    setTrackFxParamModel(state.song, trackIndex, paramId, value);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, paramId });
  }

  // The master bus's own FX baseline (model/song.js#masterFx) — the FX panel's MASTER view.
  function setMasterFxParam(paramId, value) {
    setMasterFxParamModel(state.song, paramId, value);
    emitter.emit(events.MASTER_FX_CHANGED, { paramId });
  }

  // Enable/disable/bypass one FX on a track's insert bus (model/mutations.js#addTrackFx/
  // removeTrackFx/setTrackFxBypass) — reuses TRACK_FX_CHANGED, the same event a parameter edit
  // already emits, since the FX panel's useStore selector fingerprints fxChain alongside fx
  // (ui/chrome/FxPanel.jsx) and should refresh for either kind of change.
  function addTrackFx(trackIndex, type) {
    addTrackFxModel(state.song, trackIndex, type);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, type });
  }

  function removeTrackFx(trackIndex, type) {
    removeTrackFxModel(state.song, trackIndex, type);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, type });
  }

  function setTrackFxBypass(trackIndex, type, bypassed) {
    setTrackFxBypassModel(state.song, trackIndex, type, bypassed);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, type });
  }

  // Master-bus equivalents (model/song.js#masterFxChain) — the FX panel's MASTER view.
  function addMasterFx(type) {
    addMasterFxModel(state.song, type);
    emitter.emit(events.MASTER_FX_CHANGED, { type });
  }

  function removeMasterFx(type) {
    removeMasterFxModel(state.song, type);
    emitter.emit(events.MASTER_FX_CHANGED, { type });
  }

  function setMasterFxBypass(type, bypassed) {
    setMasterFxBypassModel(state.song, type, bypassed);
    emitter.emit(events.MASTER_FX_CHANGED, { type });
  }

  function setProjectName(name) {
    setSongName(state.song, name);
    emitter.emit(events.PROJECT_NAME_CHANGED, { name });
  }

  // delta: { row } to move by rows (wraps within the pattern), or { field } to step through
  // CURSOR_FIELDS (wraps into the neighboring track at either end). One or the other per
  // call, matching how editController.js's arrow-key handlers call this. Always collapses
  // selectionAnchor onto the new cursor position — plain (non-shift) navigation always leaves
  // a 1x1 selection sitting on the cursor, same as before per-cell selection existed.
  function moveCursor(delta) {
    const { trackCount, rowCount } = state.song;
    let { trackIndex, rowIndex, field } = state.cursor;

    if (delta.row) {
      rowIndex = wrap(rowIndex + delta.row, rowCount);
    }

    if (delta.field) {
      let fieldIndex = CURSOR_FIELDS.indexOf(field) + delta.field;
      if (fieldIndex < 0) {
        fieldIndex = CURSOR_FIELDS.length - 1;
        trackIndex = wrap(trackIndex - 1, trackCount);
      } else if (fieldIndex >= CURSOR_FIELDS.length) {
        fieldIndex = 0;
        trackIndex = wrap(trackIndex + 1, trackCount);
      }
      field = CURSOR_FIELDS[fieldIndex];
    }

    state.cursor = { trackIndex, rowIndex, field };
    state.selectionAnchor = { trackIndex, rowIndex };
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  // Shift+Arrow (src/input/editController.js): grows/shrinks the selection by moving the
  // cursor one row or one track column, wrapping the same way moveCursor does — but leaves
  // selectionAnchor where it was, which is the one difference from moveCursor. Selection is a
  // (track, row) rectangle, never per-field (matching copy/paste's existing whole-event
  // granularity), so this never touches field and never cycles it the way plain ArrowLeft/Right
  // does.
  function extendSelection(delta) {
    const { trackCount, rowCount } = state.song;
    let { trackIndex, rowIndex, field } = state.cursor;
    if (delta.row) rowIndex = wrap(rowIndex + delta.row, rowCount);
    if (delta.track) trackIndex = wrap(trackIndex + delta.track, trackCount);
    state.cursor = { trackIndex, rowIndex, field };
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  // Mouse selection: sets the cursor directly to an exact (track, row, field) rather than
  // moving it by a delta — used by the grid's mousedown handler (ui/grid/gridView.js's
  // onCellMouseDown). Emits the same CURSOR_MOVED event keyboard navigation does, so every
  // existing subscriber (cursor layer, note editor) reacts without any new wiring. extend: true
  // (shift+click) keeps the existing anchor instead of collapsing onto this cell, the mouse
  // equivalent of extendSelection above.
  function selectCell(trackIndex, rowIndex, field, { extend = false } = {}) {
    state.cursor = { trackIndex, rowIndex, field };
    if (!extend) state.selectionAnchor = { trackIndex, rowIndex };
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  // Mouse drag-select: the pointer hovering a cell while the button is held (ui/grid/
  // TrackerGridHost.jsx owns the "is a drag in progress" flag; gridView.js just reports raw
  // hover). Same role as extendSelection, just driven by a hover coordinate instead of a delta
  // — leaves field and anchor untouched.
  function extendSelectionTo(trackIndex, rowIndex) {
    const { field } = state.cursor;
    state.cursor = { trackIndex, rowIndex, field };
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  // editMode/editStep/octave/selectedInstrumentIndex are editor-session state, not grid
  // content — reusing CURSOR_MOVED for their change notification (rather than inventing a
  // separate event per field) keeps state/events.js to the set of events the ECS-156 plan
  // actually specified; any subscriber that only cares about position just reads cursor off
  // the payload and ignores the rest.
  function toggleEditMode() {
    state.editMode = !state.editMode;
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  function setEditStep(step) {
    state.editStep = Math.max(0, step);
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  function setOctave(octave) {
    state.octave = octave;
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  function selectInstrument(index) {
    state.selectedInstrumentIndex = index;
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  function setTrackChannelMuted(trackIndex, muted) {
    setTrackChannelMutedModel(state.song, trackIndex, muted);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  function setTrackChannelSolo(trackIndex, solo) {
    setTrackChannelSoloModel(state.song, trackIndex, solo);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  function setTrackChannelVolume(trackIndex, volume) {
    setTrackChannelVolumeModel(state.song, trackIndex, volume);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  // Track voice-allocation policy (model/trackChannel.js's voiceMode/maxVoices, enforced by
  // audio/voiceTracker.js) — reuses TRACK_CHANNEL_CHANGED, the same event mute/solo/volume
  // already emit, since it's the same kind of per-track mixer-level setting.
  function setTrackChannelVoiceMode(trackIndex, voiceMode) {
    setTrackChannelVoiceModeModel(state.song, trackIndex, voiceMode);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  function setTrackChannelMaxVoices(trackIndex, maxVoices) {
    setTrackChannelMaxVoicesModel(state.song, trackIndex, maxVoices);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  // sampleId comes from audio/instrumentLoader.js's loadSample() result — store.js stays
  // free of any webdsp import either way (appContext.js/InstrumentPanel.jsx call the loader,
  // then hand this just the resulting id), matching the audio/↔state/ layering rule.
  function setInstrumentSample(index, sampleId, name, sampleAsset) {
    const instrument = state.instruments[index];
    if (!instrument) return;
    instrument.sampleId = sampleId;
    if (name !== undefined) instrument.name = name;
    if (sampleAsset !== undefined) instrument.sampleAsset = sampleAsset;
    emitter.emit(events.INSTRUMENTS_CHANGED, { index });
  }

  function addInstrumentSlot() {
    state.instruments.push(createInstrumentSlot({ id: state.instruments.length }));
    emitter.emit(events.INSTRUMENTS_CHANGED, { index: state.instruments.length - 1 });
  }

  // Set by appContext.js's wiring of playbackController's onPatternSwitchPending callback —
  // lets chrome show a "switch queued" indicator while a pattern change is waiting for the
  // next loop boundary (ECS-156 plan §6/§9).
  function setPatternSwitchPending(pending) {
    state.patternSwitchPending = pending;
    emitter.emit(events.PATTERN_SWITCH_PENDING, { pending });
  }

  // Wholesale project replacement (src/persistence/*, appContext.js#loadProjectFromFile).
  // Reassigns state's properties rather than the state object itself — every getter/useStore
  // closure elsewhere reads store.getState() live, so this never orphans anything (see
  // ARCHITECTURE.md's in-place-mutation gotcha, which this deliberately mirrors at the
  // top level). Re-emits the existing granular events instead of inventing a new one, so
  // every current subscriber (grid, mixer, instrument panel, transport bar, note editor,
  // pattern manager) refreshes with zero new wiring.
  function loadProject({ song, instruments, ui = {} }) {
    state.song = song;
    state.instruments = instruments;
    state.cursor = ui.cursor ?? { trackIndex: 0, rowIndex: 0, field: "note" };
    state.selectionAnchor = { trackIndex: state.cursor.trackIndex, rowIndex: state.cursor.rowIndex };
    state.clipboard = null;
    state.editMode = true;
    state.editStep = ui.editStep ?? 1;
    state.octave = ui.octave ?? 4;
    state.selectedInstrumentIndex = ui.selectedInstrumentIndex ?? 0;
    state.playing = false;
    state.patternSwitchPending = false;

    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    emitter.emit(events.TRANSPORT_CHANGED, { playing: false, bpm: state.song.bpm });
    emitter.emit(events.PROJECT_NAME_CHANGED, { name: state.song.name });
    emitter.emit(events.TRACK_CHANNEL_CHANGED, {});
    emitter.emit(events.TRACK_FX_CHANGED, {});
    emitter.emit(events.MASTER_FX_CHANGED, {});
    emitter.emit(events.INSTRUMENTS_CHANGED, {});
    emitter.emit(events.CURSOR_MOVED, state.cursor);
    emitter.emit(events.PATTERN_SWITCH_PENDING, { pending: false });
  }

  return {
    getState,
    subscribe,
    selectPattern,
    addPattern,
    appendPatternToQueue,
    removeFromPatternQueue,
    duplicatePattern,
    deletePattern,
    renamePattern,
    setTransport,
    setBpm,
    setCell,
    getSelectionRect,
    clearSelection,
    copySelection,
    pasteSelection,
    fillSelection,
    setCellFx,
    setTrackFxParam,
    setMasterFxParam,
    addTrackFx,
    removeTrackFx,
    setTrackFxBypass,
    addMasterFx,
    removeMasterFx,
    setMasterFxBypass,
    setProjectName,
    moveCursor,
    extendSelection,
    selectCell,
    extendSelectionTo,
    setSequenceLength,
    setTrackLength,
    toggleEditMode,
    setEditStep,
    setOctave,
    selectInstrument,
    setTrackChannelMuted,
    setTrackChannelSolo,
    setTrackChannelVolume,
    setTrackChannelVoiceMode,
    setTrackChannelMaxVoices,
    setInstrumentSample,
    addInstrumentSlot,
    setPatternSwitchPending,
    loadProject,
  };
}
