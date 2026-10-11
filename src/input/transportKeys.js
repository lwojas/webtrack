import { isTypingTarget } from "./isTypingTarget.js";

// App-level transport/mode keys — Space (play/stop) and Esc (toggle edit mode) — separate
// from per-cell editing (editController.js) and note production (keyboardNoteMap.js), since
// these apply regardless of which grid column has focus.
export function attachTransportKeys({ onTogglePlay, onToggleEditMode } = {}, target = window) {
  function handleKeyDown(e) {
    if (e.repeat) return;
    // A space typed into the project name (or any other field) must stay a space, not also
    // toggle playback — see isTypingTarget.js.
    if (isTypingTarget(e)) return;
    if (e.code === "Space") {
      e.preventDefault();
      onTogglePlay?.();
    } else if (e.code === "Escape") {
      e.preventDefault();
      onToggleEditMode?.();
    }
  }

  target.addEventListener("keydown", handleKeyDown);
  return () => target.removeEventListener("keydown", handleKeyDown);
}
