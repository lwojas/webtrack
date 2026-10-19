import { useRef } from "react";
import { METER_LED_DB } from "webdsp";
import { useMixerMeters } from "../useMixerMeters.js";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { rangeFillStyle } from "../rangeFill.js";

// model/mutations.js mutates a trackChannel object in place (same reference before/after —
// see ARCHITECTURE.md's in-place-mutation gotcha) — useSyncExternalStore compares snapshots
// with Object.is, so a selector must return the primitive fields that actually changed, not
// the mutable container object itself, or React never detects the change. The name never
// changes after creation, so it's read once outside any hook rather than subscribed to.
//
// The track's own playback length (model/pattern.js) lives in the tracker grid's per-column
// header instead of here (ui/grid/gridView.js's track-header row) — it reads naturally sitting
// above the column it governs, and this strip is left with only the song-wide trackChannel
// fields (mute/solo/volume), which are shared across every pattern.
// pan (model/trackChannel.js#pan) is a live engine parameter (webdsp's NodeParam.BusPan), unlike
// volume above (a compile-time-only multiplier — ARCHITECTURE.md's "Instrument/track gain
// staging") — it needs the model+engine push fxController already bundles for every other
// bus-level control (ui/chrome/FxPanel.jsx's own bus.gain/pan controls use the same object), so
// this calls fxController.setTrackPan rather than a bare store method the way volume/mute/solo
// do.
function ChannelStrip({ store, fxController, trackIndex }) {
  const name = store.getState().song.trackChannels[trackIndex].name;
  const muted = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].muted);
  const solo = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].solo);
  const volume = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].volume);
  const pan = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].pan);

  return (
    <div className="channel-strip">
      <span className="channel-strip__name">{name}</span>
      <span
        className="channel-strip__clip"
        data-clip-track={trackIndex}
        title="Lights red when this track clips (peaks at 0 dBFS or above)"
      />
      <div className="channel-strip__volume-track">
        <input
          className="channel-strip__volume range-lg"
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={volume}
          onChange={(e) => store.setTrackChannelVolume(trackIndex, Number(e.target.value))}
          title={`Volume: ${volume.toFixed(2)}`}
          style={rangeFillStyle(volume, 0, 1.5)}
        />
      </div>
      <div className="channel-strip__pan-track">
        <input
          className="channel-strip__pan"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          onChange={(e) => fxController.setTrackPan(trackIndex, Number(e.target.value))}
          title={`Pan: ${pan.toFixed(2)}`}
        />
      </div>
      <div className="channel-strip__switches">
        <button
          className={`channel-strip__mute${muted ? " channel-strip__mute--active" : ""}`}
          onClick={() => store.setTrackChannelMuted(trackIndex, !muted)}
          title="Mute"
        >
          M
        </button>
        <button
          className={`channel-strip__solo${solo ? " channel-strip__solo--active" : ""}`}
          onClick={() => store.setTrackChannelSolo(trackIndex, !solo)}
          title="Solo"
        >
          S
        </button>
      </div>
    </div>
  );
}

// The final output channel: pinned to the right edge while the tracks scroll, carrying the one
// detailed level meter (a column of LEDs, the top few red). The meter shows the mix level
// *feeding* webdsp's master limiter, so red means the limiter is working. Updated straight from
// the engine's peak stream by useMixerMeters (no React state); see webdsp docs/master-limiter.md.
function MasterStrip() {
  return (
    <div className="channel-strip channel-strip--master" data-master-strip>
      <span className="channel-strip__name">MASTER</span>
      <div className="meter" role="img" aria-label="Master level">
        {/* Highest LED first, so the danger region sits on top like a level meter. */}
        {METER_LED_DB.map((db, i) => (
          <span key={db} className="meter-led" data-meter-led title={`${db} dBFS`} style={{ order: METER_LED_DB.length - i }} />
        ))}
      </div>
      <span className="channel-strip__limiter">LIMITER</span>
    </div>
  );
}

// A compact horizontal row of per-track channel strips, placed below the tracker grid (see
// App.jsx), ending in the Master strip. Same store wiring as the old TrackHeaders — only the
// layout/markup changed.
export default function Mixer({ store, fxController }) {
  const { trackCount } = store.getState().song;
  const rootRef = useRef(null);
  useMixerMeters(rootRef);

  return (
    <div className="mixer" ref={rootRef}>
      {Array.from({ length: trackCount }, (_, i) => (
        <ChannelStrip key={i} store={store} fxController={fxController} trackIndex={i} />
      ))}
      <MasterStrip />
    </div>
  );
}
