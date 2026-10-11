// Direct, in-place mutation of the plain object tree, not copy-on-write — MVP has no
// undo/history requirement, so structural sharing would be pure overhead (see ECS-156 plan
// §5). Callers (state/store.js) are responsible for emitting the matching change event.
import { createEmptyEvent, cloneEvent } from "./event.js";
import { getEvent, getPattern, getTrackChannel } from "./query.js";

export function setEventField(song, { bankIndex, patternIndex, trackIndex, rowIndex }, field, value) {
  const event = getEvent(song, bankIndex, patternIndex, trackIndex, rowIndex);
  if (!event) return;
  event[field] = value;
}

export function clearEvent(song, { bankIndex, patternIndex, trackIndex, rowIndex }) {
  const track = getPattern(song, bankIndex, patternIndex)?.tracks[trackIndex];
  if (!track) return;
  track.events[rowIndex] = createEmptyEvent();
}

// Replaces the target slot's event outright with a clone of sourceEvent — never the same
// object reference, so pasting the same clipboard event into several cells never lets an edit
// to one cell leak into another (see model/event.js#cloneEvent).
export function pasteEvent(song, { bankIndex, patternIndex, trackIndex, rowIndex }, sourceEvent) {
  const track = getPattern(song, bankIndex, patternIndex)?.tracks[trackIndex];
  if (!track) return;
  track.events[rowIndex] = cloneEvent(sourceEvent);
}

export function setSongName(song, name) {
  song.name = name;
}

export function setTrackChannelMuted(song, trackIndex, muted) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.muted = muted;
}

export function setTrackChannelSolo(song, trackIndex, solo) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.solo = solo;
}

export function setTrackChannelVolume(song, trackIndex, volume) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.volume = volume;
}

export function setActivePatternIndex(song, bankIndex, patternIndex) {
  const bank = song.banks[bankIndex];
  if (bank?.patterns[patternIndex]) bank.activePatternIndex = patternIndex;
}

// Resizes every track's event array to match a new sequence length. Growing preserves all
// existing notes (new rows start empty); shrinking intentionally drops any notes sitting past
// the new boundary — the caller is deliberately shortening the sequence, so silently keeping
// unreachable trailing events would just be dead data the grid can no longer show or edit.
export function setPatternRowCount(song, bankIndex, patternIndex, newRowCount) {
  const pattern = getPattern(song, bankIndex, patternIndex);
  if (!pattern || newRowCount === pattern.rowCount) return;

  const oldRowCount = pattern.rowCount;
  pattern.tracks.forEach((track) => {
    if (newRowCount > oldRowCount) {
      for (let i = oldRowCount; i < newRowCount; i++) track.events.push(createEmptyEvent());
    } else {
      track.events.length = newRowCount;
    }
  });
  pattern.rowCount = newRowCount;
}
