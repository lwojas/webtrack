// The complete set of store event names (ECS-156 plan §4/§9). Vanilla UI modules subscribe
// directly via store.subscribe(EVENT, handler); React chrome components go through
// state/useStore.js's useSyncExternalStore wrapper — both read the same store.
export const CELL_CHANGED = "CELL_CHANGED";
export const CURSOR_MOVED = "CURSOR_MOVED";
export const BANK_SELECTED = "BANK_SELECTED";
export const PATTERN_SELECTED = "PATTERN_SELECTED";
export const TRANSPORT_CHANGED = "TRANSPORT_CHANGED";
export const TRACK_CHANNEL_CHANGED = "TRACK_CHANNEL_CHANGED";
export const PATTERN_SWITCH_PENDING = "PATTERN_SWITCH_PENDING";
export const INSTRUMENTS_CHANGED = "INSTRUMENTS_CHANGED";
export const PATTERN_LENGTH_CHANGED = "PATTERN_LENGTH_CHANGED";
export const PROJECT_NAME_CHANGED = "PROJECT_NAME_CHANGED";
