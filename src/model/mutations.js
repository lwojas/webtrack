// Direct, in-place mutation of the plain object tree, not copy-on-write — MVP has no
// undo/history requirement, so structural sharing would be pure overhead (see ECS-156 plan
// §5). Callers (state/store.js) are responsible for emitting the matching change event.
import { createEmptyEvent, cloneEvent } from "./event.js";
import { createPattern } from "./pattern.js";
import { getEvent, getPattern, getTrackChannel } from "./query.js";
import { getFxParamsForType } from "./fxParams.js";
import { MAX_INSTRUMENT_LFOS, createLfo, patchLfo } from "./instrumentLfos.js";
import { BUS_GAIN_KEY, fxKey, getAutomationParam, parseKey } from "./cellAutomation.js";
import { VOICE_MODES } from "./trackChannel.js";
import { eventLfoOf, normalizeParticipation, patchEventLfo } from "./eventLfo.js";
import { arpOf, patchArp } from "./arp.js";
import { patchScale, scaleOf } from "./scale.js";

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

// A track's insert-bus `bus.gain` — the one FX_PARAMS entry with `type: null` (model/fxParams.js)
// — the only thing this function has ever addressed, and still does: it never touches a chain
// instance's own values (see setTrackFxInstanceParam below for those). Called by both the FX
// panel's pinned Output module (a user dragging the Bus Gain slider) and playback's cell
// automation path (audio/compile.js's compileRowFx, via appContext.js's wiring). value === null
// removes the entry instead of storing it, matching setCellFxParam's own null-means-unset
// convention below.
export function setTrackFxParam(song, trackIndex, paramId, value) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  if (value === null || value === undefined) {
    delete channel.fx[paramId];
    return;
  }
  channel.fx[paramId] = value;
}

// Master-bus equivalent of setTrackFxParam above (model/song.js#masterFx's own flat "bus.gain"
// entry) — the FX panel's MASTER view only; never reachable from a tracker cell.
export function setMasterFxParam(song, paramId, value) {
  if (value === null || value === undefined) {
    delete song.masterFx[paramId];
    return;
  }
  song.masterFx[paramId] = value;
}

// One chain instance's own parameter value (model/trackChannel.js#fx's `instances[id]` bag) —
// the stacking-aware counterpart to setTrackFxParam above, for every param that *does* belong to
// a chain entry (i.e. everything except bus.gain). Two instances of the same type never share a
// bag, so editing one Filter's cutoff can never touch another Filter's. value === null removes
// just that one param from that one instance's bag.
export function setTrackFxInstanceParam(song, trackIndex, instanceId, paramId, value) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  const bag = (channel.fx.instances ??= {});
  if (value === null || value === undefined) {
    delete bag[instanceId]?.[paramId];
    return;
  }
  (bag[instanceId] ??= {})[paramId] = value;
}

export function setMasterFxInstanceParam(song, instanceId, paramId, value) {
  const bag = (song.masterFx.instances ??= {});
  if (value === null || value === undefined) {
    delete bag[instanceId]?.[paramId];
    return;
  }
  (bag[instanceId] ??= {})[paramId] = value;
}

// Prunes what a removal can leave behind in a cell's fx map: empty bags, glide flags whose value is
// gone, and the whole map once nothing is left (`fx: null`, never `{}` — createEmptyEvent /
// isEmptyEvent). Safe to call after any edit.
function normalizeFx(event) {
  const fx = event.fx;
  if (!fx) return;
  for (const scope of ["instances", "instruments"]) {
    if (!fx[scope]) continue;
    for (const id in fx[scope]) if (Object.keys(fx[scope][id]).length === 0) delete fx[scope][id];
    if (Object.keys(fx[scope]).length === 0) delete fx[scope];
  }
  if (fx.glide) {
    for (const key in fx.glide) {
      const t = parseKey(key);
      const present =
        t &&
        (t.kind === "bus"
          ? fx[BUS_GAIN_KEY] !== undefined
          : t.kind === "fx"
            ? fx.instances?.[t.instanceId]?.[t.paramId] !== undefined
            : fx.instruments?.[t.slot]?.[t.paramId] !== undefined);
      if (!present) delete fx.glide[key];
    }
    if (Object.keys(fx.glide).length === 0) delete fx.glide;
  }
  if (Object.keys(fx).length === 0) event.fx = null;
}

