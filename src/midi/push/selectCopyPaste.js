// Push "Select" (CC48) copy/paste — a momentary modifier shared by Note Mode
// (noteEntryMode.js) and Session/Grid Mode (trackerGridMode.js). Pure functions over
// state/store.js's own clipboard (`copySelection`/`pasteSelection`, the exact mutators
// Ctrl/Cmd+C/V and the toolbar's Copy/Paste buttons already use) — never a second,
// Push-only clipboard or paste implementation (the brief this was built from is explicit
// about that).
//
// This is deliberately not a stateful module the way writeMode.js is one for CC86: Select's
// "is it currently held" lifecycle has to reset the moment the active grid content changes or
// write mode turns off, exactly like CC_SHIFT's own live-held state already does in
// trackerGridMode.js — so each content tracks that bit locally (reset in its own onEnter/
// onExit), and only the actual store actions live here, shared so the two contents can't drift
// into two slightly different copy/paste behaviors.
import { getSelectedPattern } from "../../model/query.js";

// Collapses any active range selection onto the cursor's own single cell (the same
// collapse-then-act pattern trackerGridMode.js's own collapseSelectionToCursor/handleDuplicate
// already use), then copies exactly that cell via store.copySelection() — "the currently
// selected/cursor cell," per the brief, never whatever a pending Shift-made range happens to
// span. Returns false without copying anything if there's no valid cell under the cursor right
// now (the brief's own edge case), so a stale, previously-copied clipboard entry is never
// mistaken for a fresh copy of an invalid cell by a caller that only checks "is held."
export function copyCurrentCellToClipboard(store) {
  const { cursor, song } = store.getState();
  const pattern = getSelectedPattern(song);
  if (!pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex]) return false;
  store.selectCell(cursor.trackIndex, cursor.rowIndex, cursor.field);
  store.copySelection();
  return true;
}

// Pastes the application clipboard into (trackIndex, rowIndex, field) and selects that cell —
// the exact store.selectCell + store.pasteSelection pair any other Push write-mode destination
// pick already uses, so a Push paste goes through the identical state/update pathway a desktop
// paste does (tracker state -> CURSOR_MOVED/CELL_CHANGED -> UI and Push repaint, both already
// wired). A no-op without a clipboard — nothing was ever copied — so a pad press can never
// perform an unintended paste.
export function pasteClipboardIntoCell(store, trackIndex, rowIndex, field) {
  if (!store.getState().clipboard) return;
  store.selectCell(trackIndex, rowIndex, field);
  store.pasteSelection();
}
