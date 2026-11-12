import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { NOTE_SPACINGS } from "../../model/timing.js";

// Where the cursor lands after a note is entered from the keyboard or a MIDI device (store.editStep, in rows).
// Sits at the right of the Tracker/Patterns tab row.
export default function NoteSpacingControl({ store }) {
  const editStep = useStore(store, events.CURSOR_MOVED, (s) => s.editStep);
  const isPreset = NOTE_SPACINGS.some(({ rows }) => rows === editStep);

  return (
    <label className="app__tab-controls" title="Note spacing: how far the cursor advances after each entered note">
      NOTE SPACING
      <select value={editStep} onChange={(e) => store.setEditStep(Number(e.target.value))}>
        {!isPreset && <option value={editStep}>{editStep} rows</option>}
        {NOTE_SPACINGS.map(({ label, rows }) => (
          <option key={rows} value={rows}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
