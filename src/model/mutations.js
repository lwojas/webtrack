// Direct, in-place mutation of the plain object tree, not copy-on-write — MVP has no
// undo/history requirement, so structural sharing would be pure overhead (see ECS-156 plan
// §5). Callers (state/store.js) are responsible for emitting the matching change event.
import { createEmptyEvent, cloneEvent } from "./event.js";
import { createPattern } from "./pattern.js";
import { getEvent, getPattern, getTrackChannel } from "./query.js";
import { getFxParamsForType, getFxTypeForParam } from "./fxParams.js";
import { VOICE_MODES } from "./trackChannel.js";

export function setEventField(song, { patternId, trackIndex, rowIndex }, field, value) {
  const event = getEvent(song, patternId, trackIndex, rowIndex);
  if (!event) return;
  event[field] = value;
}

export function clearEvent(song, { patternId, trackIndex, rowIndex }) {
  const track = getPattern(song, patternId)?.tracks[trackIndex];
  if (!track) return;
  track.events[rowIndex] = createEmptyEvent();
}

// Replaces the target slot's event outright with a clone of sourceEvent — never the same
// object reference, so pasting the same clipboard event into several cells never lets an edit
// to one cell leak into another (see model/event.js#cloneEvent).
export function pasteEvent(song, { patternId, trackIndex, rowIndex }, sourceEvent) {
  const track = getPattern(song, patternId)?.tracks[trackIndex];
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

// A track's voice-allocation policy (model/trackChannel.js's doc comment) — enforced by
// audio/voiceTracker.js, not here; this just stores the setting. Rejects an unknown mode
// outright rather than storing garbage the engine would have to treat as poly by default.
export function setTrackChannelVoiceMode(song, trackIndex, voiceMode) {
  if (!VOICE_MODES.includes(voiceMode)) return;
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.voiceMode = voiceMode;
}

// Clamped to a sane minimum of 1 (a track with maxVoices = 0 could never sound at all) but not
// to any particular maximum from the UI's own dropdown — a project could carry a value the
// current UI doesn't offer (a future bigger option, or hand-edited JSON) without this clobbering
// it, matching setTrackLength's own "clamp the nonsense, trust the rest" approach below.
export function setTrackChannelMaxVoices(song, trackIndex, maxVoices) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  channel.maxVoices = Math.max(1, Math.round(maxVoices));
}

// A track's insert-bus FX baseline (model/trackChannel.js#fx) — called by both the FX panel
// (a user dragging a slider) and playback's cell-automation path (audio/compile.js's
// compileRowFx, via appContext.js's wiring), so the model and whatever's actually sounding
// never disagree about a track's current FX state. value === null removes the entry instead of
// storing it, matching setCellFxParam's own null-means-unset convention below.
export function setTrackFxParam(song, trackIndex, paramId, value) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  if (value === null || value === undefined) {
    delete channel.fx[paramId];
    return;
  }
  channel.fx[paramId] = value;
}

// The master bus's own FX baseline (model/song.js#masterFx) — the FX panel's MASTER view only;
// never reachable from a tracker cell (see audio/compile.js#compileRowFx's doc comment).
export function setMasterFxParam(song, paramId, value) {
  if (value === null || value === undefined) {
    delete song.masterFx[paramId];
    return;
  }
  song.masterFx[paramId] = value;
}

// Shared by setCellFxParam's own null-removal below and removeTrackFx's chain-removal purge
// further down — deletes one key from a cell's sparse fx map, collapsing back to `fx: null`
// once the map is empty (never left as `{}` — see createEmptyEvent/isEmptyEvent).
function removeFxEntry(event, paramId) {
  if (!event.fx || !(paramId in event.fx)) return;
  delete event.fx[paramId];
  if (Object.keys(event.fx).length === 0) event.fx = null;
}

// A cell's sparse FX automation map (model/event.js#fx). Unlike setEventField, this doesn't
// replace a whole field — it adds/updates/removes one entry in the cell's fx map, leaving
// every other key (and every other field) untouched. value === null removes paramId from the
// cell entirely rather than storing a literal null — a cell with no fx automation should look
// exactly like one that never had any, not carry around empty-value entries that playback
// would then have to special-case.
//
// A new value is refused outright if paramId's FX isn't currently enabled on this track
// (model/trackChannel.js#fxChain) — a cell can automate an active FX's parameters, but it can
// never be the thing that activates one (the brief's rule). bus.gain (whose type is null, see
// model/fxParams.js) is exempt — it's always on, not part of any chain.
export function setCellFxParam(song, { patternId, trackIndex, rowIndex }, paramId, value) {
  const event = getEvent(song, patternId, trackIndex, rowIndex);
  if (!event) return;

  if (value === null || value === undefined) {
    removeFxEntry(event, paramId);
    return;
  }

  const fxType = getFxTypeForParam(paramId);
  if (fxType !== null) {
    const channel = getTrackChannel(song, trackIndex);
    if (!channel?.fxChain.some((entry) => entry.type === fxType)) return;
  }

  if (!event.fx) event.fx = {};
  event.fx[paramId] = value;
}

