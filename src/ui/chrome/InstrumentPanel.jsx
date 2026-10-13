import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { loadSample } from "../../audio/instrumentLoader.js";
import { initRuntime } from "../../audio/runtime.js";
import { toHex } from "../../model/notes.js";

// Instrument gain's own musical range — same scale as model/fxParams.js's "bus.gain" entry
// (0..2, step 0.01, unit "x") so the two read consistently wherever a user sees both, even
// though instrument gain isn't itself an FX_PARAMS entry (it addresses webdsp's per-sample
// SampleParam.Gain, not a bus NodeParam — see audio/instrumentGain.js).
const GAIN_MIN = 0;
const GAIN_MAX = 2;
const GAIN_STEP = 0.01;

// Primitive selectors throughout — see ui/chrome/Mixer.jsx's doc comment for why
// (useSyncExternalStore compares with Object.is; the instrument slot objects mutate in place).
function InstrumentSlotRow({ store, instrumentController, index }) {
  const name = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.name ?? "");
  const hasSample = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleId != null);
  const selected = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex === index);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await initRuntime(); // picking a file is itself a user gesture
    const arrayBuffer = await file.arrayBuffer();
    // loadSample() may hand the buffer to the audio worklet by transfer, which detaches it —
    // keep a separate copy so project save (src/persistence/) still has real bytes to embed.
    const storedBuffer = arrayBuffer.slice(0);
    const sample = await loadSample(arrayBuffer, file.name);
    instrumentController.setSample(index, sample.id, file.name, {
      buffer: storedBuffer,
      mimeType: file.type || "audio/wav",
      fileName: file.name,
    });
    e.target.value = "";
  }

  return (
    <div className={`instrument-slot${selected ? " instrument-slot--selected" : ""}`}>
      <button className="instrument-slot__select" onClick={() => store.selectInstrument(index)} title="Select for note entry">
        {toHex(index)}
      </button>
      <span className={`instrument-slot__name${hasSample ? "" : " instrument-slot__name--empty"}`}>
        {hasSample ? name : "(empty)"}
      </span>
      <label className="instrument-slot__load">
        LOAD
        <input type="file" accept="audio/*" onChange={handleFileChange} hidden />
      </label>
    </div>
  );
}

// The selected instrument's own editable properties — currently just gain, the one property
// this feature adds (ECS-? gain staging). "Selected" is selectedInstrumentIndex, the same
// notion of "current instrument" the hex-id select buttons above already set for note entry —
// not a second, independent selection. Lives here (not a separate top-level component) because
// it's conceptually part of the instrument panel, the same way FxPanel's pinned Output module
// is part of the FX panel rather than its own thing.
function InstrumentEditor({ store, instrumentController }) {
  const index = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex);
  const name = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.name ?? "");
  const hasSample = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleId != null);
  const gain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.gain ?? 1);

  if (!hasSample) return null;

  return (
    <div className="instrument-editor">
      <div className="instrument-editor__header">
        {toHex(index)} — {name}
      </div>
      <label className="fx-module__field">
        <span className="fx-module__field-label" title="Gain">
          Gain
        </span>
        <input
          type="range"
          min={GAIN_MIN}
          max={GAIN_MAX}
          step={GAIN_STEP}
          value={gain}
          onChange={(e) => instrumentController.setGain(index, Number(e.target.value))}
        />
        <span className="fx-module__value">{gain.toFixed(2)}x</span>
      </label>
    </div>
  );
}

export default function InstrumentPanel({ store, instrumentController }) {
  const instrumentCount = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments.length);

  return (
    <div className="instrument-panel">
      <div className="instrument-panel__header">INSTRUMENTS</div>
      {Array.from({ length: instrumentCount }, (_, i) => (
        <InstrumentSlotRow key={i} store={store} instrumentController={instrumentController} index={i} />
      ))}
      <button className="instrument-panel__add" onClick={() => store.addInstrumentSlot()}>
        + ADD SLOT
      </button>
      <InstrumentEditor store={store} instrumentController={instrumentController} />
    </div>
  );
}
