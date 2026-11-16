import { useState } from "react";
import Knob from "../Knob.jsx";
import ModBadge from "./ModBadge.jsx";
import { rangeFillStyle } from "../rangeFill.js";
import { GROUP_SIZES, MAX_GROUPS, addGroup, assignControl, layoutControls, removeGroup, updateGroup } from "../../model/instrumentUi.js";

// The instrument editor's control layer: one control renders as a classic slider row or a rotary
// knob (a per-viewer preference), and a list of controls renders as the ungrouped flow plus the
// instrument's own named groups (model/instrumentUi.js) with an accent hue and size. Callers hand
// in plain descriptors, so every control (synth params, sample gain, envelope) shares this path.
//
//   { id, label, title?, min, max, step, value, text, onChange(v), onReset?(), automated?, lfos? }
const STYLE_KEY = "webtracker.controlStyle";

export function useControlStyle() {
  const [style, setStyle] = useState(() => {
    try {
      return localStorage.getItem(STYLE_KEY) === "sliders" ? "sliders" : "knobs";
    } catch {
      return "knobs";
    }
  });
  function choose(next) {
    setStyle(next);
    try {
      localStorage.setItem(STYLE_KEY, next);
    } catch {
      // storage unavailable: the choice holds for this session only
    }
  }
  return [style, choose];
}

const KnobIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3.6 12.4A6 6 0 1 1 12.4 12.4" />
    <path d="M8 8 L10.4 4.6" />
  </svg>
);

const SlidersIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 4h12M2 8h12M2 12h12" />
    <circle cx="5" cy="4" r="1.6" fill="currentColor" />
    <circle cx="10.5" cy="8" r="1.6" fill="currentColor" />
    <circle cx="6.5" cy="12" r="1.6" fill="currentColor" />
  </svg>
);

// Icon tabs that switch between the two control styles, plus the layout (grouping) edit toggle.
export function ControlStyleTabs({ style, onStyleChange, editing, onEditingChange }) {
  return (
    <div className="control-tabs">
      <div className="control-tabs__group" role="tablist" aria-label="Control style">
        {[["knobs", "Knobs", <KnobIcon key="k" />], ["sliders", "Sliders", <SlidersIcon key="s" />]].map(([id, title, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={style === id}
            title={title}
            className={`control-tabs__btn${style === id ? " control-tabs__btn--active" : ""}`}
            onClick={() => onStyleChange(id)}
          >
            {icon}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={editing}
        title="Group and style this instrument's controls"
        className={`control-tabs__btn control-tabs__btn--text${editing ? " control-tabs__btn--active" : ""}`}
        onClick={() => onEditingChange(!editing)}
      >
        GROUPS
      </button>
    </div>
  );
}

function ControlField({ control, style, hue, size, groups, assigned, editing, onAssign }) {
  const { id, label, title, min, max, step, value, text, onChange, onReset, automated, lfos = 0 } = control;
  const badge = <ModBadge automated={!!automated} lfos={lfos} />;
  const assign = editing && (
    <select className="control-assign" value={assigned ?? ""} onChange={(e) => onAssign(id, e.target.value || null)} aria-label={`${label} group`}>
      <option value="">—</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );

  if (style === "knobs") {
    return (
      <div className="knob-field">
        <Knob value={value} min={min} max={max} step={step} onChange={onChange} onReset={onReset} label={label} valueText={text} hue={hue} size={size} />
        <span className="knob-field__label" title={title ?? label}>
          {label}
          {badge}
        </span>
        <span className="knob-field__value">{text}</span>
        {assign}
      </div>
    );
  }
  return (
    <label className="fx-module__field">
      <span className="fx-module__field-label" title={title ?? label}>
        {label}
        {badge}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
        style={rangeFillStyle(value, min, max)}
      />
      <span className="fx-module__value">{text}</span>
      {assign}
    </label>
  );
}

function GroupHeader({ group, editing, onChange, onRemove }) {
  if (!editing) {
    return (
      <button type="button" className="control-group__title" aria-expanded={!group.collapsed} onClick={() => onChange({ collapsed: !group.collapsed })}>
        <span aria-hidden="true">{group.collapsed ? "▸" : "▾"}</span> {group.name}
      </button>
    );
  }
  return (
    <div className="control-group__edit">
      <input
        className="control-group__name"
        value={group.name}
        maxLength={24}
        aria-label="Group name"
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <input
        type="range"
        className="control-group__hue"
        min={0}
        max={359}
        value={group.hue ?? 0}
        aria-label="Group color"
        title="Group color"
        onChange={(e) => onChange({ hue: Number(e.target.value) })}
        style={{ "--range-progress": "0%" }}
      />
      <button type="button" className="control-group__btn" onClick={() => onChange({ hue: null })} title="Neutral color">
        ∅
      </button>
      <span className="control-group__sizes" role="group" aria-label="Group size">
        {GROUP_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`control-group__btn${group.size === s ? " control-group__btn--active" : ""}`}
            aria-pressed={group.size === s}
            onClick={() => onChange({ size: s })}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </span>
      <button type="button" className="control-group__btn" onClick={onRemove} title="Delete group (controls return to the ungrouped flow)">
        ✕
      </button>
    </div>
  );
}

// `controls`: descriptors in catalog order. `ui` is the instrument's layout; `onUiChange(update)`
// receives a (ui) => ui function (store.updateInstrumentUi).
export default function ControlGroups({ controls, ui, style, editing, onUiChange }) {
  const { ungrouped, groups } = layoutControls(ui, controls);
  const allGroups = groups.map((g) => g.group);
  const assignOf = (id) => ui?.assign?.[id] ?? null;
  const field = (control, group) => (
    <ControlField
      key={control.id}
      control={control}
      style={style}
      hue={group?.hue ?? null}
      size={group?.size ?? "m"}
      groups={allGroups}
      assigned={assignOf(control.id)}
      editing={editing}
      onAssign={(id, groupId) => onUiChange((current) => assignControl(current, id, groupId))}
    />
  );
  const flow = (items, group) => (style === "knobs" ? <div className={`knob-row knob-row--${group?.size ?? "m"}`}>{items.map((c) => field(c, group))}</div> : items.map((c) => field(c, group)));

  return (
    <>
      {ungrouped.length > 0 && flow(ungrouped, null)}
      {groups.map(({ group, controls: items }) => (
        <section
          key={group.id}
          className={`control-group control-group--${group.size}${group.hue == null ? "" : " control-group--tinted"}`}
          style={group.hue == null ? undefined : { "--group-hue": group.hue }}
        >
          <GroupHeader
            group={group}
            editing={editing}
            onChange={(patch) => onUiChange((current) => updateGroup(current, group.id, patch))}
            onRemove={() => onUiChange((current) => removeGroup(current, group.id))}
          />
          {!group.collapsed || editing ? (
            items.length > 0 ? (
              <div className="control-group__body">{flow(items, group)}</div>
            ) : (
              <div className="control-group__empty">{editing ? "Assign controls using the menu beside each one." : "Empty"}</div>
            )
          ) : null}
        </section>
      ))}
      {editing && (
        <button
          type="button"
          className="fx-panel__target-btn control-group__add"
          disabled={groups.length >= MAX_GROUPS}
          onClick={() => onUiChange((current) => addGroup(current, "GROUP"))}
        >
          + ADD GROUP
        </button>
      )}
    </>
  );
}