// Shared by setCellFxParam's own null-removal below and removeTrackFx's chain-removal purge
// further down — deletes the flat "bus.gain" key from a cell's sparse fx map, collapsing back to
// `fx: null` once the map is empty (never left as `{}` — see createEmptyEvent/isEmptyEvent).
function removeFxEntry(event, paramId) {
  if (!event.fx || !(paramId in event.fx)) return;
  delete event.fx[paramId];
  normalizeFx(event);
}

// Stacking-aware counterpart to removeFxEntry above — deletes one param from one instance's bag
// inside a cell's sparse fx.instances map, collapsing empty bags/the whole map back to nothing
// the same way removeFxEntry does for the flat bus.gain key.
function removeCellFxInstanceEntry(event, instanceId, paramId) {
  const bag = event.fx?.instances?.[instanceId];
  if (!bag || !(paramId in bag)) return;
  delete bag[paramId];
  normalizeFx(event);
}

// A cell's sparse FX automation for the always-on bus.gain param only (model/event.js#fx's flat
// top-level key) — see setCellFxInstanceParam below for every chain-instance param. Unlike
// setEventField, this doesn't replace a whole field — it adds/updates/removes just this one key,
// leaving every other field (and every instance bag) untouched. value === null removes it
// entirely rather than storing a literal null, so a cell with no fx automation left looks exactly
// like one that never had any.
export function setCellFxParam(song, { patternId, trackIndex, rowIndex }, paramId, value) {
  const event = getEvent(song, patternId, trackIndex, rowIndex);
  if (!event) return;

  if (value === null || value === undefined) {
    removeFxEntry(event, paramId);
    return;
  }

  if (!event.fx) event.fx = {};
  event.fx[paramId] = value;
}

// Stacking-aware counterpart to setCellFxParam above, for a specific chain instance's parameter
// (model/event.js#fx's `instances[instanceId]` bag) — e.g. automating the *second* of two
// Filters on this track, unambiguously. value === null removes just that entry.
//
// A new value is refused outright if instanceId isn't currently in this track's fxChain
// (model/trackChannel.js#fxChain) — a cell can automate an existing instance's parameters, but
// it can never be the thing that creates one (the brief's rule, now enforced per-instance rather
// than per-type).
export function setCellFxInstanceParam(song, { patternId, trackIndex, rowIndex }, instanceId, paramId, value) {
  const event = getEvent(song, patternId, trackIndex, rowIndex);
  if (!event) return;

  if (value === null || value === undefined) {
    removeCellFxInstanceEntry(event, instanceId, paramId);
    return;
  }

  const channel = getTrackChannel(song, trackIndex);
  if (!channel?.fxChain.some((entry) => entry.id === instanceId)) return;

  if (!event.fx) event.fx = {};
  if (!event.fx.instances) event.fx.instances = {};
  if (!event.fx.instances[instanceId]) event.fx.instances[instanceId] = {};
  event.fx.instances[instanceId][paramId] = value;
}

