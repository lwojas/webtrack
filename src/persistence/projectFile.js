// Explicit, versioned project format — not a dump of arbitrary application state. Covers
// everything a reopened project needs: the Song (banks/patterns/tracks/events, including
// per-pattern rowCount and every Event field), instrument metadata plus the *actual sample
// bytes* (not a sampleId — see below), and the small bit of editor/UI session state worth
// restoring. Pure/DOM-free so it's unit-testable with plain vitest assertions; the browser
// file-picker/download glue lives in projectIO.js instead.
import { createInstrumentSlot } from "../model/instrument.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";

export const PROJECT_FORMAT_VERSION = 1;

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

// song/instruments/ui come straight from state/store.js's state shape.
export function serializeProject({ song, instruments, ui }) {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    song,
    instruments: instruments.map(serializeInstrument),
    ui: {
      activeBankIndex: ui.activeBankIndex,
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
  if (parsed?.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported project format version: ${parsed?.formatVersion}`);
  }

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
