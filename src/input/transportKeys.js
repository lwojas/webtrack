// App-level transport/mode keys — Space (play/stop) and Esc (toggle edit mode) — separate
// from per-cell editing (editController.js) and note production (keyboardNoteMap.js), since
// these apply regardless of which grid column has focus.
export function attachTransportKeys({ onTogglePlay, onToggleEditMode } = {}, target = window) {
  function handleKeyDown(e) {
    if (e.repeat) return;
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
