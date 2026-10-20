// Explicit, versioned project format — not a dump of arbitrary application state. Covers
// everything a reopened project needs: the Song (patterns/tracks/events, including
// per-pattern rowCount and every Event field, plus the pattern queue and selected pattern —
// see model/song.js), instrument metadata plus the *actual sample bytes* (not a sampleId —
// see below), and the small bit of editor/UI session state worth restoring. Pure/DOM-free so
// it's unit-testable with plain vitest assertions; the browser file-picker/download glue
// lives in projectIO.js instead.
import { createInstrumentSlot } from "../model/instrument.js";
import { normalizeCues } from "../model/chop.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import { FX_TYPES, getFxParam } from "../model/fxParams.js";
import { DEFAULT_MAX_VOICES } from "../model/trackChannel.js";
import { normalizeScale } from "../model/scale.js";
import { normalizeArp } from "../model/arp.js";

export const PROJECT_FORMAT_VERSION = 2;

// v1 songs organized patterns under banks (song.banks[i].patterns[j], each bank with its own
// activePatternIndex) — the abstraction the Pattern Manager replaced (see model/song.js's doc
// comment: banks never actually provided anything instrument/track-wise, they were purely a
// second indexing level over patterns). This flattens every bank's patterns into one pool,
// in bank order, assigns each a fresh stable id, and queues them in that same flattened
// order, so no pattern data is lost — only the bank-shaped addressing is. The pattern that
// was active in the previously active bank (ui.activeBankIndex) becomes selectedPatternId.
function migrateSongV1ToV2(oldSong, ui) {
  let nextId = 0;
  const patterns = [];
  const patternQueue = [];
  const activeBankIndex = ui?.activeBankIndex ?? 0;
  let selectedPatternId = null;

  oldSong.banks.forEach((bank, bankIndex) => {
    bank.patterns.forEach((pattern, patternIndex) => {
      const id = nextId++;
      patterns.push({ ...pattern, id });
      patternQueue.push(id);
      if (bankIndex === activeBankIndex && patternIndex === bank.activePatternIndex) {
        selectedPatternId = id;
      }
    });
  });

  return {
    name: oldSong.name,
    bpm: oldSong.bpm,
    trackCount: oldSong.trackCount,
    rowCount: oldSong.rowCount,
    trackChannels: oldSong.trackChannels,
    patterns,
    patternQueue,
    selectedPatternId: selectedPatternId ?? patterns[0].id,
    nextPatternId: nextId,
  };
}

// Whether an instrument's sample should embed its raw bytes as base64 in the project JSON
// itself, vs. only ever reference them by localAssetId (persistence/localAssetStore.js's
// IndexedDB-backed store — see model/instrument.js's origin doc comment). embedSampleBytes:
// true (the default, what an explicit Save always uses) embeds *every* instrument's bytes,
// "resample"-origin ones included — if a saved project is reopened by someone else, or on a
// different browser/profile, a resampled instrument should come back exactly as playable as an
// imported one, not as an empty slot; the brief behind this feature was explicit that a project
// file shouldn't silently lose generated audio just because of where it came from.
// embedSampleBytes: false (persistence/recovery.js's lightweight local-recovery snapshot)
// references every instrument by localAssetId instead, regardless of origin, since the
// recovery cache is local-only, never shared, and the whole point of that path is to stay
// cheap to write on every debounce tick — see recovery.js's own module doc comment.
function serializeInstrument(instrument, embedSampleBytes) {
  let sample = null;
  if (instrument.sampleAsset) {
    sample = embedSampleBytes
      ? {
          fileName: instrument.sampleAsset.fileName,
          mimeType: instrument.sampleAsset.mimeType,
          dataBase64: arrayBufferToBase64(instrument.sampleAsset.buffer),
        }
      : instrument.localAssetId
        ? {
            fileName: instrument.sampleAsset.fileName,
            mimeType: instrument.sampleAsset.mimeType,
            localAssetId: instrument.localAssetId,
          }
        : null; // no local reference to fall back on — shouldn't happen once every load path
    // (appContext.js#applyInstrumentSample) assigns one, but better an empty slot on reload
    // than a thrown error during save.
  }

  // sampleId is deliberately dropped here — it's a handle into the *current* AudioRuntime
  // session (webdsp doesn't persist samples across sessions), so saving it would be
  // meaningless after a reload. deserializeProject() re-loads `sample`'s bytes and gets a
  // fresh sampleId instead (see docs/EXTENDING.md's own persistence note).
  // engineInstrumentId is deliberately dropped here too, for the exact same reason sampleId
  // is: it's a handle into the *current* AudioRuntime session (audio/instrument.js's own doc
  // comment) — deserializeProject() leaves it null, and whichever load path runs next
  // (appContext.js's resyncSynthInstruments) creates a fresh one from instrumentParams below.
  return {
    id: instrument.id,
    name: instrument.name,
    gain: instrument.gain,
    rootNote: instrument.rootNote,
    output: instrument.output,
    origin: instrument.origin,
    envelope: instrument.envelope,
    sampleMode: instrument.sampleMode,
    cues: instrument.cues,
    instrumentParams: instrument.instrumentParams,
    instrumentLfos: instrument.instrumentLfos,
    sample,
  };
}

