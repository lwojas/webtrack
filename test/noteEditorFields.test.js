import { describe, expect, it } from "vitest";
import { parseNoteDraft, parseHexInput } from "../src/ui/chrome/NoteEditor.jsx";

// These back the note editor's draft/commit fields (ui/chrome/NoteEditor.jsx#useDraftField):
// typing is held in local state and only committed to the model once `parse` returns something
// other than `undefined`, so a still-incomplete edit never overwrites the cell mid-keystroke.
describe("parseNoteDraft (note field commit gate)", () => {
  it("commits a complete, valid note name — reusing model/notes.js#parseNoteName's representation", () => {
    expect(parseNoteDraft("C-4")).toBe(60);
    expect(parseNoteDraft("C#4")).toBe(61);
    expect(parseNoteDraft("D4")).toBe(62);
  });

  it("treats an empty string or the placeholder as an explicit clear, not 'incomplete'", () => {
    expect(parseNoteDraft("")).toBe(null);
    expect(parseNoteDraft("   ")).toBe(null);
    expect(parseNoteDraft("---")).toBe(null);
  });

  it("leaves a still-incomplete note name uncommitted (undefined), e.g. partway through typing D#4", () => {
    expect(parseNoteDraft("D")).toBe(undefined);
    expect(parseNoteDraft("D#")).toBe(undefined);
    expect(parseNoteDraft("zzz")).toBe(undefined);
  });
});

describe("parseHexInput (instrument/velocity/FX param field commit gate)", () => {
  it("commits a valid hex value, clamped to the field's max", () => {
    expect(parseHexInput("1A", 255)).toBe(26);
    expect(parseHexInput("ff", 255)).toBe(255);
    expect(parseHexInput("ff", 127)).toBe(127);
  });

  it("treats an empty string as an explicit clear", () => {
    expect(parseHexInput("", 255)).toBe(null);
    expect(parseHexInput("   ", 255)).toBe(null);
  });

  it("leaves non-hex input uncommitted instead of silently coercing it to 0", () => {
    expect(parseHexInput("g", 255)).toBe(undefined);
    expect(parseHexInput("zz", 255)).toBe(undefined);
  });
});
