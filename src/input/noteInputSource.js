// The input-source-agnostic contract (ECS-156 plan §8): any producer — the keyboard today, a
// future midiInputSource.js — emits {note, velocity} on/off through this same shape, so
// editController.js and audio/preview.js never need to know which source they're reading
// from. note is the numeric MIDI-style value model/event.js already uses, so there's no
// translation layer between "key pressed" and "Event.note".
export function createNoteInputSource() {
  const onListeners = new Set();
  const offListeners = new Set();

  return {
    onNoteOn(fn) {
      onListeners.add(fn);
      return () => onListeners.delete(fn);
    },
    onNoteOff(fn) {
      offListeners.add(fn);
      return () => offListeners.delete(fn);
    },
    emitNoteOn(payload) {
      onListeners.forEach((fn) => fn(payload));
    },
    emitNoteOff(payload) {
      offListeners.forEach((fn) => fn(payload));
    },
  };
}
