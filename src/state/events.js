// The complete set of store event names (ECS-156 plan §4/§9). Vanilla UI modules subscribe
// directly via store.subscribe(EVENT, handler); React chrome components go through
// state/useStore.js's useSyncExternalStore wrapper — both read the same store.
export const CELL_CHANGED = "CELL_CHANGED";
export const CURSOR_MOVED = "CURSOR_MOVED";
export const PATTERN_SELECTED = "PATTERN_SELECTED";
// The pattern pool or queue changed shape (a pattern was created, an existing one was
// requeued, or a queue slot was removed) — distinct from PATTERN_SELECTED, which fires when
// *which* pattern is being edited changes, not when the queue's contents do.
export const PATTERN_QUEUE_CHANGED = "PATTERN_QUEUE_CHANGED";
export const TRANSPORT_CHANGED = "TRANSPORT_CHANGED";
export const TRACK_CHANNEL_CHANGED = "TRACK_CHANNEL_CHANGED";
export const PATTERN_SWITCH_PENDING = "PATTERN_SWITCH_PENDING";
export const INSTRUMENTS_CHANGED = "INSTRUMENTS_CHANGED";
export const PATTERN_LENGTH_CHANGED = "PATTERN_LENGTH_CHANGED";
// One track's own playback loop length, within the selected pattern, changed (model/pattern.js
// / model/mutations.js#setTrackLength) — distinct from PATTERN_LENGTH_CHANGED, which is the
// whole pattern's shared grid/rowCount.
export const TRACK_LENGTH_CHANGED = "TRACK_LENGTH_CHANGED";
export const PROJECT_NAME_CHANGED = "PROJECT_NAME_CHANGED";
// A track's insert-bus FX baseline changed (model/trackChannel.js#fx) — fired by both the FX
// panel (a slider drag) and playback's cell-automation path (see appContext.js's wiring of
// playbackController's onTrackFxChange).
export const TRACK_FX_CHANGED = "TRACK_FX_CHANGED";
// The master bus's own FX baseline changed (model/song.js#masterFx) — the FX panel's MASTER
// view only.
export const MASTER_FX_CHANGED = "MASTER_FX_CHANGED";
