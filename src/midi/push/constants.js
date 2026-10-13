// Ableton Push Mk1 protocol constants — ported as plain data from midi-core's own
// hands-on-verified `devices/push-mk1.ts` profile (a sibling project's existing, working Push
// integration; see the architecture doc's "MIDI Core assessment" for why webtrack copies this
// data rather than depending on midi-core itself — its surrounding DeviceProfile/Surface
// machinery is shaped for a different, paged/windowed sequencer app, but this hardware data has
// no cheap substitute: re-deriving it would mean re-probing a real Push, which this project
// explicitly avoids).
//
// Everything here is pure data/formulas — no device-profile, surface, or mapping-engine
// abstraction wraps it. webtrack's own Push adapter (src/midi/push/*, built in a later stage)
// reads these constants directly. Values midi-core's own source flags as "assumed, same
// family" rather than independently hardware-confirmed are called out below — treat anything
// built on one as provisional until checked against the real device (see
// docs/hardware-validation-push-mk1.md in midi-core for the source verification).

export const PUSH_CHANNEL = 0;

// --- Pad grid (the 8x8 performance grid) ---
// Bottom-left origin, row-major. Only velocity 36 (teal, see colors.js) is independently
// hardware-confirmed as pad LED feedback; the note-number formula itself is confirmed for
// every pad.
export function padNote(rowFromBottom, column) {
  return 36 + rowFromBottom * 8 + column;
}

// --- Mode buttons ---
// This project's own assignment (see the architecture doc's "Push mode state machine"): CC50/
// CC51 are the physical "Note"/"Session" buttons, CC112/CC113 the physical "Track"/"Clip"
// buttons. All four CCs themselves are hardware-confirmed in midi-core's profile; wiring them
// to webtrack's tracker/note/pattern-view mode switch is new design, not ported behavior —
// midi-core's own profile wires CC50 to its sequencer's step-edit mode, not to a note-entry
// mode (see the architecture doc's Push Note Mode section).
export const CC_MODE_NOTE = 50;
export const CC_MODE_SESSION = 51;
export const CC_MODE_TRACK = 112;
export const CC_MODE_CLIP = 113;

// --- Mute strip (the control row directly above the grid) ---
// velocity-color-led (see colors.js) — CC 102-109, confirmed: 6=red, 22=green.
export const MUTE_CC = [102, 103, 104, 105, 106, 107, 108, 109];

// --- Selection buttons (right-hand side column) ---
// CC 36-43, descending top to bottom — SELECT_CC[0] is the topmost button, SELECT_CC[7] the
// bottommost. velocity-color-led, confirmed: 10=resting, 22=selected.
export const SELECT_CC = [43, 42, 41, 40, 39, 38, 37, 36];

// --- Transport / utility buttons ---
// Monochrome dim/full feedback (FEEDBACK_* below), not the velocity-color scheme the
// pads/mute-strip/select buttons use. Play (85) and Shift (49) are independently
// hardware-confirmed; the rest are the same button family, not individually re-verified.
export const CC_PLAY = 85;
export const CC_RECORD = 86;
export const CC_STOP_CLIP = 29;
export const CC_ARROW_LEFT = 44;
export const CC_ARROW_RIGHT = 45;
export const CC_ARROW_UP = 46;
export const CC_ARROW_DOWN = 47;
export const CC_SHIFT = 49;
export const CC_MASTER = 28;
export const CC_VOLUME = 114;
export const CC_SCALES = 58;
export const CC_DEVICES = 110;

// 0 = off, 1 = dim steady, 2-3 = dim blink, 4 = full steady, 5-6 = full blink; 7+ clamps to
// full (hardware behavior, not a webtrack choice) — confirmed on Play/Shift.
export const FEEDBACK_OFF = 0;
export const FEEDBACK_DIM = 1;
export const FEEDBACK_DIM_BLINK = 2;
export const FEEDBACK_FULL = 4;
export const FEEDBACK_FULL_BLINK = 5;

// --- Encoders ---
// 8 generic + Master/Swing/Tempo. Relative, signed 7-bit two's-complement delta (values < 64
// are +delta, values >= 64 are value-128); each has its own capacitive-touch Note (0-10), used
// for the contextual LCD overlay in a later stage. Only Encoder 1 and Tempo are independently
// hardware-confirmed; the rest are the same family, not individually re-verified.
export const ENCODER_CC = [71, 72, 73, 74, 75, 76, 77, 78];
export const CC_ENCODER_MASTER = 79;
export const CC_ENCODER_SWING = 15;
export const CC_ENCODER_TEMPO = 14;

export function encoderDelta(value) {
  return value < 64 ? value : value - 128;
}

// --- LCD ---
// 4 lines, SysEx F0 47 7F 15 {lineId} 00 45 00 [68 ASCII bytes] F7. Only printable ASCII
// 32-126 is verified to render — build level-bar glyphs from [ ] - = (not block characters).
export const LCD_LINE_ID = [0x18, 0x19, 0x1a, 0x1b];
export const LCD_LINE_LENGTH = 68;

// text is padded/truncated to exactly LCD_LINE_LENGTH so every call fully overwrites the line
// (a shorter previous message can never leave stray characters at the end).
export function lcdSysex(lineIndex, text) {
  const padded = text.slice(0, LCD_LINE_LENGTH).padEnd(LCD_LINE_LENGTH, " ");
  const bytes = Array.from(padded, (char) => char.charCodeAt(0));
  return [0xf0, 0x47, 0x7f, 0x15, LCD_LINE_ID[lineIndex], 0x00, 0x45, 0x00, ...bytes, 0xf7];
}
