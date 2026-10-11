// Shared by every window-level keydown listener (editController.js, transportKeys.js) so a
// shortcut that's meant to act on the grid — copy/paste, Space to play/stop, Esc to toggle
// edit mode — never fires while the user is typing into an ordinary form control (the BPM
// field, the project name field, the note editor's inputs, a <select>).
export function isTypingTarget(e) {
  const tag = e.target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
