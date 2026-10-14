import {
  selectPattern as selectPatternModel,
  setEventField,
  setTrackChannelMuted as setTrackChannelMutedModel,
  setTrackChannelSolo as setTrackChannelSoloModel,
  setTrackChannelVolume as setTrackChannelVolumeModel,
  setTrackChannelVoiceMode as setTrackChannelVoiceModeModel,
  setTrackChannelMaxVoices as setTrackChannelMaxVoicesModel,
  setTrackChannelPan as setTrackChannelPanModel,
  setMasterPan as setMasterPanModel,
  setTrackFxParam as setTrackFxParamModel,
  setMasterFxParam as setMasterFxParamModel,
  setTrackFxInstanceParam as setTrackFxInstanceParamModel,
  setMasterFxInstanceParam as setMasterFxInstanceParamModel,
  setCellFxParam as setCellFxParamModel,
  setCellFxInstanceParam as setCellFxInstanceParamModel,
  addTrackFx as addTrackFxModel,
  removeTrackFx as removeTrackFxModel,
  setTrackFxBypass as setTrackFxBypassModel,
  moveTrackFx as moveTrackFxModel,
  addMasterFx as addMasterFxModel,
  removeMasterFx as removeMasterFxModel,
  setMasterFxBypass as setMasterFxBypassModel,
  moveMasterFx as moveMasterFxModel,
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
import { rowCountForBars, SWING_MIN, SWING_MAX } from "../model/timing.js";
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
    // audio/resampleController.js's own status, mirrored here purely for the UI (see
    // RESAMPLE_STATUS_CHANGED) — this store never arms/cancels a resample itself, it only
    // reflects whatever appContext.js#handleResample reports.
    resampleStatus: "idle",
    resampleError: null,
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

  function setSwing(swing) {
    state.song.swing = Math.min(SWING_MAX, Math.max(SWING_MIN, swing));
    emitter.emit(events.TRANSPORT_CHANGED, { swing: state.song.swing });
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

  // Push's Duplicate button (CC88, docs/MIDI.md): duplicates the current selection directly
  // below itself — the destination rect starts the row right after the selection's own last row
  // (`rowEnd`) and is the same width/height, built from the exact same captureBlock/
  // tileBlockIntoRect primitives copySelection/fillSelection already use above, not a second
  // copy/paste implementation. Deliberately never touches state.clipboard (unlike
  // copySelection) — duplicating a selection shouldn't clobber whatever's already on the
  // clipboard for a later, unrelated paste. Clips at the pattern's own row bound the same way
  // pasteSelection already does near an edge, rather than wrapping or erroring.
  function duplicateSelection() {
    const pattern = getSelectedPattern(state.song);
    const rect = getSelectionRect();
    const block = captureBlock(pattern, rect);
    const height = rect.rowEnd - rect.rowStart + 1;
    const destRect = {
      trackStart: rect.trackStart,
      trackEnd: rect.trackEnd,
      rowStart: Math.min(rect.rowEnd + 1, pattern.rowCount - 1),
      rowEnd: Math.min(rect.rowEnd + height, pattern.rowCount - 1),
    };
    tileBlockIntoRect(pattern, destRect, block);
    emitCellChangedInRect(destRect);
  }

  // One entry in a cell's sparse FX automation map for the always-on bus.gain param only
  // (model/event.js#fx's flat top-level key; ui/chrome/NoteEditor.jsx is the editing surface) —
  // value === null removes that entry. See setCellFxInstanceParam below for a chain instance's
  // own parameter. Reuses CELL_CHANGED, the same event every other per-cell write already emits,
  // rather than a dedicated event (see setCell/clearSelection above).
  function setCellFx(trackIndex, rowIndex, paramId, value) {
    const { selectedPatternId } = state.song;
    setCellFxParamModel(state.song, { patternId: selectedPatternId, trackIndex, rowIndex }, paramId, value);
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  // Stacking-aware counterpart to setCellFx above, for one specific chain instance's parameter
  // (model/event.js#fx's `instances[instanceId]` bag) — unambiguously automates e.g. the second
  // of two Filters on this track.
  function setCellFxInstanceParam(trackIndex, rowIndex, instanceId, paramId, value) {
    const { selectedPatternId } = state.song;
    setCellFxInstanceParamModel(state.song, { patternId: selectedPatternId, trackIndex, rowIndex }, instanceId, paramId, value);
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  // A track's always-on bus.gain value (model/trackChannel.js#fx's flat top-level key) — called
  // directly by the FX panel's pinned Output module (ui/chrome/FxPanel.jsx) and by appContext.js's
  // wiring of playbackController's onTrackFxChange callback, so model state stays in sync with
  // whichever of the two actually changed it. Doesn't touch the audio engine itself — that's
  // audio/fx.js#setTrackFxParam, called separately by whichever of those two call sites needs
  // the real runtime call too (appContext.js's applyTrackFxParam bundles both for the FX panel's
  // own direct use).
  function setTrackFxParam(trackIndex, paramId, value) {
    setTrackFxParamModel(state.song, trackIndex, paramId, value);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, paramId });
  }

  // The master bus's own bus.gain value (model/song.js#masterFx) — the FX panel's MASTER view.
  function setMasterFxParam(paramId, value) {
    setMasterFxParamModel(state.song, paramId, value);
    emitter.emit(events.MASTER_FX_CHANGED, { paramId });
  }

  // Stacking-aware counterpart to setTrackFxParam/setMasterFxParam above, for one chain
  // instance's own parameter (model/trackChannel.js#fx's `instances[id]` bag) — every FX_PARAMS
  // entry except bus.gain.
  function setTrackFxInstanceParam(trackIndex, instanceId, paramId, value) {
    setTrackFxInstanceParamModel(state.song, trackIndex, instanceId, paramId, value);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, instanceId, paramId });
  }

  function setMasterFxInstanceParam(instanceId, paramId, value) {
    setMasterFxInstanceParamModel(state.song, instanceId, paramId, value);
    emitter.emit(events.MASTER_FX_CHANGED, { instanceId, paramId });
  }

  // Add/remove/bypass/reorder one FX *instance* on a track's insert bus
  // (model/mutations.js#addTrackFx/removeTrackFx/setTrackFxBypass/moveTrackFx — see
  // model/trackChannel.js's doc comment for why this is instance-, not type-, scoped: the same
  // kind can now appear more than once) — reuses TRACK_FX_CHANGED, the same event a parameter
  // edit already emits, since the FX panel's useStore selector fingerprints fxChain alongside fx
  // (ui/chrome/FxPanel.jsx) and should refresh for any kind of change. addTrackFx returns the
  // new instance's id so appContext.js's applyAddTrackFx can create the matching engine-side
  // instance without re-deriving it.
  function addTrackFx(trackIndex, type) {
    const instanceId = addTrackFxModel(state.song, trackIndex, type);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, type });
    return instanceId;
  }

  function removeTrackFx(trackIndex, instanceId) {
    removeTrackFxModel(state.song, trackIndex, instanceId);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, instanceId });
  }

  function setTrackFxBypass(trackIndex, instanceId, bypassed) {
    setTrackFxBypassModel(state.song, trackIndex, instanceId, bypassed);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, instanceId });
  }

  function moveTrackFx(trackIndex, instanceId, direction) {
    moveTrackFxModel(state.song, trackIndex, instanceId, direction);
    emitter.emit(events.TRACK_FX_CHANGED, { trackIndex, instanceId });
  }

  // Master-bus equivalents (model/song.js#masterFxChain) — the FX panel's MASTER view.
  function addMasterFx(type) {
    const instanceId = addMasterFxModel(state.song, type);
    emitter.emit(events.MASTER_FX_CHANGED, { type });
    return instanceId;
  }

  function removeMasterFx(instanceId) {
    removeMasterFxModel(state.song, instanceId);
    emitter.emit(events.MASTER_FX_CHANGED, { instanceId });
  }

  function setMasterFxBypass(instanceId, bypassed) {
    setMasterFxBypassModel(state.song, instanceId, bypassed);
    emitter.emit(events.MASTER_FX_CHANGED, { instanceId });
  }

  function moveMasterFx(instanceId, direction) {
    moveMasterFxModel(state.song, instanceId, direction);
    emitter.emit(events.MASTER_FX_CHANGED, { instanceId });
  }

  // Track/master bus pan (model/trackChannel.js#pan / model/song.js#masterPan) — reuses
  // TRACK_CHANGED/MASTER_FX_CHANGED, the same events volume/bus.gain already emit for their own
  // channel-strip-equivalent controls, rather than inventing a dedicated pan event.
  function setTrackChannelPan(trackIndex, pan) {
    setTrackChannelPanModel(state.song, trackIndex, pan);
    emitter.emit(events.TRACK_CHANNEL_CHANGED, { trackIndex });
  }

  function setMasterPan(pan) {
    setMasterPanModel(state.song, pan);
    emitter.emit(events.MASTER_FX_CHANGED, { pan });
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
  // { origin, localAssetId } — appContext.js#applyInstrumentSample's own bookkeeping (see
  // model/instrument.js's origin doc comment); undefined fields are left untouched rather than
  // reset, so existing call sites that don't pass this at all (none remain, but a future direct
  // store caller might) can't accidentally blank out an instrument's provenance.
  function setInstrumentSample(index, sampleId, name, sampleAsset, { origin, localAssetId } = {}) {
    const instrument = state.instruments[index];
    if (!instrument) return;
    instrument.sampleId = sampleId;
    if (name !== undefined) instrument.name = name;
    if (sampleAsset !== undefined) instrument.sampleAsset = sampleAsset;
    if (origin !== undefined) instrument.origin = origin;
    if (localAssetId !== undefined) instrument.localAssetId = localAssetId;
    emitter.emit(events.INSTRUMENTS_CHANGED, { index });
  }

  // Instrument gain (model/instrument.js#gain) — the model-side half of the pair; the live
  // runtime.setSampleParameter() call that actually makes it audible is
  // appContext.js#applyInstrumentGain, the same split applyTrackFxParam already uses for FX.
  function setInstrumentGain(index, gain) {
    const instrument = state.instruments[index];
    if (!instrument) return;
    instrument.gain = gain;
    emitter.emit(events.INSTRUMENTS_CHANGED, { index });
  }

  // Instrument ADSR envelope (model/instrument.js#envelope) — same split as setInstrumentGain
  // above: the model-side half of the pair, appContext.js#applyInstrumentEnvelope is the live
  // runtime.setSampleEnvelope() call. Merges only the fields actually passed (webdsp's own
  // setSampleEnvelope semantics — model/instrument.js#envelope's doc comment), not a full
  // replace, so a single-slider edit from ui/chrome/InstrumentPanel.jsx never has to first read
  // back the instrument's other three fields.
  function setInstrumentEnvelope(index, envelope) {
    const instrument = state.instruments[index];
    if (!instrument) return;
    instrument.envelope = { ...instrument.envelope, ...envelope };
    emitter.emit(events.INSTRUMENTS_CHANGED, { index });
  }

  // Instrument.output (model/instrument.js) — which engine renders this slot's cells.
  // Unlike setInstrumentGain/setInstrumentSample, there's no live engine call to pair this
  // with: output type/channel is only ever read at compile time (audio/compile.js), never
  // pushed into webdsp or Web MIDI ahead of time the way a sample's gain is.
  function setInstrumentOutput(index, output) {
    const instrument = state.instruments[index];
    if (!instrument) return;
    instrument.output = output;
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

  // appContext.js#handleResample's one entry point for reporting resample progress —
  // "idle" | "armed" | "processing" | "complete" | "error". "armed" covers both
  // audio/resampleController.js's own "armed" (waiting for the next step boundary) and
  // "capturing" (the engine is actually recording) sub-phases: the user doesn't need to tell
  // them apart, both just mean "resample in progress, please wait." error is only ever
  // non-null alongside status === "error" (ui/chrome/TransportBar.jsx's tooltip).
  function setResampleStatus(status, error = null) {
    state.resampleStatus = status;
    state.resampleError = error;
    emitter.emit(events.RESAMPLE_STATUS_CHANGED, { status, error });
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
    state.resampleStatus = "idle";
    state.resampleError = null;

    emitter.emit(events.PATTERN_QUEUE_CHANGED, {});
    emitter.emit(events.PATTERN_SELECTED, { patternId: state.song.selectedPatternId });
    emitter.emit(events.TRANSPORT_CHANGED, { playing: false, bpm: state.song.bpm, swing: state.song.swing });
    emitter.emit(events.PROJECT_NAME_CHANGED, { name: state.song.name });
    emitter.emit(events.TRACK_CHANNEL_CHANGED, {});
    emitter.emit(events.TRACK_FX_CHANGED, {});
    emitter.emit(events.MASTER_FX_CHANGED, {});
    emitter.emit(events.INSTRUMENTS_CHANGED, {});
    emitter.emit(events.CURSOR_MOVED, state.cursor);
    emitter.emit(events.PATTERN_SWITCH_PENDING, { pending: false });
    emitter.emit(events.RESAMPLE_STATUS_CHANGED, { status: "idle", error: null });
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
    setSwing,
    setCell,
    getSelectionRect,
    clearSelection,
    copySelection,
    pasteSelection,
    fillSelection,
    duplicateSelection,
    setCellFx,
    setCellFxInstanceParam,
    setTrackFxParam,
    setMasterFxParam,
    setTrackFxInstanceParam,
    setMasterFxInstanceParam,
    addTrackFx,
    removeTrackFx,
    setTrackFxBypass,
    moveTrackFx,
    addMasterFx,
    removeMasterFx,
    setMasterFxBypass,
    moveMasterFx,
    setTrackChannelPan,
    setMasterPan,
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
    setInstrumentGain,
    setInstrumentEnvelope,
    setInstrumentOutput,
    addInstrumentSlot,
    setPatternSwitchPending,
    setResampleStatus,
    loadProject,
  };
}
