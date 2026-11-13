import { useState } from "react";
import Mixer from "./Mixer.jsx";
import FxPanel from "./FxPanel.jsx";
import TrackPanel from "./TrackPanel.jsx";
import { useCollapsed } from "./collapse.jsx";

const VIEWS = [
  { id: "mixer", label: "MIXER" },
  { id: "fx", label: "FX" },
  { id: "track", label: "TRACK" },
];

// The lower panel under the tracker grid (see App.jsx) — Mixer, FxPanel and TrackPanel share this one slot
// instead of each getting a permanent spot, switched the same way the top-level Tracker/
// Patterns tabs already work (reusing .app__tabs/.app__tab's look, see styles/tracker.css).
export default function MixerFxPanel({ store, fxController }) {
  const [view, setView] = useState("mixer");
  const [collapsed, toggleCollapsed] = useCollapsed("lower-panel");

  return (
    <div className="lower-panel">
      <div className="app__tabs lower-panel__tabs" role="tablist" aria-label="Mixer, FX or Track">
        <button
          className="app__tab lower-panel__toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand the mixer" : "Collapse the mixer"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={`app__tab${view === v.id ? " app__tab--active" : ""}`}
            onClick={() => {
              setView(v.id);
              if (collapsed) toggleCollapsed();
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {!collapsed && view === "mixer" && <Mixer store={store} fxController={fxController} />}
      {!collapsed && view === "fx" && <FxPanel store={store} fxController={fxController} />}
      {!collapsed && view === "track" && <TrackPanel store={store} fxController={fxController} />}
    </div>
  );
}