// Every pattern track now carries its own playback `length` (model/pattern.js), added after
// format v2 shipped without it. Rather than bumping the format version for a field that's
// purely additive, any pattern loaded from a file saved before this existed (or migrated from
// v1, whose tracks never had it either) gets it defaulted to that pattern's rowCount here —
// exactly the length every track already behaved as before this feature existed, so an old
// project opens and plays identically to how it always did.
function ensureTrackLengths(song) {
  song.patterns.forEach((pattern) => {
    pattern.tracks.forEach((track) => {
      if (typeof track.length !== "number") track.length = pattern.rowCount;
    });
  });
}

// trackChannel.voiceMode/maxVoices (model/trackChannel.js) are purely additive too, added after
// format v2 shipped without them — same reasoning as ensureTrackLengths/ensureFxDefaults below:
// default every track to "poly" at DEFAULT_MAX_VOICES, which is exactly how every track already
// behaved before this feature existed (unbounded polyphony), just with the same modest ceiling
// a brand-new track gets today (model/trackChannel.js#createTrackChannel) rather than no ceiling
// at all — a project saved before this existed gains the same "sane default" protection a new
// project starts with, instead of silently staying unlimited forever.
// song.swing (model/song.js) is purely additive too, added after format v2 shipped without it
// — same reasoning as ensureTrackLengths above: default it to 0 (neutral/disabled), exactly how
// every project already played before swing existed.
function ensureSwingDefault(song) {
  if (typeof song.swing !== "number") song.swing = 0;
}

// song.scale / trackChannel.arp (model/scale.js, model/arp.js) are purely additive too: a project
// saved before them gets the chromatic scale (every note in scale) and no arp, which is exactly
// how it always played — nothing is rewritten. Present values are normalised (clamped, unknown
// ids defaulted) so a hand-edited file can't carry an invalid scale/arp into playback.
function ensureScaleAndArpDefaults(song) {
  song.scale = normalizeScale(song.scale);
  song.trackChannels.forEach((channel) => {
    if (channel.arp !== undefined) channel.arp = normalizeArp(channel.arp);
  });
}

function ensureVoiceDefaults(song) {
  song.trackChannels.forEach((channel) => {
    if (!channel.voiceMode) channel.voiceMode = "poly";
    if (typeof channel.maxVoices !== "number") channel.maxVoices = DEFAULT_MAX_VOICES;
  });
}

// trackChannel.pan / song.masterPan (model/trackChannel.js, model/song.js) are purely additive
// too, added after format v2 shipped without them — default to 0 (centre), bit-identical to
// every project's existing behavior before panning existed (node_modules/webdsp's
// docs/panning.md).
function ensurePanDefaults(song) {
  song.trackChannels.forEach((channel) => {
    if (typeof channel.pan !== "number") channel.pan = 0;
  });
  if (typeof song.masterPan !== "number") song.masterPan = 0;
}