// Enables one FX_TYPES id on a track's insert bus (ui/chrome/FxPanel.jsx's "+ ADD FX") — a
// no-op if it's already active. Never resets trackChannel.fx's stored values: seeds any param
// that's never been touched to its catalog default, but leaves an already-set value alone, so
// re-enabling a previously-removed FX picks up where it left off instead of resetting (see
// model/trackChannel.js's doc comment on the three-layer fxChain/fx model).
export function addTrackFx(song, trackIndex, type) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel || channel.fxChain.some((entry) => entry.type === type)) return;
  channel.fxChain.push({ type, bypassed: false });
  for (const param of getFxParamsForType(type)) {
    if (!(param.id in channel.fx)) channel.fx[param.id] = param.default;
  }
}

// Disables one FX_TYPES id (the FX panel's remove button) — removes it from fxChain and purges
// every pattern's cell automation on this track that referenced one of its params, so no
// Event.fx entry can ever point at an FX this track no longer has enabled. Paired with
// setCellFxParam's own validation above (which refuses *new* writes for an inactive type) —
// between the two, a cell can never reference a disabled FX, enforced at the model layer
// rather than as a defensive check threaded through playback.
export function removeTrackFx(song, trackIndex, type) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  const chainIndex = channel.fxChain.findIndex((entry) => entry.type === type);
  if (chainIndex === -1) return;
  channel.fxChain.splice(chainIndex, 1);

  const paramIds = getFxParamsForType(type).map((param) => param.id);
  song.patterns.forEach((pattern) => {
    pattern.tracks[trackIndex]?.events.forEach((event) => {
      paramIds.forEach((paramId) => removeFxEntry(event, paramId));
    });
  });
}

// Mutes/un-mutes one already-enabled FX without removing it from the chain or touching its
// stored values (model/trackChannel.js's doc comment contrasts this with removeTrackFx above).
// Flips the flag the FX panel and audio/fx.js's engine push both read; this function alone
// doesn't touch the audio engine (see appContext.js's fxController for the bundling).
export function setTrackFxBypass(song, trackIndex, type, bypassed) {
  const entry = getTrackChannel(song, trackIndex)?.fxChain.find((e) => e.type === type);
  if (entry) entry.bypassed = bypassed;
}

// Master-bus equivalents of addTrackFx/removeTrackFx/setTrackFxBypass above (model/song.js's
// masterFx/masterFxChain) — no cell-automation purge needed on removal, since a tracker cell
// can never automate the master bus in the first place.
export function addMasterFx(song, type) {
  if (song.masterFxChain.some((entry) => entry.type === type)) return;
  song.masterFxChain.push({ type, bypassed: false });
  for (const param of getFxParamsForType(type)) {
    if (!(param.id in song.masterFx)) song.masterFx[param.id] = param.default;
  }
}

export function removeMasterFx(song, type) {
  const index = song.masterFxChain.findIndex((entry) => entry.type === type);
  if (index !== -1) song.masterFxChain.splice(index, 1);
}

export function setMasterFxBypass(song, type, bypassed) {
  const entry = song.masterFxChain.find((e) => e.type === type);
  if (entry) entry.bypassed = bypassed;
}

// The tracker edits whichever pattern this points at — only ever repointed to a patternId that
// actually exists in song.patterns, so a stale/typo'd id can never leave the project with no
// resolvable selected pattern.
export function selectPattern(song, patternId) {
  if (song.patterns.some((pattern) => pattern.id === patternId)) song.selectedPatternId = patternId;
}

// Resizes every track's event array to match a new sequence length. Growing preserves all
// existing notes (new rows start empty); shrinking intentionally drops any notes sitting past
// the new boundary — the caller is deliberately shortening the sequence, so silently keeping
// unreachable trailing events would just be dead data the grid can no longer show or edit.
//
// Each track's playback `length` (model/pattern.js) rides along: a track that still matches
// the *old* rowCount exactly (the default, untouched-by-the-user case) is resized right along
// with the grid, so existing 16-step-style projects keep behaving exactly as they do today. A
// track whose length was explicitly set to something else is left alone, except when the grid
// shrinks past it — a track can never claim to loop over more steps than the grid now has.
export function setPatternRowCount(song, patternId, newRowCount) {
  const pattern = getPattern(song, patternId);
  if (!pattern || newRowCount === pattern.rowCount) return;

  const oldRowCount = pattern.rowCount;
  pattern.tracks.forEach((track) => {
    const matchedOldRowCount = track.length === oldRowCount;

    if (newRowCount > oldRowCount) {
      for (let i = oldRowCount; i < newRowCount; i++) track.events.push(createEmptyEvent());
    } else {
      track.events.length = newRowCount;
    }

    track.length = matchedOldRowCount ? newRowCount : Math.min(track.length, newRowCount);
  });
  pattern.rowCount = newRowCount;
}

