import { useState } from "react";

// Collapsible sections of the right column (selection, instruments, note editor). The open/closed
// choice is a per-viewer convenience, kept in localStorage (guarded: it can be missing or throw)
// and keyed per section so a reload keeps the layout the user left.
const KEY = "webtracker.collapsed.";

function readCollapsed(id) {
  try {
    return localStorage.getItem(KEY + id) === "1";
  } catch {
    return false;
  }
}

export function useCollapsed(id) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  function toggle() {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(KEY + id, prev ? "0" : "1");
      } catch {
        // storage unavailable: the section still collapses for this session
      }
      return !prev;
    });
  }
  return [collapsed, toggle];
}

// The section's title row, a button so it works from the keyboard. `className` carries the
// panel's own header styling (they differ slightly between panels).
export function SectionHeader({ className, collapsed, onToggle, children }) {
  return (
    <button type="button" className={`${className} section-toggle`} onClick={onToggle} aria-expanded={!collapsed}>
      <span className="section-toggle__chevron" aria-hidden="true">
        {collapsed ? "▸" : "▾"}
      </span>
      {children}
    </button>
  );
}
