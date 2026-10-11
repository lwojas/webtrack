import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { loadSample } from "../../audio/instrumentLoader.js";
import { initRuntime } from "../../audio/runtime.js";
import { toHex } from "../../model/notes.js";

// Primitive selectors throughout — see ui/chrome/Mixer.jsx's doc comment for why
// (useSyncExternalStore compares with Object.is; the instrument slot objects mutate in place).
function InstrumentSlotRow({ store, index }) {
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
    store.setInstrumentSample(index, sample.id, file.name, {
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

export default function InstrumentPanel({ store }) {
  const instrumentCount = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments.length);

  return (
    <div className="instrument-panel">
      <div className="instrument-panel__header">INSTRUMENTS</div>
      {Array.from({ length: instrumentCount }, (_, i) => (
        <InstrumentSlotRow key={i} store={store} index={i} />
      ))}
      <button className="instrument-panel__add" onClick={() => store.addInstrumentSlot()}>
        + ADD SLOT
      </button>
    </div>
  );
}
