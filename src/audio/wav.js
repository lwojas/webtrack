// Encodes captured PCM (audio/resampleController.js's armCapture() result — planar
// Float32Arrays, one per channel) as a 16-bit PCM WAV file — the smallest encoding that lets a
// resampled Instrument's bytes flow through the exact same sampleAsset/loadSample()/
// projectFile.js pipeline an imported file already uses (see model/instrument.js's origin doc
// comment): WAV is universally decodable by the browser's own decodeAudioData, so there's no
// separate "raw PCM" storage/reload path to build. 16-bit (not 32-bit float) trades a little
// quantization for the broadest decoder compatibility — acceptable for an already-mixed-down
// capture, same reasoning webseq's own encodeWav uses for its resample feature.
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

function clampToInt16(value) {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff));
}

// channelData must be equal-length planar Float32Arrays, one per channel — exactly the shape
// AudioRuntime.armCapture()'s resolved `channelData` (each entry converted from its raw
// ArrayBuffer) is already in.
export function encodeWav(channelData, sampleRate) {
  const numChannels = Math.max(1, channelData.length);
  const numFrames = channelData[0]?.length ?? 0;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, clampToInt16(channelData[c][frame]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return buffer;
}
