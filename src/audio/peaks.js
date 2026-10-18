// Waveform overview for the chop editor: decodes a slot's stored sample bytes once (the engine
// keeps only its own PCM) and reduces them to per-bin peak amplitude. Cached by the bytes' buffer.
import { computePeaks } from "webdsp";

const cache = new WeakMap();

/** Peaks for sample bytes (an ArrayBuffer), or null if they can't be decoded. Safe to repeat. */
export function loadPeaks(buffer) {
  if (!buffer) return Promise.resolve(null);
  let entry = cache.get(buffer);
  if (!entry) {
    entry = decodePeaks(buffer);
    cache.set(buffer, entry);
  }
  return entry;
}

async function decodePeaks(buffer) {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    // decodeAudioData detaches its input, so decode a copy.
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    return computePeaks(Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)));
  } catch {
    return null;
  }
}
