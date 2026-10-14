// App-level visibility into Web MIDI ports, for ui/chrome/SettingsModal.jsx — a read-only view
// across whatever Web MIDI currently sees, independent of midi/push/pushDevice.js's own
// connection (which keeps working exactly as before: name-matched, automatic, no manual
// "select"). Neither the generic keyboard-note path (input/midiInputSource.js, which already
// attaches to every connected input with no per-device filtering) nor MIDI-output instruments
// need a "selected device" concept to function — this module doesn't add one. It exists so the
// Settings modal can show what's actually plugged in and let the user force a fresh enumeration
// (Web MIDI's sysex permission, in particular, needs a user gesture) — see docs/MIDI.md's
// Settings-modal section for the full design.
//
// requestMIDIAccess is an overridable constructor parameter, the same "overridable for tests"
// shape pushDevice.js/midiInputSource.js/audio/lookaheadPlayer.js already use.
import { USER_PORT_NAME_PATTERN } from "./push/constants.js";

export function createMidiDeviceManager({
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
} = {}) {
  const listeners = new Set();
  let access = null;
  let requesting = null;
  // getSnapshot() must return a stable reference when nothing has actually changed —
  // ui/chrome/SettingsModal.jsx reads this through useSyncExternalStore, which re-renders
  // (and, if the reference changes every call, infinite-loops) whenever the returned value
  // isn't Object.is-equal to the last one. Rebuilt only inside refreshSnapshot() below (on
  // access-granted or the MIDIAccess's own statechange), never from getSnapshot() itself.
  let snapshot = { ready: false, inputs: [], outputs: [] };

  // likelyPush lets ui/chrome/SettingsModal.jsx label a port without knowing anything about
  // Push's own name-matching rule itself — the UI stays a dumb renderer of whatever this module
  // (the MIDI layer) decides, per the brief's "don't duplicate device-management logic in the
  // UI." The real connect/disconnect decision still only ever happens in pushDevice.js; this is
  // display-only.
  function portInfo(port) {
    return {
      id: port.id,
      name: port.name ?? "Unknown device",
      manufacturer: port.manufacturer ?? "",
      state: port.state,
      connection: port.connection,
      likelyPush: USER_PORT_NAME_PATTERN.test(port.name ?? ""),
    };
  }

  function refreshSnapshot() {
    snapshot = access
      ? { ready: true, inputs: Array.from(access.inputs.values()).map(portInfo), outputs: Array.from(access.outputs.values()).map(portInfo) }
      : { ready: false, inputs: [], outputs: [] };
  }

  function getSnapshot() {
    return snapshot;
  }

  function notify() {
    refreshSnapshot();
    listeners.forEach((fn) => fn(snapshot));
  }

  // Idempotent/cached the same way pushDevice.js#ensureConnected already is — whichever caller
  // asks first (the Settings modal opening, or a later manual "rescan") wins without requesting
  // access twice. sysex: true for parity with pushDevice.js's own request (Web MIDI's sysex
  // permission can't be upgraded after an initial non-sysex call, and this module's snapshot is
  // meant to reflect the same permission state the rest of the app's Push integration relies on).
  function requestAccess() {
    if (access) return Promise.resolve(access);
    if (requesting) return requesting;
    if (!requestMIDIAccess) return Promise.resolve(null);
    requesting = Promise.resolve(requestMIDIAccess({ sysex: true }))
      .then((midiAccess) => {
        access = midiAccess;
        access.addEventListener("statechange", notify);
        notify();
        return access;
      })
      .catch(() => null)
      .finally(() => {
        requesting = null;
      });
    return requesting;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { requestAccess, getSnapshot, subscribe };
}

// One shared instance, the same module-level-singleton shape audio/midiOutput.js's own
// `export const midiOutput = createMidiOutput()` already establishes — every caller (today,
// just the Settings modal) reads the same live port snapshot rather than each requesting its
// own MIDIAccess.
export const midiDeviceManager = createMidiDeviceManager();
