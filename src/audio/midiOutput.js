// Turns audio/compile.js's `kind: "midi"` compiled events into real Web MIDI Note On/Off
// sends — the MIDI-output counterpart to webdsp's own role for sample output.
//
// Unlike webdsp's sample scheduling (sample-accurate AudioContext timestamps, cancelable via
// AudioRuntime.cancelScheduled()), Web MIDI's own `output.send(data, timestamp)` has no
// cancel at all — once sent with a future timestamp, the browser delivers it regardless of
// what happens afterward (e.g. the user hits Stop mid-note). So this module never uses that
// timestamp parameter. Every send is instead a plain `setTimeout` keyed to "how many ms from
// right now" — computed fresh at the moment lookaheadPlayer's tick() calls
// scheduleNoteEvents() (within the same ~150ms lookahead horizon everything else schedules
// inside, never far in advance), which needs no clock-bridging at all: `event.time` and
// `runtime.getCurrentTime()` are already the same AudioContext-seconds clock, so their
// difference is directly "seconds from now." setTimeout's few-ms jitter is well within MIDI's
// own timing tolerance (unlike audio sample playback, which is why webdsp needs the Web Audio
// clock in the first place), and, critically, setTimeout IS cancelable.
//
// Each compiled MIDI event is self-contained — compileRow already gave it its own `duration`
// the same way it does for sample output (audio/compile.js#noteDurationSteps) — so a matched
// Note On/Note Off pair per event is all that's needed; there's no cross-event voice-tracking
// to do here, mirroring webdsp's own "duration is baked in at compile time, the engine
// auto-releases" model (see docs/ARCHITECTURE.md's audio-timing section) rather than
// introducing a parallel voiceTracker.js for MIDI.
export function createMidiOutput({
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
  setTimeoutFn = (...args) => setTimeout(...args),
  clearTimeoutFn = (...args) => clearTimeout(...args),
} = {}) {
  let access = null;
  let outputs = [];
  let connecting = false;
  const pendingTimeouts = new Set();

  function refreshOutputs() {
    outputs = Array.from(access.outputs.values());
  }

  // Lazy, idempotent, same "whichever call site asks first wins, retried next time if it
  // hasn't resolved yet" shape audio/voiceTracker.js's ensureVoiceEndedWired() already uses —
  // there's no explicit attach()/detach() lifecycle to wire into App.jsx; the first attempt to
  // actually send or schedule a note kicks off requestMIDIAccess() on its own.
  function ensureConnected() {
    if (access || connecting || !requestMIDIAccess) return;
    connecting = true;
    Promise.resolve(requestMIDIAccess())
      .then((midiAccess) => {
        access = midiAccess;
        refreshOutputs();
        access.addEventListener("statechange", refreshOutputs);
      })
      .catch(() => {})
      .finally(() => {
        connecting = false;
      });
  }

  function sendNow(bytes) {
    outputs.forEach((output) => output.send(bytes));
  }

  // delaySeconds < 0 (a send that, by the time this runs, should already have happened —
  // shouldn't occur given the lookahead horizon, but clamped defensively the same way
  // reserveVoiceSlot/compileRow clamp their own edge cases elsewhere) fires immediately
  // instead of silently being skipped.
  function sendAfter(delaySeconds, bytes) {
    const id = setTimeoutFn(() => {
      pendingTimeouts.delete(id);
      sendNow(bytes);
    }, Math.max(0, delaySeconds * 1000));
    pendingTimeouts.add(id);
  }

  function noteOnBytes({ channel, note, velocity }) {
    return [0x90 | (channel & 0xf), note & 0x7f, velocity & 0x7f];
  }

  function noteOffBytes({ channel, note }) {
    return [0x80 | (channel & 0xf), note & 0x7f, 0];
  }

  // events: compileRow's `kind: "midi"` events, each already carrying its own absolute
  // `time`/`duration` in the same AudioContext-seconds clock `currentTime` was just read from
  // (audio/lookaheadPlayer.js's tick() passes runtime.getCurrentTime() straight through).
  function scheduleNoteEvents(events, currentTime) {
    ensureConnected();
    events.forEach((event) => {
      sendAfter(event.time - currentTime, noteOnBytes(event));
      sendAfter(event.time + event.duration - currentTime, noteOffBytes(event));
    });
  }

  // Immediate, unscheduled audition (audio/preview.js's triggerPreview — the MIDI-output
  // counterpart to a sample's runtime.trigger()) — no matching Note Off is sent, same as a
  // sample audition's voice isn't explicitly released on key-up either today (there is no
  // onNoteOff wiring into preview.js at all yet); fixing that gap for either output type is
  // separate, unrelated work.
  function sendImmediateNoteOn(channel, note, velocity) {
    ensureConnected();
    sendNow(noteOnBytes({ channel, note, velocity }));
  }

  // Called from audio/lookaheadPlayer.js's stop(), alongside runtime.cancelScheduled() — the
  // one place MIDI output scheduling actually can be canceled, since it never used Web MIDI's
  // own (uncancelable) timestamped send.
  function cancelScheduled() {
    pendingTimeouts.forEach((id) => clearTimeoutFn(id));
    pendingTimeouts.clear();
  }

  return { scheduleNoteEvents, sendImmediateNoteOn, cancelScheduled };
}

// One shared instance for the whole app, same role audio/voiceTracker.js's own shared
// `voiceTracker` singleton plays: audio/lookaheadPlayer.js's scheduled playback and
// audio/preview.js's manual audition both send through the same connected set of MIDI output
// ports, rather than each independently (and redundantly) calling requestMIDIAccess().
export const midiOutput = createMidiOutput();
