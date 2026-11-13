// Every MIDI CC-controllable function, specified once as data. To make something controllable, add one entry here:
// the map (ccMap.js), the router (ccController.js) and the MIDI MAP view (ui/chrome/MidiMapView.jsx) all read this table
// and need no other change. A new entry's default binding is picked up automatically, because only the user's *changes*
// are saved (ccMap.js), never a full copy of the defaults.
//
// An entry is { id, label, group, scope, kind, default: { cc, channel? }, apply(ctx, index, value, raw) }:
//   scope  "strip"  one instance per mixer strip; the MIDI channel selects the strip (channel 1 = strip 1 ... 16), so only the
//                   CC number is configurable.
//          "global" a single control on a fixed MIDI channel (default.channel, 0-based) and CC.
//   kind   "continuous" follows the value; `value` is raw / 127 (0..1) and `raw` the 0..127 CC value. Writes are coalesced to
//                   one per animation frame per control, so a fast fader sweep costs one store update per frame.
//          "toggle" / "trigger" act once on a press (CC value >= 64); the release (value < 64) is ignored, so a momentary
//                   button works the same as a latching one. A toggle flips its state, a trigger just fires.
//   apply  `index` is the strip (0-based) for a strip control, 0 otherwise. ctx = { store, fxController, playbackController,
//          togglePlayback }.
export const STRIP_COUNT = 16;
export const PRESS_THRESHOLD = 64;

const VOLUME_MAX = 1.5; // the mixer fader's own range (ui/chrome/Mixer.jsx)

const channelOf = (ctx, index) => ctx.store.getState().song.trackChannels[index];

export const CC_CONTROLS = [
  {
    id: "strip.volume",
    label: "Volume",
    group: "Mixer strips",
    scope: "strip",
    kind: "continuous",
    default: { cc: 7 },
    apply: (ctx, index, value) => {
      if (channelOf(ctx, index)) ctx.store.setTrackChannelVolume(index, value * VOLUME_MAX);
    },
  },
  {
    id: "strip.pan",
    label: "Pan",
    group: "Mixer strips",
    scope: "strip",
    kind: "continuous",
    default: { cc: 10 },
    // 64 is centre (as on a hardware pan knob), 0 is full left, 127 full right.
    apply: (ctx, index, _value, raw) => {
      if (channelOf(ctx, index)) ctx.fxController.setTrackPan(index, Math.max(-1, Math.min(1, (raw - 64) / 63)));
    },
  },
  {
    id: "strip.solo",
    label: "Solo",
    group: "Mixer strips",
    scope: "strip",
    kind: "toggle",
    default: { cc: 21 },
    apply: (ctx, index) => {
      const channel = channelOf(ctx, index);
      if (channel) ctx.store.setTrackChannelSolo(index, !channel.solo);
    },
  },
  {
    id: "strip.mute",
    label: "Mute",
    group: "Mixer strips",
    scope: "strip",
    kind: "toggle",
    default: { cc: 20 },
    apply: (ctx, index) => {
      const channel = channelOf(ctx, index);
      if (channel) ctx.store.setTrackChannelMuted(index, !channel.muted);
    },
  },
  {
    id: "transport.play",
    label: "Play",
    group: "Transport",
    scope: "global",
    kind: "trigger",
    default: { cc: 45, channel: 0 },
    // Play never stops: pressing it while playing does nothing (Stop is its own control).
    apply: (ctx) => {
      if (!ctx.playbackController.isPlaying()) ctx.togglePlayback();
    },
  },
  {
    id: "transport.record",
    label: "Record",
    group: "Transport",
    scope: "global",
    kind: "toggle",
    default: { cc: 44, channel: 0 },
    // The same record arm as the transport bar's REC button (store.editMode).
    apply: (ctx) => ctx.store.toggleEditMode(),
  },
  {
    id: "transport.stop",
    label: "Stop",
    group: "Transport",
    scope: "global",
    kind: "trigger",
    default: { cc: 46, channel: 0 },
    apply: (ctx) => ctx.playbackController.stop(),
  },
];

export const CC_CONTROL_BY_ID = new Map(CC_CONTROLS.map((def) => [def.id, def]));
export const CC_GROUPS = [...new Set(CC_CONTROLS.map((def) => def.group))];
