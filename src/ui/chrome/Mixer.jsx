import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";

// model/mutations.js mutates a trackChannel object in place (same reference before/after —
// see ARCHITECTURE.md's in-place-mutation gotcha) — useSyncExternalStore compares snapshots
// with Object.is, so a selector must return the primitive fields that actually changed, not
// the mutable container object itself, or React never detects the change. The name never
// changes after creation, so it's read once outside any hook rather than subscribed to.
function ChannelStrip({ store, trackIndex }) {
  const name = store.getState().song.trackChannels[trackIndex].name;
  const muted = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].muted);
  const solo = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].solo);
  const volume = useStore(store, events.TRACK_CHANNEL_CHANGED, (s) => s.song.trackChannels[trackIndex].volume);

  return (
    <div className="channel-strip">
      <span className="channel-strip__name">{name}</span>
      <div className="channel-strip__volume-track">
        <input
          className="channel-strip__volume"
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={volume}
          onChange={(e) => store.setTrackChannelVolume(trackIndex, Number(e.target.value))}
          title={`Volume: ${volume.toFixed(2)}`}
        />
      </div>
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
  );
}

// A compact horizontal row of per-track channel strips, placed below the tracker grid (see
// App.jsx). Same store wiring as the old TrackHeaders — only the layout/markup changed.
export default function Mixer({ store }) {
  const { trackCount } = store.getState().song;

  return (
    <div className="mixer">
      {Array.from({ length: trackCount }, (_, i) => (
        <ChannelStrip key={i} store={store} trackIndex={i} />
      ))}
    </div>
  );
}