// trackChannel.fx / song.masterFx (model/trackChannel.js, model/song.js) are purely additive
// too, added after format v2 shipped without them — default them here rather than bump
// PROJECT_FORMAT_VERSION for a field an old project simply never had an opinion about. A cell's
// own Event.fx needs no equivalent default: every read path already treats a missing/undefined
// fx map the same as an explicit null (see model/event.js#isEmptyEvent, audio/compile.js#
// compileRowFx).
function ensureFxDefaults(song) {
  if (typeof song.nextFxInstanceId !== "number") song.nextFxInstanceId = 0;
  song.trackChannels.forEach((channel) => {
    if (!channel.fx) channel.fx = { instances: {} };
  });
  if (!song.masterFx) song.masterFx = { instances: {} };
  ensureFxChains(song);
  ensureFxInstanceIds(song);
}

// Which FX_TYPES ids this *flat* fx bag has actually touched — any param sitting at a non-default
// value (model/fxParams.js's FX_PARAMS#default doubles as each node's own bypass/neutral value,
// so "untouched" and "bypassed" were indistinguishable before fxChain existed). Only ever
// meaningful for a pre-fxChain project, whose fx bag was still flat `{ [paramId]: value }` — see
// ensureFxChains below.
function typesTouchedByFxBag(fxBag) {
  const touched = new Set();
  for (const paramId in fxBag) {
    const param = getFxParam(paramId);
    if (param?.type && fxBag[paramId] !== param.default) touched.add(param.type);
  }
  return touched;
}

// Which FX_TYPES ids a track's cell automation references anywhere in the song, regardless of
// which pattern — a cell referencing e.g. "delay.mix" only makes sense if that track's delay is
// (or, pre-fxChain, effectively always was) enabled. Only meaningful for a pre-fxChain project's
// still-flat Event.fx map (see ensureFxInstanceIds below for the post-fxChain, per-instance
// shape's own migration).
function typesReferencedByCellAutomation(song, trackIndex) {
  const touched = new Set();
  song.patterns.forEach((pattern) => {
    pattern.tracks[trackIndex]?.events.forEach((event) => {
      for (const paramId in event.fx) {
        const type = getFxParam(paramId)?.type;
        if (type) touched.add(type);
      }
    });
  });
  return touched;
}

// trackChannel.fxChain / song.masterFxChain (model/trackChannel.js, model/song.js) didn't exist
// before every FX was selectively enable/disable-able — a project saved before that feature
// had every FX effectively "on" (just resting at its neutral value unless the user had moved
// it, since FX_PARAMS#default *is* each node's neutral value). So rather than defaulting to an
// empty chain (which would silently disable, and on save or a future removeTrackFx purge,
// destroy, any FX a saved project already relies on), derive each channel's fxChain from
// whatever it actually used: any type with a non-default parameter value, or referenced by a
// cell's Event.fx anywhere in the song, is enabled (not bypassed) — the project sounds and
// edits identically to how it did before fxChain existed. Entries built here have no `id` yet
// (fxChain didn't have instances yet either) — ensureFxInstanceIds below is what assigns one.
function ensureFxChains(song) {
  song.trackChannels.forEach((channel, trackIndex) => {
    if (channel.fxChain) return;
    const touched = new Set([...typesTouchedByFxBag(channel.fx), ...typesReferencedByCellAutomation(song, trackIndex)]);
    channel.fxChain = FX_TYPES.filter((type) => touched.has(type.id)).map((type) => ({ type: type.id, bypassed: false }));
  });

  if (!song.masterFxChain) {
    const touched = typesTouchedByFxBag(song.masterFx);
    song.masterFxChain = FX_TYPES.filter((type) => touched.has(type.id)).map((type) => ({ type: type.id, bypassed: false }));
  }
}

