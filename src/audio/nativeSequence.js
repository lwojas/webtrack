// The song as a webdsp Sequence, for a host that plays it itself (runtime.setSequence; webdsp docs/native-sequence.md): one cycle of the
// pattern queue as timed events in quarter notes. The host plays it on its audio thread against the DAW's transport, so it keeps playing
// with the plugin window closed and renders in an offline bounce. The page stays the editor: every edit sends the whole sequence again.
//
// This is not a second compiler. Each row of each queued pattern goes through the same compileRow / compileRowAutomation the lookahead
// player uses, at a fixed 120 bpm (so a second is exactly 2 quarter notes), and the result is converted to beats: the host plays what
// the player would have scheduled. Only the source of tempo differs: the DAW's, applied per block by the host.
import { compileRow, compileRowAutomation } from "./compile.js";
import { toScheduledParam } from "./automation.js";
import { STEPS_PER_BEAT, swingDelaySeconds } from "../model/timing.js";

const REFERENCE_BPM = 120;
const QUARTERS_PER_SECOND = REFERENCE_BPM / 60;
const STEP_SECONDS = 60 / REFERENCE_BPM / STEPS_PER_BEAT;

// One cycle of the queue as a Sequence, or null when there is nothing to play. Pure.
//   entries        [{ pattern }] in queue order (model/query.js#getPatternQueueEntries)
//   trackChannels, instruments, trackBusIds  as the player gets them
//   swing          the song's swing amount
//   hasSample(id)  is this sample loaded in the engine? (events for one it lacks are left out; the sequence is sent again when it has it)
//   paramContext   automation.js#toScheduledParam's context (effect/instrument/sample parameter resolvers)
export function compileNativeSequence({ entries, trackChannels, instruments, trackBusIds, swing, hasSample, paramContext }) {
  const events = [];
  let cycleSteps = 0;
  const lfoClock = { anchorTime: 0, bpm: REFERENCE_BPM };

  for (const { pattern } of entries) {
    if (!pattern || pattern.rowCount <= 0) continue;
    for (let row = 0; row < pattern.rowCount; row++) {
      const step = cycleSteps + row;
      const time = step * STEP_SECONDS + swingDelaySeconds(step, STEP_SECONDS, swing);
      for (const e of compileRow(pattern, trackChannels, instruments, row, time, STEP_SECONDS, trackBusIds, lfoClock)) {
        if (e.kind === "sample") {
          if (!hasSample(e.sampleId)) continue;
          const mono = trackChannels[e.trackIndex]?.voiceMode === "mono";
          events.push({
            beat: e.time * QUARTERS_PER_SECOND,
            kind: "sample",
            sample: e.sampleId,
            ...(e.bus !== undefined ? { bus: e.bus } : {}),
            gain: e.gain,
            ...(e.pan !== undefined ? { pan: e.pan } : {}),
            ...(e.pitch ? { pitch: e.pitch } : {}),
            ...(e.region !== undefined ? { region: e.region } : {}),
            ...(e.loop ? { loop: true } : {}),
            ...(e.duration !== undefined ? { durationBeats: e.duration * QUARTERS_PER_SECOND } : {}),
            ...(e.chokeGroup !== undefined ? { chokeGroup: e.chokeGroup } : {}),
            ...(mono ? { mono: true, track: e.trackIndex } : {}),
          });
        } else if (e.kind === "instrument") {
          events.push({
            beat: e.time * QUARTERS_PER_SECOND,
            kind: "instrument",
            instrument: e.instrumentId,
            velocity: e.velocity,
            ...(e.pan !== undefined ? { pan: e.pan } : {}),
            ...(e.pitch ? { pitch: e.pitch } : {}),
            ...(e.duration !== undefined ? { durationBeats: e.duration * QUARTERS_PER_SECOND } : {}),
            ...(e.chokeGroup !== undefined ? { chokeGroup: e.chokeGroup } : {}),
            ...(e.tie ? { tie: true } : {}),
          });
        } // MIDI output stays the page's: a plugin has no MIDI out here, and the page is not there to send it with the window closed
      }
      for (const item of compileRowAutomation(pattern, row, STEP_SECONDS)) {
        const p = toScheduledParam(item, time, paramContext);
        if (!p) continue;
        events.push({
          beat: p.time * QUARTERS_PER_SECOND,
          kind: "param",
          target: p.target,
          param: p.param,
          value: p.value,
          ...(p.from !== undefined ? { from: p.from, rampBeats: p.ramp * QUARTERS_PER_SECOND } : {}),
        });
      }
    }
    cycleSteps += pattern.rowCount;
  }

  if (cycleSteps <= 0 || events.length === 0) return null;
  return { lengthBeats: cycleSteps / STEPS_PER_BEAT, events };
}
