// Push's 8 encoders + LCD, switchable between Volume mode (CC114) and FX mode (CC115) — see
// docs/MIDI.md's own doc comment on this file for the design. Attached independently of
// modeController.js's grid-mode dispatch (its own device.onMessage subscription — pushDevice.js
// already supports more than one listener), since the encoder row is a physically separate set
// of controls from the 8x8 pad grid and should behave the same regardless of whether the grid
// is currently showing Note or Session content.
//
// Reads/writes exclusively through the same surfaces the React UI already uses
// (store.setTrackChannelVolume, fxController.setTrackFxParam) — this file never calls
// audio/fx.js or model/mutations.js directly, so there's exactly one path from "a parameter
// changed" to the engine, whether that change came from a slider or an encoder.
import {
  ENCODER_CC,
  encoderDelta,
  CC_ENCODER_MODE_VOLUME,
  CC_ENCODER_MODE_FX,
  CC_ARROW_LEFT,
  CC_ARROW_RIGHT,
  PUSH_CHANNEL,
  FEEDBACK_DIM,
  FEEDBACK_FULL,
  LCD_SEGMENT_WIDTH,
  lcdSysex,
} from "./constants.js";
import { formatBar, buildEncoderLine, centerColumn } from "./lcd.js";
import { getFxParamsForType, getFxInstanceLabel, formatFxValue, isFxBooleanOn } from "../../model/fxParams.js";
import { CONTROLS } from "../../control/contract.js";
import { getSelectedPattern } from "../../model/query.js";
import { EFFECT_COMMANDS } from "../../model/effects.js";
import { noteNumberToName, toHex } from "../../model/notes.js";
import * as events from "../../state/events.js";

const STATUS_CC = 0xb0 | PUSH_CHANNEL;
const LCD_LINES = 4;
// Each encoder's bar/name/value content is formatted to the hardware's own per-segment width
// (constants.js#LCD_SEGMENT_WIDTH), then buildEncoderLine places it at that encoder's actual
// physical segment offset — not a contiguous index*width slot.
const COLUMN_WIDTH = LCD_SEGMENT_WIDTH;

// Reuses the exact min/max src/control/contract.js's own "track.*.volume" control already
// documents, rather than re-hardcoding a second copy of webtrack's volume range here.
const VOLUME_CONTROL = CONTROLS.find((c) => c.id === "track.0.volume");
const VOLUME_RANGE = { min: VOLUME_CONTROL?.min ?? 0, max: VOLUME_CONTROL?.max ?? 1.5 };

// A relative encoder has no absolute position, so a boolean parameter (filter.mode, filter.slope)
// can't just read "current + delta" the way a continuous one does — it needs to decide when a
// turn counts as "enough" to flip. Accumulating magnitude per encoder and flipping once it crosses
// this threshold (then resetting) keeps a small amount of jitter from toggling it on every tiny
// turn, while still being flippable in a few ticks either direction.
const BOOLEAN_TOGGLE_THRESHOLD = 4;

