// Spread onto a themed <input type="range"> (see tracker.css's input[type="range"] rule) to
// color the filled portion of its track up to the current value — every linear slider in the
// app wants this except the bipolar pan controls (Mixer.jsx's channel-strip__pan, FxPanel.jsx's
// Output Pan, NoteEditor.jsx's PAN), which simply don't spread it and render the plain unfilled
// track instead.
export function rangeFillStyle(value, min, max) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return { "--range-progress": `${Math.min(100, Math.max(0, pct))}%` };
}
