import { useEffect, useState, useSyncExternalStore } from "react";

const SETTINGS_SECTIONS = [{ id: "midi", label: "MIDI" }];

// Same "external store" shape state/useStore.js already establishes for the app store, just
// reading midiController's own snapshot/subscribe pair instead — midiController (appContext.js)
// is the only thing this component calls, so it never touches midi/deviceManager.js or
// midi/push/pushDevice.js directly (per the brief: no device-management logic duplicated here).
function usePortSnapshot(midiController) {
  return useSyncExternalStore(midiController.subscribeDevices, midiController.getDeviceSnapshot);
}

function usePushConnected(midiController) {
  return useSyncExternalStore(
    (onChange) => midiController.subscribePushConnection(() => onChange()),
    midiController.isPushConnected,
  );
}

function PortRow({ port }) {
  return (
    <li className={`settings-modal__port${port.likelyPush ? " settings-modal__port--push" : ""}`}>
      <span className="settings-modal__port-name">{port.name}</span>
      {port.manufacturer && <span className="settings-modal__port-manufacturer">{port.manufacturer}</span>}
      {port.likelyPush && <span className="settings-modal__port-tag">PUSH</span>}
    </li>
  );
}

function MidiSection({ midiController }) {
  const snapshot = usePortSnapshot(midiController);
  const pushConnected = usePushConnected(midiController);

  useEffect(() => {
    midiController.requestAccess();
  }, [midiController]);

  return (
    <div className="settings-modal__section">
      <div className="settings-modal__push-status">
        <span className={`settings-modal__status-dot${pushConnected ? " settings-modal__status-dot--connected" : ""}`} />
        <span>Push Mk1 {pushConnected ? "connected" : "not connected"}</span>
        <button type="button" className="transport-bar__chip" onClick={() => midiController.reconnectPush()}>
          {pushConnected ? "RECONNECT" : "CONNECT"}
        </button>
        <button type="button" className="transport-bar__chip" onClick={() => midiController.refreshPush()} disabled={!pushConnected}>
          REFRESH PUSH STATE
        </button>
      </div>

      {!snapshot.ready && <p className="settings-modal__hint">Requesting MIDI access…</p>}

      {snapshot.ready && (
        <>
          <div className="settings-modal__port-group">
            <h4>Inputs</h4>
            {snapshot.inputs.length === 0 ? (
              <p className="settings-modal__hint">No MIDI input devices detected.</p>
            ) : (
              <ul className="settings-modal__port-list">
                {snapshot.inputs.map((port) => (
                  <PortRow key={port.id} port={port} />
                ))}
              </ul>
            )}
          </div>
          <div className="settings-modal__port-group">
            <h4>Outputs</h4>
            {snapshot.outputs.length === 0 ? (
              <p className="settings-modal__hint">No MIDI output devices detected.</p>
            ) : (
              <ul className="settings-modal__port-list">
                {snapshot.outputs.map((port) => (
                  <PortRow key={port.id} port={port} />
                ))}
              </ul>
            )}
          </div>
          <p className="settings-modal__hint">
            Every detected input already feeds live note entry automatically; Push is recognized by name and connects on its own —
            use Reconnect above if it was plugged in after this page loaded.
          </p>
        </>
      )}
    </div>
  );
}

// A reusable settings surface (App.jsx owns the open/closed boolean) — structured as a section
// list + content switch, the same tab pattern App.jsx's own TABS / MixerFxPanel.jsx's own VIEWS
// already establish, so a second settings section later is a one-array-entry addition, not a
// rewrite. Only one section (MIDI) exists today.
export default function SettingsModal({ open, onClose, midiController }) {
  const [sectionId, setSectionId] = useState(SETTINGS_SECTIONS[0].id);

  if (!open) return null;

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal__header">
          <h3>Settings</h3>
          <button type="button" className="settings-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-modal__nav" role="tablist" aria-label="Settings section">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                role="tab"
                aria-selected={sectionId === section.id}
                className={`settings-modal__nav-item${sectionId === section.id ? " settings-modal__nav-item--active" : ""}`}
                onClick={() => setSectionId(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
          <div className="settings-modal__content">{sectionId === "midi" && <MidiSection midiController={midiController} />}</div>
        </div>
      </div>
    </div>
  );
}
