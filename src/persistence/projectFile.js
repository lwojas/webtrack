// Explicit, versioned project format — not a dump of arbitrary application state. Covers
// everything a reopened project needs: the Song (patterns/tracks/events, including
// per-pattern rowCount and every Event field, plus the pattern queue and selected pattern —
// see model/song.js), instrument metadata plus the *actual sample bytes* (not a sampleId —
// see below), and the small bit of editor/UI session state worth restoring. Pure/DOM-free so
// it's unit-testable with plain vitest assertions; the browser file-picker/download glue
// lives in projectIO.js instead.
import { createInstrumentSlot } from "../model/instrument.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import { FX_TYPES, getFxParam } from "../model/fxParams.js";

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

function serializeInstrument(instrument) {
  const sample = instrument.sampleAsset
    ? {
        fileName: instrument.sampleAsset.fileName,
        mimeType: instrument.sampleAsset.mimeType,
        dataBase64: arrayBufferToBase64(instrument.sampleAsset.buffer),
      }
    : null;

  // sampleId is deliberately dropped here — it's a handle into the *current* AudioRuntime
  // session (webdsp doesn't persist samples across sessions), so saving it would be
  // meaningless after a reload. deserializeProject() re-loads `sample`'s bytes and gets a
  // fresh sampleId instead (see docs/EXTENDING.md's own persistence note).
  return { id: instrument.id, name: instrument.name, gain: instrument.gain, rootNote: instrument.rootNote, sample };
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

// trackChannel.fx / song.masterFx (model/trackChannel.js, model/song.js) are purely additive
// too, added after format v2 shipped without them — same reasoning as ensureTrackLengths
// above: default them here rather than bump PROJECT_FORMAT_VERSION for a field an old project
// simply never had an opinion about. A cell's own Event.fx needs no equivalent default: every
// read path already treats a missing/undefined fx map the same as an explicit null (see
// model/event.js#isEmptyEvent, audio/compile.js#compileRowFx).
function ensureFxDefaults(song) {
  song.trackChannels.forEach((channel) => {
    if (!channel.fx) channel.fx = {};
  });
  if (!song.masterFx) song.masterFx = {};
  ensureFxChains(song);
}

// Which FX_TYPES ids this fx bag has actually touched — any param sitting at a non-default
// value (model/fxParams.js's FX_PARAMS#default doubles as each node's own bypass/neutral
// value, so "untouched" and "bypassed" were indistinguishable before fxChain existed).
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
// (or, pre-fxChain, effectively always was) enabled.
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
// edits identically to how it did before fxChain existed.
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

// song/instruments/ui come straight from state/store.js's state shape.
export function serializeProject({ song, instruments, ui }) {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    song,
    instruments: instruments.map(serializeInstrument),
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
// imports audio/ or webdsp directly.
export async function deserializeProject(parsed, { loadSampleBytes }) {
  if (parsed?.formatVersion === 1) {
    parsed = { ...parsed, formatVersion: 2, song: migrateSongV1ToV2(parsed.song, parsed.ui) };
  }

  if (parsed?.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported project format version: ${parsed?.formatVersion}`);
  }

  ensureTrackLengths(parsed.song);
  ensureFxDefaults(parsed.song);

  const instruments = await Promise.all(
    parsed.instruments.map(async (def) => {
      if (!def.sample) {
        return createInstrumentSlot({ id: def.id, name: def.name, gain: def.gain, rootNote: def.rootNote });
      }

      const buffer = base64ToArrayBuffer(def.sample.dataBase64);
      // Hand the loader a copy — loadSample() may transfer/detach the buffer it's given, and
      // the original needs to survive on sampleAsset so a reload-then-resave round-trips
      // without the user having to re-pick the file.
      const sampleId = await loadSampleBytes(buffer.slice(0), def.sample.fileName);

      return createInstrumentSlot({
        id: def.id,
        name: def.name,
        gain: def.gain,
        rootNote: def.rootNote,
        sampleId,
        sampleAsset: { buffer, mimeType: def.sample.mimeType, fileName: def.sample.fileName },
      });
    }),
  );

  return { song: parsed.song, instruments, ui: parsed.ui ?? {} };
}
