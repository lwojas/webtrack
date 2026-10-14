import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/audio/wav.js";

describe("encodeWav", () => {
  it("writes a correct RIFF/WAVE header for a stereo buffer", () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([0, -0.5, 0.5]);
    const buffer = encodeWav([left, right], 48000);
    const view = new DataView(buffer);

    function readString(offset, length) {
      let s = "";
      for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
      return s;
    }

    expect(readString(0, 4)).toBe("RIFF");
    expect(readString(8, 4)).toBe("WAVE");
    expect(readString(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readString(36, 4)).toBe("data");

    const dataSize = 3 * 2 * 2; // frames * channels * bytesPerSample
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(buffer.byteLength).toBe(44 + dataSize);
  });

  it("interleaves channels and clamps/scales samples to 16-bit PCM", () => {
    const left = new Float32Array([1, -1, 0]);
    const buffer = encodeWav([left], 44100);
    const view = new DataView(buffer);

    expect(view.getInt16(44, true)).toBe(0x7fff); // +1.0 -> max positive int16
    expect(view.getInt16(46, true)).toBe(-0x8000); // -1.0 -> max negative int16
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const left = new Float32Array([2.5, -3.1]);
    const buffer = encodeWav([left], 44100);
    const view = new DataView(buffer);

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it("defaults to mono (1 channel) for an empty channelData array", () => {
    const buffer = encodeWav([], 44100);
    const view = new DataView(buffer);
    expect(view.getUint16(22, true)).toBe(1);
    expect(buffer.byteLength).toBe(44); // header only, zero frames
  });
});