// fxChain entries gained a stable `id` (and fx/Event.fx moved from a flat `{ [paramId]: value }`
// bag to a per-instance `{ "bus.gain"?: value, instances: { [id]: { [paramId]: value } } }` one)
// when webdsp's FX chains made multiple instances of the same type possible — see
// model/trackChannel.js's doc comment. A project saved before that could only ever have *one*
// instance of each type to begin with (chain membership was per-type, not per-instance), so the
// migration is lossless and mechanical: assign each existing chain entry a fresh id, move its
// type's flat param values into that id's own bag (leaving "bus.gain" flat, since it was never
// type-scoped), and do the same for every pattern's cell automation on that track.
function ensureFxInstanceIds(song) {
  song.trackChannels.forEach((channel, trackIndex) => {
    if (channel.fxChain.every((entry) => "id" in entry)) return;

    const typeToId = new Map();
    channel.fxChain.forEach((entry) => {
      entry.id = song.nextFxInstanceId++;
      typeToId.set(entry.type, entry.id);
    });

    const instances = {};
    const flatFx = { ...channel.fx };
    delete flatFx.instances;
    for (const paramId in flatFx) {
      const type = getFxParam(paramId)?.type;
      if (type === null || type === undefined) continue; // bus.gain stays flat
      const id = typeToId.get(type);
      if (id === undefined) continue; // a stray value for a type that was never actually enabled
      (instances[id] ??= {})[paramId] = flatFx[paramId];
      delete flatFx[paramId];
    }
    channel.fx = { ...flatFx, instances };

    song.patterns.forEach((pattern) => {
      pattern.tracks[trackIndex]?.events.forEach((event) => migrateCellFxToInstances(event, typeToId));
    });
  });

  if (song.masterFxChain.every((entry) => "id" in entry)) return;
  const typeToId = new Map();
  song.masterFxChain.forEach((entry) => {
    entry.id = song.nextFxInstanceId++;
    typeToId.set(entry.type, entry.id);
  });
  const instances = {};
  const flatFx = { ...song.masterFx };
  delete flatFx.instances;
  for (const paramId in flatFx) {
    const type = getFxParam(paramId)?.type;
    if (type === null || type === undefined) continue;
    const id = typeToId.get(type);
    if (id === undefined) continue;
    (instances[id] ??= {})[paramId] = flatFx[paramId];
    delete flatFx[paramId];
  }
  song.masterFx = { ...flatFx, instances };
}

// One event's own flat fx map ({ [paramId]: value }, pre-fxChain-instances shape) rewritten into
// the nested per-instance shape (model/event.js#fx's doc comment), using the same type -> id
// mapping ensureFxInstanceIds just built for this track. bus.gain (type null) stays flat.
function migrateCellFxToInstances(event, typeToId) {
  if (!event.fx || event.fx.instances) return; // no automation, or already migrated
  const instances = {};
  const flatFx = { ...event.fx };
  for (const paramId in flatFx) {
    const type = getFxParam(paramId)?.type;
    if (type === null || type === undefined) continue;
    const id = typeToId.get(type);
    if (id === undefined) continue;
    (instances[id] ??= {})[paramId] = flatFx[paramId];
    delete flatFx[paramId];
  }
  event.fx = Object.keys(instances).length > 0 ? { ...flatFx, instances } : flatFx;
}

// song/instruments/ui come straight from state/store.js's state shape. embedSampleBytes: true
// (the default) is what appContext.js#saveProject's explicit Save always uses; false is
// persistence/recovery.js's lightweight local-recovery snapshot — see
// shouldEmbedSampleBytes()'s doc comment above for exactly what each does and doesn't embed.
export function serializeProject({ song, instruments, ui }, { embedSampleBytes = true } = {}) {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    song,
    instruments: instruments.map((instrument) => serializeInstrument(instrument, embedSampleBytes)),
    ui: {
      selectedInstrumentIndex: ui.selectedInstrumentIndex,
      octave: ui.octave,
      editStep: ui.editStep,
      cursor: ui.cursor,
    },
  };
}