// One automation entry of a cell, whatever it targets (model/cellAutomation.js's key scheme):
// "bus.gain", "fx:<instance>:<param>" or "inst:<slot>:<param>". `value` null/undefined removes the
// entry (and its glide flag). A new value is refused if the target does not exist (an FX instance
// not in this track's chain, an instrument slot or parameter that is not there) and is clamped to
// the parameter's range. `glide` (true/false, when given) marks the entry as a ramp to the next
// value of the same parameter on the track; it is dropped with the value.
//
// `instruments` is the song's instrument slots (state/store.js's `state.instruments`): instruments
// are global, so the model needs them to validate an "inst:" key. Returns true if the cell changed.
export function setCellAutomation(song, instruments, { patternId, trackIndex, rowIndex }, key, value, { glide } = {}) {
  const event = getEvent(song, patternId, trackIndex, rowIndex);
  const t = parseKey(key);
  if (!event || !t) return false;

  if (value === null || value === undefined) {
    if (!event.fx) return false;
    if (t.kind === "bus") delete event.fx[BUS_GAIN_KEY];
    else if (t.kind === "fx") delete event.fx.instances?.[t.instanceId]?.[t.paramId];
    else delete event.fx.instruments?.[t.slot]?.[t.paramId];
    normalizeFx(event);
    return true;
  }

  const channel = getTrackChannel(song, trackIndex);
  const param = getAutomationParam(key, channel, instruments);
  if (!param || !Number.isFinite(value)) return false;
  const clamped = Math.min(param.max, Math.max(param.min, value));

  event.fx ??= {};
  if (t.kind === "bus") event.fx[BUS_GAIN_KEY] = clamped;
  else if (t.kind === "fx") ((event.fx.instances ??= {})[t.instanceId] ??= {})[t.paramId] = clamped;
  else ((event.fx.instruments ??= {})[t.slot] ??= {})[t.paramId] = clamped;
  // Glide needs a scheduled ramp (webdsp scheduleParams), which bus gain does not have: it only steps.
  if (glide === true && t.kind !== "bus") (event.fx.glide ??= {})[key] = true;
  else if (glide === false && event.fx.glide) delete event.fx.glide[key];
  normalizeFx(event);
  return true;
}

// Replaces the points of one lane (a key) in rows [fromRow, toRow] of one track with `points`
// ([{ row, value, glide? }]), leaving every other row and parameter alone: how an automation
// template or a whole-lane edit lands. Out-of-range rows and refused values (see
// setCellAutomation) are skipped. Returns the rows that changed, for the caller's change events.
export function replaceTrackAutomationRange(song, instruments, { patternId, trackIndex }, key, fromRow, toRow, points) {
  const pattern = getPattern(song, patternId);
  const track = pattern?.tracks[trackIndex];
  if (!track) return [];
  const changed = [];
  const lo = Math.max(0, Math.min(fromRow, toRow));
  const hi = Math.min(track.events.length - 1, Math.max(fromRow, toRow));
  for (let row = lo; row <= hi; row++) {
    if (setCellAutomation(song, instruments, { patternId, trackIndex, rowIndex: row }, key, null)) changed.push(row);
  }
  for (const point of points) {
    if (point.row < 0 || point.row >= track.events.length) continue;
    if (setCellAutomation(song, instruments, { patternId, trackIndex, rowIndex: point.row }, key, point.value, { glide: Boolean(point.glide) })) {
      if (!changed.includes(point.row)) changed.push(point.row);
    }
  }
  return changed;
}

// Drops every cell's automation of one instrument slot, in every pattern and track. Called when
// the slot stops being what the entries addressed (its synth kind changed, or it was switched
// between synth, sample and MIDI), so a cell can never name a parameter the slot no longer has.
export function purgeInstrumentAutomation(song, slotIndex) {
  song.patterns.forEach((pattern) => {
    pattern.tracks.forEach((track) => {
      track.events.forEach((event) => {
        if (!event.fx?.instruments?.[slotIndex]) return;
        delete event.fx.instruments[slotIndex];
        normalizeFx(event);
      });
    });
  });
}

// Adds a new, independent instance of one FX_TYPES kind to a track's insert bus
// (ui/chrome/FxPanel.jsx's "+ ADD FX") — unlike before webdsp's FX chains existed, this is never
// a no-op for an already-present type: two Filters are two instances, each with its own id
// (allocated from song.nextFxInstanceId — model/song.js) and its own fresh parameter bag, seeded
// to that type's catalog defaults. Returns the new instance's id so the caller (appContext.js)
// can create the matching engine-side instance (audio/fx.js#addTrackFxInstance) without having
// to re-derive it.
export function addTrackFx(song, trackIndex, type) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return undefined;
  const id = song.nextFxInstanceId++;
  channel.fxChain.push({ id, type, bypassed: false });
  const bag = {};
  for (const param of getFxParamsForType(type)) bag[param.id] = param.default;
  (channel.fx.instances ??= {})[id] = bag;
  return id;
}

