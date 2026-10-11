import {
  setActivePatternIndex,
  setEventField,
  clearEvent as clearEventModel,
  setTrackChannelMuted as setTrackChannelMutedModel,
  setTrackChannelSolo as setTrackChannelSoloModel,
  setTrackChannelVolume as setTrackChannelVolumeModel,
  setPatternRowCount,
} from "../model/mutations.js";
import { createInstrumentSlot } from "../model/instrument.js";
import { rowCountForBars } from "../model/timing.js";
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
    activeBankIndex: 0,
    cursor: { trackIndex: 0, rowIndex: 0, field: "note" },
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

  function selectBank(bankIndex) {
    if (!state.song.banks[bankIndex]) return;
    state.activeBankIndex = bankIndex;
    emitter.emit(events.BANK_SELECTED, { bankIndex });
  }

  function selectPattern(patternIndex) {
    setActivePatternIndex(state.song, state.activeBankIndex, patternIndex);
    emitter.emit(events.PATTERN_SELECTED, { bankIndex: state.activeBankIndex, patternIndex });
  }

  // bars: 1-8 (see model/timing.js#MAX_BARS). Resizes the active pattern in place — no
  // playback-side handling is needed because lookaheadPlayer/compileRow already read
  // pattern.rowCount fresh every tick, even mid-playback.
  function setSequenceLength(bars) {
    const bankIndex = state.activeBankIndex;
    const patternIndex = state.song.banks[bankIndex].activePatternIndex;
    setPatternRowCount(state.song, bankIndex, patternIndex, rowCountForBars(bars));
    emitter.emit(events.PATTERN_LENGTH_CHANGED, { bankIndex, patternIndex });
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
    const patternIndex = state.song.banks[state.activeBankIndex].activePatternIndex;
    setEventField(state.song, { bankIndex: state.activeBankIndex, patternIndex, trackIndex, rowIndex }, field, value);
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  function clearCell(trackIndex, rowIndex) {
    const patternIndex = state.song.banks[state.activeBankIndex].activePatternIndex;
    clearEventModel(state.song, { bankIndex: state.activeBankIndex, patternIndex, trackIndex, rowIndex });
    emitter.emit(events.CELL_CHANGED, { trackIndex, rowIndex });
  }

  // delta: { row } to move by rows (wraps within the pattern), or { field } to step through
  // CURSOR_FIELDS (wraps into the neighboring track at either end). One or the other per
  // call, matching how editController.js's arrow-key handlers call this.
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
    emitter.emit(events.CURSOR_MOVED, state.cursor);
  }

  // Mouse selection: sets the cursor directly to an exact (track, row, field) rather than
  // moving it by a delta — used by the grid's click handler (ui/grid/gridView.js's
  // onCellClick). Emits the same CURSOR_MOVED event keyboard navigation does, so every
  // existing subscriber (cursor layer, note editor) reacts without any new wiring.
  function selectCell(trackIndex, rowIndex, field) {
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
  // every current subscriber (grid, mixer, instrument panel, transport bar, note editor)
  // refreshes with zero new wiring — including the grid's own resize check, which reacts to
  // BANK_SELECTED/PATTERN_SELECTED already.
  function loadProject({ song, instruments, ui = {} }) {
    state.song = song;
    state.instruments = instruments;
    state.activeBankIndex = ui.activeBankIndex ?? 0;
    state.cursor = ui.cursor ?? { trackIndex: 0, rowIndex: 0, field: "note" };
    state.editMode = true;
    state.editStep = ui.editStep ?? 1;
    state.octave = ui.octave ?? 4;
    state.selectedInstrumentIndex = ui.selectedInstrumentIndex ?? 0;
    state.playing = false;
    state.patternSwitchPending = false;

    const patternIndex = state.song.banks[state.activeBankIndex].activePatternIndex;
    emitter.emit(events.BANK_SELECTED, { bankIndex: state.activeBankIndex });
    emitter.emit(events.PATTERN_SELECTED, { bankIndex: state.activeBankIndex, patternIndex });
    emitter.emit(events.TRANSPORT_CHANGED, { playing: false, bpm: state.song.bpm });
    emitter.emit(events.TRACK_CHANNEL_CHANGED, {});
    emitter.emit(events.INSTRUMENTS_CHANGED, {});
    emitter.emit(events.CURSOR_MOVED, state.cursor);
    emitter.emit(events.PATTERN_SWITCH_PENDING, { pending: false });
  }

  return {
    getState,
    subscribe,
    selectBank,
    selectPattern,
    setTransport,
    setBpm,
    setCell,
    clearCell,
    moveCursor,
    selectCell,
    setSequenceLength,
    toggleEditMode,
    setEditStep,
    setOctave,
    selectInstrument,
    setTrackChannelMuted,
    setTrackChannelSolo,
    setTrackChannelVolume,
    setInstrumentSample,
    addInstrumentSlot,
    setPatternSwitchPending,
    loadProject,
  };
}