// loadSampleBytes: (arrayBuffer, fileName) => Promise<sampleId> — injected by the caller
// (appContext.js, backed by audio/instrumentLoader.js#loadSample) so this module never
// imports audio/ or webdsp directly. loadLocalAssetBytes: (localAssetId) =>
// Promise<ArrayBuffer | undefined> — injected the same way, backed by
// persistence/localAssetStore.js#getLocalAsset, resolving a referenced-not-embedded sample's
// bytes (see serializeInstrument's own doc comment). Optional: existing callers that only ever
// load projects with embedded samples (every project saved before this feature, or a test that
// never exercises the reference path) don't need to supply it.
export async function deserializeProject(parsed, { loadSampleBytes, loadLocalAssetBytes }) {
  if (parsed?.formatVersion === 1) {
    parsed = { ...parsed, formatVersion: 2, song: migrateSongV1ToV2(parsed.song, parsed.ui) };
  }

  if (parsed?.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported project format version: ${parsed?.formatVersion}`);
  }

  ensureTrackLengths(parsed.song);
  ensureSwingDefault(parsed.song);
  ensureScaleAndArpDefaults(parsed.song);
  ensureVoiceDefaults(parsed.song);
  ensurePanDefaults(parsed.song);
  ensureFxDefaults(parsed.song);

  const instruments = await Promise.all(
    parsed.instruments.map(async (def) => {
      const base = {
        id: def.id,
        name: def.name,
        gain: def.gain,
        rootNote: def.rootNote,
        output: def.output,
        origin: def.origin,
        envelope: def.envelope,
        // Additive: undefined in a project saved before chop mode -> chromatic, no cues.
        sampleMode: def.sampleMode === "chop" ? "chop" : undefined,
        cues: Array.isArray(def.cues) ? normalizeCues(def.cues) : undefined,
        instrumentParams: def.instrumentParams,
        // Additive: undefined in a project saved before LFO slots existed -> createInstrumentSlot's [].
        instrumentLfos: Array.isArray(def.instrumentLfos) ? def.instrumentLfos : undefined,
      };

      // output is purely additive (a project saved before it existed has no def.output at
      // all) — createInstrumentSlot's own default parameter applies whenever the destructured
      // value is undefined, same as gain/rootNote already rely on just below, so an old
      // project loads as "sample" output, exactly how it already behaved. origin is purely
      // additive the same way: undefined on any project saved before this feature existed, and
      // createInstrumentSlot's own default ("import") applies. instrumentParams is additive
      // for the exact same reason (no project predating "instrument" output has it at all) —
      // undefined falls through to createInstrumentSlot's own `null` default, and the first
      // time such a slot is ever switched to an "instrument" output it gets seeded with that
      // kind's catalog defaults (state/store.js#setInstrumentOutput), same as a brand-new slot.
      if (!def.sample) return createInstrumentSlot(base);

      let buffer;
      if (def.sample.dataBase64) {
        buffer = base64ToArrayBuffer(def.sample.dataBase64);
      } else if (def.sample.localAssetId) {
        buffer = await loadLocalAssetBytes?.(def.sample.localAssetId);
        if (!buffer) {
          // The referenced local asset isn't in *this* browser's storage (a different
          // profile/machine, or the user cleared site data) — degrade to an empty slot that
          // still shows its name and keeps the reference, rather than throwing and failing the
          // whole project load over one missing sample.
          return createInstrumentSlot({ ...base, localAssetId: def.sample.localAssetId });
        }
      } else {
        return createInstrumentSlot(base);
      }

      // Hand the loader a copy — loadSample() may transfer/detach the buffer it's given, and
      // the original needs to survive on sampleAsset so a reload-then-resave round-trips
      // without the user having to re-pick the file.
      const sampleId = await loadSampleBytes(buffer.slice(0), def.sample.fileName);

      return createInstrumentSlot({
        ...base,
        sampleId,
        sampleAsset: { buffer, mimeType: def.sample.mimeType, fileName: def.sample.fileName },
        localAssetId: def.sample.localAssetId ?? null,
      });
    }),
  );

  return { song: parsed.song, instruments, ui: parsed.ui ?? {} };
}
