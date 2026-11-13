import { useEffect, useState, useSyncExternalStore } from "react";
import { CC_CONTROLS, CC_GROUPS, STRIP_COUNT } from "../../midi/cc/ccCatalog.js";
import { defaultBinding, sameBinding } from "../../midi/cc/ccMap.js";

// The MIDI MAP view: one row per control in midi/cc/ccCatalog.js, grouped, so a control added to the catalog shows up here with
// no change to this file. All state lives in the cc controller (appContext.js's ccController); this only renders its snapshot.
function useCcSnapshot(ccController) {
  return useSyncExternalStore(ccController.subscribe, ccController.getSnapshot);
}

// The last CC received, for checking a controller. Subscribes only while this view is mounted, so the router does no
// monitor work otherwise.
function useCcActivity(ccController) {
  const [activity, setActivity] = useState(() => ccController.getActivity());
  useEffect(() => ccController.subscribeActivity(() => setActivity(ccController.getActivity())), [ccController]);
  return activity;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i);

function BindingRow({ def, binding, conflicts, learning, ccController }) {
  const isDefault = sameBinding(binding, defaultBinding(def));
  const learningThis = learning === def.id;
  const clash = conflicts[def.id];
  const kindHint = def.kind === "continuous" ? "fader / knob" : def.kind === "toggle" ? "press toggles" : "press";

  return (
    <tr className={`midi-map__row${learningThis ? " midi-map__row--learning" : ""}`}>
      <td className="midi-map__label">
        {def.label}
        <span className="midi-map__hint">{kindHint}</span>
      </td>
      <td>
        {def.scope === "strip" ? (
          <span className="midi-map__channel-note" title="The MIDI channel picks the mixer strip">
            ch 1–{STRIP_COUNT} = strip 1–{STRIP_COUNT}
          </span>
        ) : (
          <select
            className="midi-map__select"
            value={binding.channel}
            aria-label={`${def.label} MIDI channel`}
            onChange={(e) => ccController.setBinding(def.id, { cc: binding.cc, channel: Number(e.target.value) })}
          >
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                ch {channel + 1}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        <input
          className="midi-map__cc"
          type="number"
          min={0}
          max={127}
          value={binding.cc}
          aria-label={`${def.label} CC number`}
          onChange={(e) => {
            const cc = Number(e.target.value);
            if (e.target.value !== "" && Number.isInteger(cc)) ccController.setBinding(def.id, { cc: Math.min(127, Math.max(0, cc)), channel: binding.channel });
          }}
        />
      </td>
      <td className="midi-map__actions">
        <button
          type="button"
          className={`transport-bar__chip${learningThis ? " midi-map__learn--active" : ""}`}
          onClick={() => ccController.setLearning(learningThis ? null : def.id)}
          title="Move or press a control on your device to assign it"
        >
          {learningThis ? "MOVE A CONTROL…" : "LEARN"}
        </button>
        <button type="button" className="transport-bar__chip" disabled={isDefault} onClick={() => ccController.resetBinding(def.id)}>
          RESET
        </button>
        {clash && (
          <span className="midi-map__clash" title={`Same CC as ${clash.join(", ")}: both will respond`}>
            ⚠ shared
          </span>
        )}
      </td>
    </tr>
  );
}

export default function MidiMapView({ ccController }) {
  const { bindings, conflicts, learning } = useCcSnapshot(ccController);
  const activity = useCcActivity(ccController);

  return (
    <div className="midi-map">
      <div className="midi-map__header">
        <span className="midi-map__title">MIDI CC MAP</span>
        <span className="midi-map__monitor" aria-live="off">
          {activity ? `last: ch ${activity.channel + 1} · CC ${activity.cc} · ${activity.value}` : "last: waiting for a CC message…"}
        </span>
        <button type="button" className="transport-bar__chip" onClick={() => ccController.resetAll()}>
          RESET ALL
        </button>
      </div>
      {CC_GROUPS.map((group) => (
        <section className="midi-map__group" key={group}>
          <h3 className="midi-map__group-title">{group.toUpperCase()}</h3>
          <table className="midi-map__table">
            <tbody>
              {CC_CONTROLS.filter((def) => def.group === group).map((def) => (
                <BindingRow key={def.id} def={def} binding={bindings[def.id]} conflicts={conflicts} learning={learning} ccController={ccController} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="midi-map__note">
        Mixer strips follow the MIDI channel: channel 1 drives strip 1, channel 2 strip 2, and so on. Changes are saved in this browser. Push ports are ignored here.
      </p>
    </div>
  );
}