// A track's own playback loop length (model/pattern.js's doc comment), clamped to between 1
// step and however many rows the track actually has — it can never claim to loop over more
// steps than exist to play. Never touches `events`: shortening playback length is reversible
// (lengthening it again brings the same notes right back), unlike setPatternRowCount's
// shrink path, which really does drop trailing notes.
export function setTrackLength(song, patternId, trackIndex, length) {
  const track = getPattern(song, patternId)?.tracks[trackIndex];
  if (!track) return;
  track.length = Math.max(1, Math.min(Math.round(length), track.events.length));
}

// Creates a brand-new pattern, adds it to the pool, appends it to the end of the queue, and
// selects it — the Pattern Manager's "+ NEW PATTERN" action. Never leaves the queue without
// this new entry, so there's no separate "add" step that could be skipped.
export function addPattern(song, { name } = {}) {
  const pattern = createPattern({
    id: song.nextPatternId++,
    trackCount: song.trackCount,
    rowCount: song.rowCount,
    name: name ?? `Pattern ${song.patterns.length + 1}`,
  });
  song.patterns.push(pattern);
  song.patternQueue.push(pattern.id);
  song.selectedPatternId = pattern.id;
  return pattern;
}

// Appends an *existing* pattern's id to the end of the queue again — the queue is a list of
// pattern references, not unique occurrences, so this is deliberately just a push, never a
// clone of the pattern's data (see model/song.js's doc comment).
export function appendPatternToQueue(song, patternId) {
  if (!song.patterns.some((pattern) => pattern.id === patternId)) return;
  song.patternQueue.push(patternId);
}

// Removes one queue slot by position (not by id — the same pattern id may occupy several
// slots, and only one of them should go). Refuses to empty the queue. If the removed slot held
// the currently selected pattern and no other slot still references that id, falls back to
// whatever now sits at the same (clamped) position, so selectedPatternId always resolves.
export function removeFromPatternQueue(song, queueIndex) {
  if (song.patternQueue.length <= 1) return;
  if (queueIndex < 0 || queueIndex >= song.patternQueue.length) return;

  song.patternQueue.splice(queueIndex, 1);

  if (!song.patternQueue.includes(song.selectedPatternId)) {
    const fallbackIndex = Math.min(queueIndex, song.patternQueue.length - 1);
    song.selectedPatternId = song.patternQueue[fallbackIndex];
  }
}

// Creates an independent copy of an existing pattern — a new stable id, a deep clone of every
// track's events (model/event.js#cloneEvent), so editing one can never touch the other. Added
// to the pool right after its source and selected, but deliberately *not* queued — duplicating
// a pattern and adding another occurrence of one to the queue are different operations (see
// appendPatternToQueue above and ui/chrome/PatternManager.jsx); the caller queues the
// duplicate explicitly if it should play.
export function duplicatePattern(song, patternId) {
  const source = getPattern(song, patternId);
  if (!source) return undefined;

  const duplicate = {
    id: song.nextPatternId++,
    name: `${source.name} copy`,
    rowCount: source.rowCount,
    tracks: source.tracks.map((track) => ({ events: track.events.map(cloneEvent), length: track.length })),
  };

  song.patterns.splice(song.patterns.indexOf(source) + 1, 0, duplicate);
  song.selectedPatternId = duplicate.id;
  return duplicate;
}

// Removes a pattern from the pool entirely, and every queue slot that referenced it — distinct
// from removeFromPatternQueue, which drops one queue *slot* but leaves the pattern itself in
// the pool. Refuses when it's the only pattern left (the pool, like the queue, can never go
// empty). If every queue slot referenced the deleted pattern, falls back to queuing whatever
// pattern is now first in the pool, rather than leaving the queue empty — and if the deleted
// pattern was selected, falls back to whatever now leads the queue.
export function deletePattern(song, patternId) {
  if (song.patterns.length <= 1) return;

  const index = song.patterns.findIndex((pattern) => pattern.id === patternId);
  if (index === -1) return;

  song.patterns.splice(index, 1);
  song.patternQueue = song.patternQueue.filter((id) => id !== patternId);
  if (song.patternQueue.length === 0) song.patternQueue.push(song.patterns[0].id);

  if (song.selectedPatternId === patternId) {
    song.selectedPatternId = song.patternQueue[0];
  }
}

// Inline rename from the Pattern Manager's list — part of the pattern's persisted data, not
// transient UI state. An empty/whitespace-only name is rejected rather than stored, so a
// pattern can never end up with a blank label; the caller's input simply keeps showing the
// last valid name.
export function renamePattern(song, patternId, name) {
  const pattern = getPattern(song, patternId);
  if (!pattern) return;
  const trimmed = name.trim();
  if (trimmed) pattern.name = trimmed;
}
