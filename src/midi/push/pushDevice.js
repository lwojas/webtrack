// Raw connection to the Ableton Push Mk1's own dedicated "User Port" MIDI input/output pair —
// distinct from its "Live Port" (Ableton Live's own proprietary control-surface protocol,
// which this project never speaks) and from audio/midiOutput.js's generic musical-note output
// (Push's pad/button/LED traffic is device control, not a tracker's musical note stream, and
// needs its own port anyway).
//
// Confirmed against the real connected hardware, not guessed: on this machine the device
// exposes exactly two port pairs, "Ableton Push Live Port" and "Ableton Push User Port" via
// the Web MIDI API — though the same port can show up elsewhere (Audio MIDI Setup, a DAW's own
// device list) with a manufacturer suffix, e.g. "Ableton Push User Port (Akai)". The pattern
// below is deliberately a loose substring match rather than an exact name, specifically so a
// manufacturer-suffixed variant like that still matches (see test/pushDevice.test.js's own
// case for it) without needing to special-case every naming variant different tools report.
// User Mode must be entered manually on the Push's own hardware menu — there is no documented
// setup handshake to replicate in software (see midi-core's own hardware-validation docs) — so
// this module only ever connects to whichever port already matches; it never attempts to
// switch the device into that mode itself.
import { USER_PORT_NAME_PATTERN } from "./constants.js";

export function createPushDevice({
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
} = {}) {
  const messageListeners = new Set();
  // Notified from refreshPorts() below on every call, not only on an actual connect/disconnect
  // transition — appContext.js's own subscriber (which triggers a full Push state refresh, see
  // docs/MIDI.md's Settings-modal section) already only acts when the reported value is true,
  // so a redundant "still disconnected" notification is a harmless no-op for every subscriber.
  const connectionListeners = new Set();
  let access = null;
  let input = null;
  let output = null;
  let connecting = false;

  function findUserPort(portMap) {
    return Array.from(portMap.values()).find((port) => USER_PORT_NAME_PATTERN.test(port.name ?? ""));
  }

  function handleMessage(e) {
    messageListeners.forEach((fn) => fn(Array.from(e.data)));
  }

  function refreshPorts() {
    const nextInput = findUserPort(access.inputs) ?? null;
    if (nextInput !== input) {
      input?.removeEventListener("midimessage", handleMessage);
      input = nextInput;
      input?.addEventListener("midimessage", handleMessage);
    }
    output = findUserPort(access.outputs) ?? null;
    connectionListeners.forEach((fn) => fn(isConnected()));
  }

  // sysex: true — needed for the LCD (a later stage), requested up front since Web MIDI's
  // sysex permission can't be upgraded after an initial non-sysex requestMIDIAccess() call.
  function ensureConnected() {
    if (access || connecting || !requestMIDIAccess) return;
    connecting = true;
    Promise.resolve(requestMIDIAccess({ sysex: true }))
      .then((midiAccess) => {
        access = midiAccess;
        refreshPorts();
        access.addEventListener("statechange", refreshPorts);
      })
      .catch(() => {})
      .finally(() => {
        connecting = false;
      });
  }

  function onMessage(fn) {
    messageListeners.add(fn);
    return () => messageListeners.delete(fn);
  }

  // Lets a caller outside this module (appContext.js's wiring, ui/chrome/SettingsModal.jsx via
  // its midiController) react to Push actually becoming connected/disconnected — e.g. to trigger
  // a full Push state refresh the moment a reconnect succeeds, without duplicating any of the
  // port-matching logic above.
  function onConnectionChange(fn) {
    connectionListeners.add(fn);
    return () => connectionListeners.delete(fn);
  }

  function send(bytes) {
    output?.send(bytes);
  }

  function isConnected() {
    return input != null && output != null;
  }

  function attach() {
    ensureConnected();
    return () => {
      input?.removeEventListener("midimessage", handleMessage);
      access?.removeEventListener("statechange", refreshPorts);
    };
  }

  return { attach, onMessage, send, isConnected, ensureConnected, onConnectionChange };
}
