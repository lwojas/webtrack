import { useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { STEPS_PER_BAR, STEPS_PER_BEAT } from "../../model/timing.js";

// Note spacing for the chop tools, in rows (one row = a 16th).
const CHOP_SPACINGS = [
  { label: "16th", rows: 1 },
  { label: "8th", rows: STEPS_PER_BEAT / 2 },
  { label: "1/4", rows: STEPS_PER_BEAT },
  { label: "1/2", rows: STEPS_PER_BEAT * 2 },
  { label: "1 bar", rows: STEPS_PER_BAR },
];

// Discoverability for the selection-editing operations store.js already exposes (copySelection/
// pasteSelection/clearSelection/fillSelection) — Ctrl/Cmd+C/V and Backspace/Delete
// (src/input/editController.js) reach the exact same store methods, so this panel is a second
// entry point onto them, never a second implementation. Sits in the normal page layout right
// under the note editor (src/App.jsx), not a floating/positioned overlay — see the Phase 1
// selection-toolbar brief.
//
// Repeat / Fill Right / Fill Down all tile the *clipboard* across the current selection
// (store.js#fillSelection) rather than some sub-rectangle of the selection itself — reusing
// copy/paste's own clipboard this way needs one extra step (copy the source block, extend the
// selection, then fill) but keeps a single, predictable source for all three, and for the
// existing clipboard shortcuts too. They differ only in which axis makes them worth enabling:
// Fill Right wants more than one track selected, Fill Down more than one row, Repeat either.
export default function SelectionToolbar({ store }) {
  const [chopSpacing, setChopSpacing] = useState(1);
  // getSelectionRect() builds a fresh object every call — selecting it directly would hand
  // useSyncExternalStore a snapshot that's never equal to its own last return, which is an
  // infinite render loop, not just a wasted one (see ARCHITECTURE.md's in-place-mutation
  // gotcha; ui/chrome/NoteEditor.jsx's own selector hits the same thing for its event
  // fingerprint). Select a primitive fingerprint of cursor+anchor instead, purely to trigger
  // re-render, then read the rect itself straight off the store in the render body.
  useStore(
    store,
    events.CURSOR_MOVED,
    (s) => `${s.cursor.trackIndex}.${s.cursor.rowIndex}.${s.selectionAnchor.trackIndex}.${s.selectionAnchor.rowIndex}.${s.selectedInstrumentIndex}`,
  );
  // The chop tools work with the selected instrument being a chop-mode sample; its mode and cues change on INSTRUMENTS_CHANGED,
  // picking another instrument moves CURSOR_MOVED (above). A boolean keeps the snapshot stable.
  const chopReady = useStore(store, events.INSTRUMENTS_CHANGED, (s) => store.getChopInstrument() !== null && s.instruments.length > 0);
  const hasClipboard = useStore(store, events.CLIPBOARD_CHANGED, (s) => s.clipboard !== null);
  const rect = store.getSelectionRect();

  const spansTracks = rect.trackEnd > rect.trackStart;
  const spansRows = rect.rowEnd > rect.rowStart;
  const spansMultipleCells = spansTracks || spansRows;

  function handleCopy() {
    store.copySelection();
  }

  function handlePaste() {
    store.pasteSelection();
  }

  function handleClear() {
    store.clearSelection();
  }

  function handleRepeat() {
    store.fillSelection();
  }

  function handleFillRight() {
    store.fillSelection();
  }

  function handleFillDown() {
    store.fillSelection();
  }

  function handleChopFill() {
    store.chopSelection({ spacing: chopSpacing });
  }

  function handleChopRandomise() {
    store.chopSelection({ random: true, spacing: chopSpacing });
  }

  // A single cell stands for the cursor's whole track; anything bigger is exactly the selection.
  const chopTitle = chopReady
    ? spansMultipleCells
      ? "Applies to the selection"
      : "Applies to the whole track"
    : "Select an instrument in chop mode";

  return (
    <div className="selection-toolbar">
      <span className="selection-toolbar__label">SELECTION</span>
      <div className="selection-toolbar__actions">
        <button type="button" className="selection-toolbar__button" onClick={handleCopy}>
          Copy
        </button>
        <button type="button" className="selection-toolbar__button" onClick={handlePaste} disabled={!hasClipboard}>
          Paste
        </button>
        <button type="button" className="selection-toolbar__button" onClick={handleClear}>
          Clear
        </button>
        <button
          type="button"
          className="selection-toolbar__button"
          onClick={handleRepeat}
          disabled={!hasClipboard || !spansMultipleCells}
        >
          Repeat
        </button>
        <button
          type="button"
          className="selection-toolbar__button"
          onClick={handleFillRight}
          disabled={!hasClipboard || !spansTracks}
        >
          Fill Right
        </button>
        <button
          type="button"
          className="selection-toolbar__button"
          onClick={handleFillDown}
          disabled={!hasClipboard || !spansRows}
        >
          Fill Down
        </button>
      </div>
      <span className="selection-toolbar__label selection-toolbar__label--sub">CHOP TOOLS</span>
      <div className="selection-toolbar__actions">
        <label className="selection-toolbar__field" title="Rows between chop notes">
          SPACING
          <select
            className="selection-toolbar__select"
            value={chopSpacing}
            onChange={(e) => setChopSpacing(Number(e.target.value))}
            disabled={!chopReady}
          >
            {CHOP_SPACINGS.map(({ label, rows }) => (
              <option key={rows} value={rows}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="selection-toolbar__button" onClick={handleChopFill} disabled={!chopReady} title={chopTitle}>
          Fill with Chops
        </button>
        <button type="button" className="selection-toolbar__button" onClick={handleChopRandomise} disabled={!chopReady} title={chopTitle}>
          Randomise Chops
        </button>
      </div>
    </div>
  );
}
