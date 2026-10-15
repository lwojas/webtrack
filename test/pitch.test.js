import { describe, expect, it } from "vitest";
import { noteToFrequency, frequencyToNote, semitonesToRatio } from "../src/model/pitch.js";
import { noteNumberToName, parseNoteName } from "../src/model/notes.js";

describe("model/pitch.js", () => {
  it("maps known notes to their equal-temperament frequencies (60 = C-4)", () => {
    expect(noteToFrequency(69)).toBeCloseTo(440, 9);
    expect(noteToFrequency(60)).toBeCloseTo(261.6256, 3);
    expect(noteToFrequency(33)).toBeCloseTo(55, 9);
    expect(noteToFrequency(parseNoteName("C-2"))).toBeCloseTo(65.4064, 3);
    expect(noteToFrequency(39)).toBeCloseTo(77.7817, 3); // D#-1
  });

  it("octaves double and semitones multiply by 2^(1/12)", () => {
    expect(noteToFrequency(45) / noteToFrequency(33)).toBeCloseTo(2, 9);
    expect(noteToFrequency(34) / noteToFrequency(33)).toBeCloseTo(2 ** (1 / 12), 9);
    expect(semitonesToRatio(0)).toBe(1);
    expect(semitonesToRatio(12)).toBeCloseTo(2, 9);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 9);
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 4);
  });

  it("round-trips frequency <-> note and agrees with the note-name convention", () => {
    for (let n = 21; n <= 108; n++) expect(frequencyToNote(noteToFrequency(n))).toBeCloseTo(n, 9);
    expect(frequencyToNote(55)).toBeCloseTo(33, 9);
    expect(noteNumberToName(Math.round(frequencyToNote(55)))).toBe("A-1");
  });
});