// Removes one instance by id (the FX panel's remove button on that module) — removes it from
// fxChain, drops its own parameter bag, and purges every pattern's cell automation on this track
// that referenced it, so no Event.fx entry can ever point at an instance that no longer exists.
// Siblings of the same type (other Filters, say) are completely untouched — only this one
// instance's id is ever matched. Paired with setCellFxInstanceParam's own validation above
// (which refuses *new* writes for an instance that isn't in the chain) — between the two, a cell
// can never reference a removed instance, enforced at the model layer rather than as a defensive
// check threaded through playback.
export function removeTrackFx(song, trackIndex, instanceId) {
  const channel = getTrackChannel(song, trackIndex);
  if (!channel) return;
  const chainIndex = channel.fxChain.findIndex((entry) => entry.id === instanceId);
  if (chainIndex === -1) return;
  channel.fxChain.splice(chainIndex, 1);
  delete channel.fx.instances?.[instanceId];

  song.patterns.forEach((pattern) => {
    pattern.tracks[trackIndex]?.events.forEach((event) => {
      if (event.fx?.instances?.[instanceId]) {
        for (const paramId in event.fx.instances[instanceId]) delete event.fx.glide?.[fxKey(instanceId, paramId)];
        delete event.fx.instances[instanceId];
        normalizeFx(event);
      }
    });
  });
}

// Mutes/un-mutes one instance without removing it from the chain or touching its stored values
// (model/trackChannel.js's doc comment contrasts this with removeTrackFx above) — backed by
// webdsp's own real per-instance enable/disable once pushed to the engine (audio/fx.js), not a
// "push a neutral value" trick. Flips the flag the FX panel reads; this function alone doesn't
// touch the audio engine (see appContext.js's fxController for the bundling).
export function setTrackFxBypass(song, trackIndex, instanceId, bypassed) {
  const entry = getTrackChannel(song, trackIndex)?.fxChain.find((e) => e.id === instanceId);
  if (entry) entry.bypassed = bypassed;
}

// Reorders one instance within its chain by a relative step (+1/-1 — the FX panel's move
// up/down buttons, ui/chrome/FxPanel.jsx) — clamped at either end rather than wrapping. Array
// order *is* chain/signal-flow order (model/trackChannel.js's doc comment), so this is the only
// thing that needs to change here; audio/fx.js mirrors the new position into webdsp's own
// moveEffect() separately.
export function moveTrackFx(song, trackIndex, instanceId, direction) {
  const chain = getTrackChannel(song, trackIndex)?.fxChain;
  if (!chain) return;
  const from = chain.findIndex((e) => e.id === instanceId);
  if (from === -1) return;
  const to = Math.max(0, Math.min(chain.length - 1, from + direction));
  if (to === from) return;
  const [entry] = chain.splice(from, 1);
  chain.splice(to, 0, entry);
}

// Master-bus equivalents of addTrackFx/removeTrackFx/setTrackFxBypass/moveTrackFx above
// (model/song.js's masterFx/masterFxChain) — no cell-automation purge needed on removal, since a
// tracker cell can never automate the master bus in the first place.
export function addMasterFx(song, type) {
  const id = song.nextFxInstanceId++;
  song.masterFxChain.push({ id, type, bypassed: false });
  const bag = {};
  for (const param of getFxParamsForType(type)) bag[param.id] = param.default;
  (song.masterFx.instances ??= {})[id] = bag;
  return id;
}

// --- FX LFOs (the stackable LFO bank every webdsp effect instance has — docs/modulation.md) ---
// Stored on the chain entry (`entry.lfos`, absent = none), by the catalog's FX param ids
// ("filter.cutoff"). The base value stays in fx.instances[id]; the engine plays base + LFOs. The
// same LFO shape and clamping as a synth's (model/instrumentLfos.js). `trackIndex` null = master.
function findFxEntry(song, trackIndex, instanceId) {
  const chain = trackIndex === null ? song.masterFxChain : getTrackChannel(song, trackIndex)?.fxChain;
  return chain?.find((entry) => entry.id === instanceId);
}

function withLfos(entry, lfos) {
  if (lfos.length > 0) entry.lfos = lfos;
  else delete entry.lfos;
}

