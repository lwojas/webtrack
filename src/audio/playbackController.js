import { initRuntime } from "./runtime.js";
import { createLookaheadPlayer } from "./lookaheadPlayer.js";
import { compileRow } from "./compile.js";
import { STEPS_PER_BEAT } from "../model/timing.js";

// The bridge between state/store.js and audio/* — deliberately takes its state as getter
// functions rather than importing state/store.js directly, so audio/ stays free of any ui/
// or state/ import (see ECS-156 plan §6's import rule). state/store.js is what actually wires
// these getters to itself.
export function createPlaybackController({
  getActivePattern,
  getTrackChannels,
  getInstruments,
  getBpm,
  onTransportChange,
  onPatternSwitchPending,
}) {
  let player = null;

  function getStepDurationSeconds() {
    return 60 / getBpm() / STEPS_PER_BEAT;
  }

  async function play() {
    const runtime = await initRuntime();
    if (!player) {
      player = createLookaheadPlayer({
        runtime,
        compileRow,
        getStepDurationSeconds,
        onPatternSwitched: () => onPatternSwitchPending?.(false),
      });
    }
    player.start({
      initialPattern: getActivePattern(),
      initialTrackChannels: getTrackChannels(),
      initialInstruments: getInstruments(),
    });
    onTransportChange?.({ playing: true });
  }

  function stop() {
    player?.stop();
    onTransportChange?.({ playing: false });
  }

  // While playing, the switch is deferred to the next loop boundary (see lookaheadPlayer.js),
  // which reports back via onPatternSwitched once it actually takes effect. While stopped,
  // there's nothing to defer — the next play() call reads getActivePattern() fresh, so the
  // switch is already effectively immediate and there's no pending state to report.
  function switchPattern(newPattern) {
    if (player?.isPlaying()) {
      player.requestPatternSwitch(newPattern);
      onPatternSwitchPending?.(true);
    }
  }

  function isPlaying() {
    return player?.isPlaying() ?? false;
  }

  function getPlayheadRow() {
    return player?.getPlayheadRow() ?? -1;
  }

  return { play, stop, switchPattern, isPlaying, getPlayheadRow };
}
