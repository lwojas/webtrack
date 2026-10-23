import { createNoteInputSource } from "./noteInputSource.js";

const STATUS_NOTE_OFF = 0x8;
const STATUS_NOTE_ON = 0x9;

function parseStatusByte(status) {
  return { messageType: status >> 4, channel: status & 0xf };
}

// Implements noteInputSource.js's contract for a real Web MIDI input device (a keyboard, or a
// controller sending plain note messages — e.g. a future Push Note Mode, see
// docs/EXTENDING.md). Same { onNoteOn, onNoteOff, emitNoteOn, emitNoteOff, attach } shape as
// keyboardNoteMap.js's createKeyboardNoteSource, so editController.js and audio/preview.js
// never need to know which source produced a given note.
//
// requestMIDIAccess is overridable (same "overridable for tests" convention
// audio/lookaheadPlayer.js's reserveVoiceSlot/registerVoice use) — production wiring falls
// back to the real navigator.requestMIDIAccess, tests inject a fake MIDIAccess.
export function createMidiNoteSource({
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
  // True while the host is playing incoming notes itself from a route (audio/midiRoute.js): a note is then still delivered here (so it can be
  // entered into the pattern) but flagged `routed`, and the consumer must not also play it.
  isRouted = () => false,
} = {}) {
  const source = createNoteInputSource();
  const wiredInputs = new Set();

  // Note On with velocity 0 is the running-status idiom many MIDI keyboards send instead of a
  // real Note Off message — treated identically to one here, same as any other MIDI consumer
  // has to.
  function handleMidiMessage(e) {
    const [status, data1, data2] = e.data;
    const { messageType, channel } = parseStatusByte(status);
    if (messageType === STATUS_NOTE_ON && data2 > 0) {
      // `routed` is only present when true, so the payload is exactly what it always was otherwise.
      source.emitNoteOn({ note: data1, velocity: data2, channel, ...(isRouted() ? { routed: true } : {}) });
    } else if (messageType === STATUS_NOTE_OFF || (messageType === STATUS_NOTE_ON && data2 === 0)) {
      source.emitNoteOff({ note: data1, channel });
    }
  }

  function wireInput(input) {
    if (wiredInputs.has(input)) return;
    input.addEventListener("midimessage", handleMidiMessage);
    wiredInputs.add(input);
  }

  function unwireInput(input) {
    input.removeEventListener("midimessage", handleMidiMessage);
    wiredInputs.delete(input);
  }

  function handleStateChange(e) {
    const port = e.port;
    if (port.type !== "input") return;
    if (port.state === "connected") wireInput(port);
    else unwireInput(port);
  }

  // Synchronous attach()/detach-fn, matching keyboardNoteMap.js's contract exactly, even
  // though the actual Web MIDI setup is async (requestMIDIAccess() returns a Promise, and may
  // not exist at all, or may reject on an unsupported browser/denied permission) — fire-and-
  // forget by design, same "legitimate no-op until available" stance audio/preview.js already
  // takes for the audio runtime. `detached` guards against a MIDIAccess that resolves after
  // the caller has already torn this down (e.g. a fast remount). It belongs to THIS attach call: it used to be shared by all of them, so
  // after one detach every later attach was ignored, and under React StrictMode (which attaches, detaches and attaches again in dev)
  // the MIDI input never worked in the dev server.
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

  return { ...source, attach };
}
