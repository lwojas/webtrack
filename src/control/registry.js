import { CONTROLS, ACTIONS } from "./contract.js";
import { createControl } from "./createControl.js";
import { createAction } from "./createAction.js";
import * as events from "../state/events.js";

const TRACK_CONTROL_ID = /^track\.(\d+)\.(muted|solo|volume)$/;
const TRACK_FIELD_SETTERS = {
  muted: "setTrackChannelMuted",
  solo: "setTrackChannelSolo",
  volume: "setTrackChannelVolume",
};

function buildControl(def, { store, playbackController }) {
  const trackMatch = TRACK_CONTROL_ID.exec(def.id);
  if (trackMatch) {
    const trackIndex = Number(trackMatch[1]);
    const field = trackMatch[2];
    const setter = store[TRACK_FIELD_SETTERS[field]];
    return createControl({
      def,
      read: () => store.getState().song.trackChannels[trackIndex]?.[field],
      write: (value) => setter(trackIndex, value),
      subscribe: (fn) => store.subscribe(events.TRACK_CHANNEL_CHANGED, fn),
    });
  }

  switch (def.id) {
    case "transport.playing":
      return createControl({
        def,
        read: () => store.getState().playing,
        subscribe: (fn) => store.subscribe(events.TRANSPORT_CHANGED, fn),
      });
    case "transport.playheadRow":
      // Feedback-only, and purely derived from the engine's own clock, same as the UI
      // playhead (ui/grid/playheadLayer.js) — no store event corresponds to this changing.
      return createControl({ def, read: () => playbackController.getPlayheadRow() });
    case "bank.active":
      return createControl({
        def,
        read: () => store.getState().activeBankIndex,
        write: (value) => store.selectBank(value),
        subscribe: (fn) => store.subscribe(events.BANK_SELECTED, fn),
      });
    case "pattern.active":
      return createControl({
        def,
        read: () => {
          const state = store.getState();
          return state.song.banks[state.activeBankIndex].activePatternIndex;
        },
        write: (value) => store.selectPattern(value),
        subscribe: (fn) => store.subscribe(events.PATTERN_SELECTED, fn),
      });
    case "cursor.row":
      return createControl({
        def,
        read: () => store.getState().cursor.rowIndex,
        subscribe: (fn) => store.subscribe(events.CURSOR_MOVED, fn),
      });
    case "cursor.track":
      return createControl({
        def,
        read: () => store.getState().cursor.trackIndex,
        subscribe: (fn) => store.subscribe(events.CURSOR_MOVED, fn),
      });
    default:
      return null;
  }
}

function buildAction(def, { playbackController }) {
  const invoke = { "transport.play": playbackController.play, "transport.stop": playbackController.stop }[def.id];
  return invoke ? createAction({ def, invoke }) : null;
}

// Builds the live registry by mapping contract.js's table through createControl/createAction
// once (ECS-156 plan §9) — built entirely on state/store.js + audio/playbackController.js, no
// MIDI import anywhere in this file or in contract.js/createControl.js/createAction.js.
// Shaped to match midi-core's own ControlRegistry interface, so a future midi-core adapter
// could consume it directly, without this layer needing a rewrite to fit.
export function createControlRegistry({ store, playbackController }) {
  const controls = new Map();
  for (const def of CONTROLS) {
    const control = buildControl(def, { store, playbackController });
    if (control) controls.set(def.id, control);
  }

  const actions = new Map();
  for (const def of ACTIONS) {
    const action = buildAction(def, { playbackController });
    if (action) actions.set(def.id, action);
  }

  return {
    getControl: (id) => controls.get(id),
    listControls: () => Array.from(controls.values()),
    getAction: (id) => actions.get(id),
    listActions: () => Array.from(actions.values()),
  };
}
