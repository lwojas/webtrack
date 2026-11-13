// Routes incoming MIDI Control Change messages to the controls in ccCatalog.js through the map in ccMap.js, and holds the
// map's editable state for ui/chrome/MidiMapView.jsx (rebind, learn, reset, live monitor). Wires every connected MIDI input,
// like input/midiInputSource.js, except Push ports: Push's own buttons are CCs and are handled by midi/push.
//
// Performance: a message is one Map.get on the prebuilt lookup. A continuous control (fader, knob) only records its latest
// value; one flush per animation frame applies it, so a fast sweep is one store update per frame, not one per message.
// Toggles and triggers act immediately. The monitor costs nothing while no view is listening to it.
import { CC_CONTROL_BY_ID, PRESS_THRESHOLD } from "./ccCatalog.js";
import { buildLookup, diffFromDefaults, findConflicts, loadOverrides, normalizeBinding, resolveBindings, saveOverrides } from "./ccMap.js";

const STATUS_CONTROL_CHANGE = 0xb;
const PUSH_PORT = /push/i;

const defaultSchedule = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16));

export function createCcController({
  store,
  fxController,
  playbackController,
  togglePlayback,
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
  storage,
  schedule = defaultSchedule,
} = {}) {
  const ctx = { store, fxController, playbackController, togglePlayback };
  const stateListeners = new Set();
  const activityListeners = new Set();
  const wiredInputs = new Set();

  let overrides = loadOverrides(storage);
  let bindings = resolveBindings(overrides);
  let lookup = buildLookup(bindings);
  let learning = null; // control id waiting for its CC
  // useSyncExternalStore needs a stable reference between changes: rebuilt only in publish().
  let snapshot = makeSnapshot();
  let activity = null;

  const pending = new Map(); // coalescing key -> { def, index, raw }
  let flushScheduled = false;

  function makeSnapshot() {
    return { bindings, conflicts: findConflicts(bindings), learning };
  }

  function publish() {
    snapshot = makeSnapshot();
    stateListeners.forEach((fn) => fn());
  }

  function rebuild() {
    bindings = resolveBindings(overrides);
    lookup = buildLookup(bindings);
    saveOverrides(overrides, storage);
    publish();
  }

  function flush() {
    flushScheduled = false;
    const batch = [...pending.values()];
    pending.clear();
    for (const { def, index, raw } of batch) def.apply(ctx, index, raw / 127, raw);
  }

  function dispatch(def, index, raw) {
    if (def.kind === "continuous") {
      pending.set(def.id + ":" + index, { def, index, raw });
      if (!flushScheduled) {
        flushScheduled = true;
        schedule(flush);
      }
    } else if (raw >= PRESS_THRESHOLD) {
      def.apply(ctx, index, 1, raw);
    }
  }

  // One raw MIDI message ([status, data1, data2]).
  function handleMessage(data) {
    const status = data[0];
    if (status >> 4 !== STATUS_CONTROL_CHANGE) return;
    const channel = status & 0xf;
    const cc = data[1];
    const raw = data[2] ?? 0;

    if (activityListeners.size > 0) {
      activity = { channel, cc, value: raw };
      activityListeners.forEach((fn) => fn());
    }

    if (learning) {
      const def = CC_CONTROL_BY_ID.get(learning);
      const binding = normalizeBinding(def, { cc, channel });
      learning = null;
      if (binding) setBinding(def.id, binding);
      else publish();
      return;
    }

    const targets = lookup.get(channel * 128 + cc);
    if (!targets) return;
    for (const { def, index } of targets) dispatch(def, index, raw);
  }

  function handleEvent(e) {
    handleMessage(e.data);
  }

  function wireInput(input) {
    if (wiredInputs.has(input) || PUSH_PORT.test(input.name ?? "")) return;
    input.addEventListener("midimessage", handleEvent);
    wiredInputs.add(input);
  }

  function unwireInput(input) {
    input.removeEventListener("midimessage", handleEvent);
    wiredInputs.delete(input);
  }

  function handleStateChange(e) {
    const port = e.port;
    if (port.type !== "input") return;
    if (port.state === "connected") wireInput(port);
    else unwireInput(port);
  }

  function attach() {
    if (!requestMIDIAccess) return () => {};
    let detached = false;
    let access = null;
    Promise.resolve(requestMIDIAccess())
      .then((midiAccess) => {
        if (detached) return;
        access = midiAccess;
        access.inputs.forEach(wireInput);
        access.addEventListener("statechange", handleStateChange);
      })
      .catch(() => {});
    return () => {
      detached = true;
      access?.removeEventListener("statechange", handleStateChange);
      wiredInputs.forEach(unwireInput);
    };
  }

  // A control's new CC (and channel, for a global control). Anything invalid is refused (returns false).
  function setBinding(id, binding) {
    const def = CC_CONTROL_BY_ID.get(id);
    const next = normalizeBinding(def, binding);
    if (!next) return false;
    overrides = { ...overrides, [id]: next };
    overrides = diffFromDefaults(resolveBindings(overrides));
    rebuild();
    return true;
  }

  function resetBinding(id) {
    const { [id]: _removed, ...rest } = overrides;
    overrides = rest;
    rebuild();
  }

  function resetAll() {
    overrides = {};
    rebuild();
  }

  // The next CC message from any device is taken as `id`'s binding instead of being routed. Learning the same control again, or
  // another one, replaces the pending request; null cancels.
  function setLearning(id) {
    learning = id && CC_CONTROL_BY_ID.has(id) ? id : null;
    publish();
  }

  return {
    attach,
    handleMessage,
    getSnapshot: () => snapshot,
    subscribe(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    getActivity: () => activity,
    subscribeActivity(fn) {
      activityListeners.add(fn);
      return () => activityListeners.delete(fn);
    },
    setBinding,
    resetBinding,
    resetAll,
    setLearning,
  };
}
