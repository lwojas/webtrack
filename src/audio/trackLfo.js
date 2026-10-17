// Evaluates a track's event LFO for one cell. Sequencer-side half of the Track LFO: webdsp owns
// the LFO maths (lfoValueAt — a TypeScript mirror of the engine's LFO, parity-tested in webdsp);
// this file only decides what the value does to the event. No clock of its own: the caller passes
// the event's scheduled time and the transport anchor/tempo (audio/lookaheadPlayer.js — the same
// anchor it gives runtime.setTempo), so the result is a pure function of (song, anchor, event
// time): deterministic and correct for events scheduled ahead of the audio clock.
import { LFO_DIVISIONS, LfoWaveform, lfoValueAt } from "webdsp";

const WAVEFORMS = {
  sine: LfoWaveform.Sine,
  triangle: LfoWaveform.Triangle,
  square: LfoWaveform.Square,
  saw: LfoWaveform.Saw,
};
const QUARTER = LFO_DIVISIONS.findIndex((d) => d.name === "1/4");

// The LFO's output, -1..1, at `eventTime`. `clock` = { anchorTime, bpm } (a beat = a quarter note).
export function eventLfoValue(lfo, eventTime, clock) {
  const division = LFO_DIVISIONS.findIndex((d) => d.name === lfo.division);
  return lfoValueAt(
    { waveform: WAVEFORMS[lfo.waveform] ?? LfoWaveform.Sine, sync: lfo.sync, rateHz: lfo.rateHz, division: division >= 0 ? division : QUARTER },
    { time: eventTime, anchorTime: clock.anchorTime, bpm: clock.bpm },
  );
}

// The velocity (0..127) a cell should be played with when scheduled at `eventTime`. Returns the
// cell's own velocity untouched when the track has no enabled LFO, the cell does not participate,
// or no clock is available. A modulated value is rounded to a whole velocity (so a MIDI consumer
// of the same event stays valid). The stored event is never modified. Target dispatch lives here
// so another event property later is one more case, not a change to compile.
export function effectiveVelocity(channel, event, baseVelocity, eventTime, clock) {
  const lfo = channel?.eventLfo;
  const participation = event.lfo ?? 0;
  if (!clock || !lfo || !lfo.enabled || !(participation > 0)) return baseVelocity;
  switch (lfo.target) {
    case "velocity": {
      const v = baseVelocity + eventLfoValue(lfo, eventTime, clock) * lfo.depth * participation * 127;
      return Math.min(127, Math.max(0, Math.round(v)));
    }
    default:
      return baseVelocity;
  }
}