// Write mode's "cellEdit" encoder mode (docs/MIDI.md) — the same 7 fields
// ui/chrome/NoteEditor.jsx exposes above its CELL FX section, in the same order, reading from
// and writing to the exact same event object via store.setCell. No second data model: `field`
// is the literal model/event.js property name store.setCell already accepts. Cell FX automation
// (the variable-length CELL FX list) isn't represented here — it's sparse/dynamic in a way that
// doesn't fit a fixed 8-encoder layout, and the brief's own examples ("note, velocity/cell
// volume, length, etc.") don't require covering it; see docs/MIDI.md's own note on this.
//
// `apply` computes the next raw value from the current one and a relative encoder delta;
// `effectCommand` is a bounded enum instead (handled by handleEnumEncoder below, not `apply`).
// Numeric fields close to NoteEditor.jsx's own hex/numeric granularity use the raw delta
// directly (same single-tick feel as a hex digit bump); pan is scaled by the same
// range/100-per-tick convention the continuous volume/FX encoders already use, since it's a
// continuous -1..1 float, not a narrow integer range; length steps by a whole row per tick
// (a "snap to grid" count, not a continuous parameter), with a downward step from 1 returning to
// null ("auto").
function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const CELL_EDIT_FIELDS = [
  {
    field: "note",
    label: "NOTE",
    format: (v) => noteNumberToName(v),
    ratio: (v) => (v == null ? 0 : v / 127),
    apply: (current, delta) => clampValue((current ?? 60) + delta, 0, 127),
  },
  {
    field: "instrument",
    label: "INSTR",
    format: (v) => toHex(v, 2),
    ratio: (v) => (v == null ? 0 : v / 255),
    apply: (current, delta) => clampValue((current ?? 0) + delta, 0, 255),
  },
  {
    field: "velocity",
    label: "VEL",
    format: (v) => toHex(v, 2),
    ratio: (v) => (v == null ? 0 : v / 127),
    apply: (current, delta) => clampValue((current ?? 100) + delta, 0, 127),
  },
  {
    field: "length",
    label: "LENGTH",
    format: (v) => (v == null ? "AUTO" : String(v)),
    ratio: (v, pattern) => (v == null ? 0 : v / pattern.rowCount),
    apply: (current, delta, pattern) => {
      const next = (current ?? 0) + Math.sign(delta);
      return next <= 0 ? null : clampValue(next, 1, pattern.rowCount);
    },
  },
  {
    field: "pan",
    label: "PAN",
    format: (v) => (v == null ? "0.00" : v.toFixed(2)),
    ratio: (v) => ((v ?? 0) + 1) / 2,
    apply: (current, delta) => clampValue((current ?? 0) + delta * (2 / 100), -1, 1),
  },
  {
    field: "effectCommand",
    label: "FX CMD",
    isEnum: true,
    format: (v) => (v == null ? "---" : EFFECT_COMMANDS.find((c) => c.id === v)?.code ?? "---"),
    ratio: (v) => {
      const index = EFFECT_COMMAND_IDS.indexOf(v);
      return EFFECT_COMMAND_IDS.length <= 1 ? 0 : Math.max(0, index) / (EFFECT_COMMAND_IDS.length - 1);
    },
  },
  {
    field: "effectParam",
    label: "FX PRM",
    format: (v) => toHex(v, 2),
    ratio: (v) => (v == null ? 0 : v / 255),
    apply: (current, delta) => clampValue((current ?? 0) + delta, 0, 255),
  },
];

const EFFECT_COMMAND_IDS = [null, ...EFFECT_COMMANDS.map((c) => c.id)];

// A relative encoder has no absolute position, so stepping through a bounded enum (effectCommand)
// needs the same "accumulate until it's a real turn, then move one step" treatment
// BOOLEAN_TOGGLE_THRESHOLD already established for filter.mode above — generalized here to a
// signed step (+1/-1) instead of a single flip. Deliberately the same magnitude as
// BOOLEAN_TOGGLE_THRESHOLD for a consistent "feel" across every discrete (non-continuous) Push
// control.
const ENUM_STEP_THRESHOLD = 4;