// Adds an LFO aimed at `paramId` (must be a parameter of this instance's FX type). False if there
// is no such instance/param or the bank is full.
export function addFxLfo(song, trackIndex, instanceId, paramId) {
  const entry = findFxEntry(song, trackIndex, instanceId);
  if (!entry || !getFxParamsForType(entry.type).some((p) => p.id === paramId)) return false;
  const lfos = entry.lfos ?? [];
  if (lfos.length >= MAX_INSTRUMENT_LFOS) return false;
  withLfos(entry, [...lfos, createLfo(paramId)]);
  return true;
}

export function setFxLfo(song, trackIndex, instanceId, lfoIndex, patch) {
  const entry = findFxEntry(song, trackIndex, instanceId);
  const current = entry?.lfos?.[lfoIndex];
  if (!current) return false;
  const next = patchLfo(current, patch);
  if (patch.target !== undefined && !getFxParamsForType(entry.type).some((p) => p.id === next.target)) next.target = current.target;
  withLfos(entry, entry.lfos.map((l, i) => (i === lfoIndex ? next : l)));
  return true;
}

export function removeFxLfo(song, trackIndex, instanceId, lfoIndex) {
  const entry = findFxEntry(song, trackIndex, instanceId);
  if (!entry?.lfos?.[lfoIndex]) return false;
  withLfos(entry, entry.lfos.filter((_, i) => i !== lfoIndex));
  return true;
}

export function removeMasterFx(song, instanceId) {
  const index = song.masterFxChain.findIndex((entry) => entry.id === instanceId);
  if (index !== -1) song.masterFxChain.splice(index, 1);
  delete song.masterFx.instances?.[instanceId];
}

export function setMasterFxBypass(song, instanceId, bypassed) {
  const entry = song.masterFxChain.find((e) => e.id === instanceId);
  if (entry) entry.bypassed = bypassed;
}

export function moveMasterFx(song, instanceId, direction) {
  const chain = song.masterFxChain;
  const from = chain.findIndex((e) => e.id === instanceId);
  if (from === -1) return;
  const to = Math.max(0, Math.min(chain.length - 1, from + direction));
  if (to === from) return;
  const [entry] = chain.splice(from, 1);
  chain.splice(to, 0, entry);
}

// Track/master bus output balance (model/trackChannel.js#pan / model/song.js#masterPan) — a
// channel-strip control, not part of fxChain/fx (see either doc comment). Clamped to webdsp's own
// -1..+1 range (node_modules/webdsp's docs/panning.md) the same way setTrackChannelVolume clamps
// to its own range below, rather than trusting the caller.
export function setTrackChannelPan(song, trackIndex, pan) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.pan = Math.max(-1, Math.min(1, pan));
}

// Track LFO (model/eventLfo.js): edits the track's event LFO (created disabled on first edit).
export function setTrackChannelEventLfo(song, trackIndex, patch) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.eventLfo = patchEventLfo(eventLfoOf(channel), patch);
}

// Arpeggiator (model/arp.js): edits the track's arp (created disabled on first edit). Notes are
// never touched: the arp generates its notes at playback.
export function setTrackChannelArp(song, trackIndex, patch) {
  const channel = getTrackChannel(song, trackIndex);
  if (channel) channel.arp = patchArp(arpOf(channel), patch);
}

// The project's key (model/scale.js). A context for note entry only: no note is rewritten.
export function setSongScale(song, patch) {
  song.scale = patchScale(scaleOf(song), patch);
}

// Sets Track LFO participation on every step of one track that holds a note, in one pattern
// (the Track tab's All steps / None). 0/null clears it.
export function setTrackStepsLfo(song, patternId, trackIndex, amount) {
  const track = getPattern(song, patternId)?.tracks[trackIndex];
  if (!track) return;
  const value = normalizeParticipation(amount);
  for (const event of track.events) {
    if (event.note !== null || (event.lfo ?? null) !== null) event.lfo = event.note !== null ? value : null;
  }
}

export function setMasterPan(song, pan) {
  song.masterPan = Math.max(-1, Math.min(1, pan));
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
