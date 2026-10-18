// Waveform overview for the chop editor: decodes a slot's stored sample bytes once (the engine
// keeps only its own PCM) and reduces them to per-bin peak amplitude. Cached by the bytes' buffer.
const BINS = 1024;
const cache = new WeakMap();

/** Peak |amplitude| (0..1) of `bins` equal spans across all channels. */
export function computePeaks(channels, bins = BINS) {
  const peaks = new Float32Array(bins);
  const length = channels[0]?.length ?? 0;
  if (length === 0) return peaks;
  for (const data of channels) {
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((b * length) / bins);
      const to = Math.max(from + 1, Math.floor(((b + 1) * length) / bins));
      let max = peaks[b];
      for (let i = from; i < to && i < length; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  return peaks;
}

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