export function createPushEncoderController({ device, store, fxController }) {
  let encoderMode = "volume"; // "volume" | "fx" | "cellEdit"
  // Which of volume/fx was active before write mode switched the encoders over to cellEdit —
  // restored by setCellEditMode(false), the same "remember what to go back to" shape
  // modeController.js's own sessionView persistence (independent of pushMode) established.
  let modeBeforeCellEdit = null;
  // This module's own windowing state — which fxChain entry the 8 encoders currently show for
  // the selected track — the same "Push-surface-local, not application state" precedent
  // trackerGridMode.js's own stepOffset already established, not a new state/store.js field.
  let fxPageIndex = 0;
  const booleanAccumulator = new Map(); // paramId -> accumulated |delta|
  const enumAccumulator = new Map(); // field -> accumulated signed delta
  let lastButtonFeedback = { volume: null, fx: null };
  let lastLcdLines = new Array(LCD_LINES).fill(null);
  let unsubscribes = [];

  function sendCC(cc, value) {
    device.send([STATUS_CC, cc, value]);
  }

  // Same "only send what changed" discipline trackerGridMode.js/modeController.js already use —
  // a full 4-line LCD repaint (mode switch, FX page turn) is still at most 4 SysEx messages,
  // never a blind resend of lines that didn't actually change.
  function sendLcdLine(index, text) {
    if (lastLcdLines[index] === text) return;
    lastLcdLines[index] = text;
    device.send(lcdSysex(index, text));
  }

  // CC114/CC115 reuse modeController.js's dim/full convention (FEEDBACK_DIM for the mode that
  // isn't selected, FEEDBACK_FULL for the one that is) — one convention for every mutually
  // exclusive Push button group, not a second scheme invented here.
  function paintModeButtons() {
    const next = {
      volume: encoderMode === "volume" ? FEEDBACK_FULL : FEEDBACK_DIM,
      fx: encoderMode === "fx" ? FEEDBACK_FULL : FEEDBACK_DIM,
    };
    if (lastButtonFeedback.volume !== next.volume) sendCC(CC_ENCODER_MODE_VOLUME, next.volume);
    if (lastButtonFeedback.fx !== next.fx) sendCC(CC_ENCODER_MODE_FX, next.fx);
    lastButtonFeedback = next;
  }

  function currentTrackIndex() {
    return store.getState().cursor.trackIndex;
  }

  // "Enabled" FX modules for paging purposes means fxChain membership, regardless of the
  // per-entry bypassed flag — bypass is a temporary mute (docs/FX.md), not disablement, so a
  // bypassed FX still participates in paging the same way it still shows up in FxPanel.jsx.
  function getEnabledFxChain(trackIndex) {
    return store.getState().song.trackChannels[trackIndex]?.fxChain ?? [];
  }

  function clampFxPageIndex(trackIndex) {
    const chain = getEnabledFxChain(trackIndex);
    fxPageIndex = chain.length === 0 ? 0 : Math.max(0, Math.min(fxPageIndex, chain.length - 1));
  }

  function currentFxEntry() {
    const trackIndex = currentTrackIndex();
    clampFxPageIndex(trackIndex);
    return getEnabledFxChain(trackIndex)[fxPageIndex] ?? null;
  }

  function volumeColumns() {
    return store.getState().song.trackChannels.map((channel) => ({
      isBoolean: false,
      ratio: (channel.volume - VOLUME_RANGE.min) / (VOLUME_RANGE.max - VOLUME_RANGE.min),
      name: channel.name,
      valueText: channel.volume.toFixed(2),
    }));
  }

  // Empty when the selected track has no FX enabled at all — the brief's required "appropriate
  // empty state": no columns means every encoder is simply unassigned, not an invalid read.
  function fxColumns() {
    const entry = currentFxEntry();
    if (!entry) return [];
    const trackChannel = store.getState().song.trackChannels[currentTrackIndex()];
    const instanceValues = trackChannel?.fx?.instances?.[entry.id] ?? {};
    return getFxParamsForType(entry.type).map((param) => {
      const value = instanceValues[param.id] ?? param.default;
      const isBoolean = param.kind === "boolean";
      return {
        isBoolean,
        ratio: isBoolean ? null : (value - param.min) / (param.max - param.min),
        boolOn: isBoolean ? isFxBooleanOn(value, param) : null,
        name: param.label,
        valueText: formatFxValue(value, param),
      };
    });
  }

  // The selected cell's own event, read straight off the same pattern/cursor
  // ui/chrome/NoteEditor.jsx reads — never a second copy of its fields.
  function cellEditEvent() {
    const { trackIndex, rowIndex } = store.getState().cursor;
    const pattern = getSelectedPattern(store.getState().song);
    return { pattern, trackIndex, rowIndex, event: pattern?.tracks[trackIndex]?.events[rowIndex] };
  }

  function cellEditColumns() {
    const { pattern, event } = cellEditEvent();
    if (!event) return [];
    return CELL_EDIT_FIELDS.map((def) => ({
      isBoolean: false,
      ratio: def.ratio(event[def.field], pattern),
      name: def.label,
      valueText: def.format(event[def.field]),
    }));
  }

  function buildHeader() {
    const trackIndex = currentTrackIndex();
    if (encoderMode === "volume") return "VOLUME";
    if (encoderMode === "cellEdit") {
      const { rowIndex, event } = cellEditEvent();
      if (!event) return "CELL EDIT  (no cell)";
      return `CELL EDIT  TRK${trackIndex + 1}  ROW${rowIndex + 1}`;
    }
    const chain = getEnabledFxChain(trackIndex);
    if (chain.length === 0) return `FX  (no FX enabled)  TRK${trackIndex + 1}`;
    const entry = chain[fxPageIndex] ?? chain[0];
    const label = getFxInstanceLabel(chain, entry.id);
    return `FX  ${label}  ${fxPageIndex + 1}/${chain.length}  TRK${trackIndex + 1}`;
  }

  function paintLcd() {
    const columns = encoderMode === "volume" ? volumeColumns() : encoderMode === "fx" ? fxColumns() : cellEditColumns();
    const barLine = buildEncoderLine(
      columns.map((c) => (c.isBoolean ? centerColumn(c.boolOn ? "ON" : "OFF", COLUMN_WIDTH) : formatBar(c.ratio ?? 0, COLUMN_WIDTH))),
    );
    sendLcdLine(0, buildHeader());
    sendLcdLine(1, barLine);
    sendLcdLine(2, buildEncoderLine(columns.map((c) => c.name)));
    sendLcdLine(3, buildEncoderLine(columns.map((c) => c.valueText)));
  }

  function paint() {
    paintModeButtons();
    paintLcd();
  }

  function switchEncoderMode(mode) {
    if (encoderMode === mode) return;
    encoderMode = mode;
    booleanAccumulator.clear();
    paint();
  }

  // Clamped, not wrapped — the same "handle the ends cleanly" convention
  // trackerGridMode.js#pageSteps already established for its own windowing axis.
  function pageFx(direction) {
    const trackIndex = currentTrackIndex();
    const chain = getEnabledFxChain(trackIndex);
    if (chain.length === 0) return;
    const next = Math.min(chain.length - 1, Math.max(0, fxPageIndex + direction));
    if (next === fxPageIndex) return;
    fxPageIndex = next;
    booleanAccumulator.clear();
    paintLcd();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function handleVolumeEncoder(trackIndex, delta) {
    const channel = store.getState().song.trackChannels[trackIndex];
    if (!channel) return;
    const step = (VOLUME_RANGE.max - VOLUME_RANGE.min) / 100;
    store.setTrackChannelVolume(trackIndex, clamp(channel.volume + delta * step, VOLUME_RANGE.min, VOLUME_RANGE.max));
  }

  function handleFxEncoder(encoderIndex, delta) {
    const entry = currentFxEntry();
    if (!entry) return;
    const param = getFxParamsForType(entry.type)[encoderIndex];
    if (!param) return;
    const trackIndex = currentTrackIndex();
    const instanceValues = store.getState().song.trackChannels[trackIndex]?.fx?.instances?.[entry.id] ?? {};
    const current = instanceValues[param.id] ?? param.default;

    if (param.kind === "boolean") {
      const accumulated = (booleanAccumulator.get(param.id) ?? 0) + Math.abs(delta);
      if (accumulated < BOOLEAN_TOGGLE_THRESHOLD) {
        booleanAccumulator.set(param.id, accumulated);
        return;
      }
      booleanAccumulator.set(param.id, 0);
      fxController.setTrackFxInstanceParam(trackIndex, entry.id, param.id, isFxBooleanOn(current, param) ? param.min : param.max);
      return;
    }

    const step = (param.max - param.min) / 100;
    fxController.setTrackFxInstanceParam(trackIndex, entry.id, param.id, clamp(current + delta * step, param.min, param.max));
  }

  // effectCommand is a bounded enum, not a continuous/hex value — reads exactly like
  // handleFxEncoder's own boolean branch, just stepping a signed index instead of flipping one
  // bit, and writing through the same store.setCell every other field here uses.
  function handleEnumEncoder(def, trackIndex, rowIndex, event, accumulated) {
    const ids = EFFECT_COMMAND_IDS;
    const currentIndex = Math.max(0, ids.indexOf(event[def.field]));
    const nextIndex = clampValue(currentIndex + Math.sign(accumulated), 0, ids.length - 1);
    store.setCell(trackIndex, rowIndex, def.field, ids[nextIndex]);
  }

  function handleCellEditEncoder(encoderIndex, delta) {
    const def = CELL_EDIT_FIELDS[encoderIndex];
    if (!def) return;
    const { pattern, trackIndex, rowIndex, event } = cellEditEvent();
    if (!event) return;

    if (def.isEnum) {
      const accumulated = (enumAccumulator.get(def.field) ?? 0) + delta;
      if (Math.abs(accumulated) < ENUM_STEP_THRESHOLD) {
        enumAccumulator.set(def.field, accumulated);
        return;
      }
      enumAccumulator.set(def.field, 0);
      handleEnumEncoder(def, trackIndex, rowIndex, event, accumulated);
      return;
    }

    store.setCell(trackIndex, rowIndex, def.field, def.apply(event[def.field], delta, pattern));
  }

  function handleEncoderTurn(encoderIndex, delta) {
    if (delta === 0) return;
    if (encoderMode === "volume") handleVolumeEncoder(encoderIndex, delta);
    else if (encoderMode === "fx") handleFxEncoder(encoderIndex, delta);
    else handleCellEditEncoder(encoderIndex, delta);
    paintLcd();
  }

  // Write mode's own entry point (wired by appContext.js to pushWriteMode.js's onChange) —
  // switches the 8-encoder/4-display surface over to representing the selected tracker cell
  // (docs/MIDI.md) while write mode is on, and restores whichever of volume/fx was showing
  // before once it's off. Deliberately never touches fxPageIndex/encoderMode's own volume-vs-fx
  // choice — turning write mode off lands exactly back where the encoders were, not reset to a
  // default.
  function setCellEditMode(active) {
    if (active) {
      if (encoderMode === "cellEdit") return;
      modeBeforeCellEdit = encoderMode;
      encoderMode = "cellEdit";
    } else {
      if (encoderMode !== "cellEdit") return;
      encoderMode = modeBeforeCellEdit ?? "volume";
    }
    booleanAccumulator.clear();
    enumAccumulator.clear();
    paint();
  }

  function onCC(cc, value) {
    if (cc === CC_ENCODER_MODE_VOLUME && value > 0) return switchEncoderMode("volume");
    if (cc === CC_ENCODER_MODE_FX && value > 0) return switchEncoderMode("fx");
    if (encoderMode === "fx") {
      if (cc === CC_ARROW_LEFT && value > 0) return pageFx(-1);
      if (cc === CC_ARROW_RIGHT && value > 0) return pageFx(1);
    }
    const encoderIndex = ENCODER_CC.indexOf(cc);
    if (encoderIndex !== -1) handleEncoderTurn(encoderIndex, encoderDelta(value));
  }

  function handleMessage(bytes) {
    const [status, data1, data2] = bytes;
    if ((status & 0xf0) !== STATUS_CC) return;
    onCC(data1, data2);
  }

  function attach() {
    const unsubscribeDevice = device.onMessage(handleMessage);
    unsubscribes = [
      store.subscribe(events.TRACK_CHANNEL_CHANGED, paintLcd),
      store.subscribe(events.TRACK_FX_CHANGED, paintLcd),
      store.subscribe(events.CURSOR_MOVED, paintLcd),
      // cellEdit mode's own fields live on the event CELL_CHANGED already covers (e.g. a
      // ui/chrome/NoteEditor.jsx edit landing on the selected cell while Push is showing it) —
      // harmless to also repaint volume/FX mode, which just redraws the same unrelated content.
      store.subscribe(events.CELL_CHANGED, paintLcd),
    ];
    lastButtonFeedback = { volume: null, fx: null };
    lastLcdLines = new Array(LCD_LINES).fill(null);
    paint();
    return () => {
      unsubscribeDevice();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribes = [];
      sendCC(CC_ENCODER_MODE_VOLUME, FEEDBACK_DIM);
      sendCC(CC_ENCODER_MODE_FX, FEEDBACK_DIM);
      for (let i = 0; i < LCD_LINES; i++) device.send(lcdSysex(i, ""));
    };
  }

  // Used by appContext.js's refreshPushState() (a Push reconnect, or the Settings modal's
  // manual refresh button) — resets every diff cache and repaints, without touching the store
  // subscriptions attach() already owns.
  function refresh() {
    lastButtonFeedback = { volume: null, fx: null };
    lastLcdLines = new Array(LCD_LINES).fill(null);
    paint();
  }

  return { attach, refresh, setCellEditMode };
}
