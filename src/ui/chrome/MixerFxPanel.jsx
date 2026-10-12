import { useState } from "react";
import Mixer from "./Mixer.jsx";
import FxPanel from "./FxPanel.jsx";

const VIEWS = [
  { id: "mixer", label: "MIXER" },
  { id: "fx", label: "FX" },
];

// The lower panel under the tracker grid (see App.jsx) — Mixer and FxPanel share this one slot
// instead of each getting a permanent spot, switched the same way the top-level Tracker/
// Patterns tabs already work (reusing .app__tabs/.app__tab's look, see styles/tracker.css).
export default function MixerFxPanel({ store, fxController }) {
  const [view, setView] = useState("mixer");

  return (
    <div className="lower-panel">
      <div className="app__tabs lower-panel__tabs" role="tablist" aria-label="Mixer or FX">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={`app__tab${view === v.id ? " app__tab--active" : ""}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "mixer" ? <Mixer store={store} /> : <FxPanel store={store} fxController={fxController} />}
    </div>
  );
}
