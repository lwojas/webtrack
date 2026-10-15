import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { loadSample } from "../../audio/instrumentLoader.js";
import { initRuntime } from "../../audio/runtime.js";
import { toHex } from "../../model/notes.js";
import { ENVELOPE_PARAMS, formatEnvelopeValue } from "../../model/envelopeParams.js";
import { getSynthParams, formatSynthParamValue } from "../../model/instrumentParams.js";
import { downloadBytes } from "../../persistence/projectIO.js";

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
  const isResample = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.origin === "resample");
  const isMidiOutput = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.type === "midi");
  const synthKind = useStore(store, events.INSTRUMENTS_CHANGED, (s) =>
    s.instruments[index]?.output?.type === "instrument" ? s.instruments[index].output.kind : null,
  );
  const selected = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex === index);
  // A MIDI-output or synthesized-instrument slot is "configured" without ever needing a sample
  // — see InstrumentEditor's output picker below, which is what actually sets either.
  const isConfigured = isMidiOutput || synthKind != null || hasSample;

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

  // Saves this slot's own sample bytes back out as a standalone file — works identically for an
  // imported or a resampled sample, no distinction made (see docs/RESAMPLE.md's "What this
  // doesn't do" for why no restriction is applied here). Reads sampleAsset directly off the
  // store rather than through a useStore selector: it's only ever needed at click time, not on
  // every render, and sampleAsset is a mutable object the in-place-mutation gotcha
  // (docs/ARCHITECTURE.md) already warns against selecting for re-renders.
  function handleDownload() {
    const instrument = store.getState().instruments[index];
    if (!instrument?.sampleAsset) return;
    downloadBytes(instrument.sampleAsset.buffer, instrument.sampleAsset.mimeType, instrument.sampleAsset.fileName);
  }

  return (
    <div className={`instrument-slot${selected ? " instrument-slot--selected" : ""}`}>
      <button className="instrument-slot__select" onClick={() => store.selectInstrument(index)} title="Select for note entry">
        {toHex(index)}
      </button>
      <span className={`instrument-slot__name${isConfigured ? "" : " instrument-slot__name--empty"}`}>
        {isConfigured
          ? `${name}${isMidiOutput ? " · MIDI" : ""}${synthKind ? ` · ${synthKind.toUpperCase()}` : ""}${isResample ? " · R" : ""}`
          : "(empty)"}
      </span>
      {hasSample && (
        <button className="instrument-slot__download" onClick={handleDownload} title="Download this slot's sample as a file">
          ↓
        </button>
      )}
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
// MIDI channel is stored 0-15 (the wire value — see model/instrument.js, audio/compile.js)
// but shown 1-16, the convention most MIDI gear/DAWs display to a human.
const MIDI_CHANNEL_MIN = 0;
const MIDI_CHANNEL_MAX = 15;

function InstrumentEditor({ store, instrumentController }) {
  const index = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex);
  const name = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.name ?? "");
  const exists = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index] != null);
  const hasSample = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleId != null);
  const gain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.gain ?? 1);
  const outputType = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.type ?? "sample");
  const outputChannel = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.channel ?? null);
  const outputKind = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.kind ?? null);
  // One primitive selector per field (not `s.instruments[index]?.envelope` itself) — the same
  // in-place-mutation gotcha every other mutable-object field on this page already works around
  // (see this file's own module doc comment / ARCHITECTURE.md's Gotcha #1).
  const attack = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.attack ?? 0);
  const decay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.decay ?? 0);
  const sustain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.sustain ?? 1);
  const release = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.release ?? 0.01);
  const envelopeValues = { attack, decay, sustain, release };

  // Kick's own controls (model/instrumentParams.js#KICK_PARAMS) — same one-primitive-per-field
  // shape as envelopeValues above, for the same Gotcha #1 reason. Only meaningful while
  // outputKind === "kick"; harmless (just unused) otherwise.
  const tune = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.tune ?? 50);
  const pitchDrop = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pitchDrop ?? 2.5);
  const pitchDecay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pitchDecay ?? 0.04);
  const kickDecay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.decay ?? 0.45);
  const punch = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.punch ?? 0.5);
  const drive = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.drive ?? 0.3);
  const synthParamValues = { tune, pitchDrop, pitchDecay, decay: kickDecay, punch, drive };

  if (!exists) return null;

  // Switching to "midi" needs a channel right away (compileEvent treats a missing channel as
  // "nothing to send" — see audio/compile.js) — default to the last one used, or channel 1.
  // Switching to "instrument" needs a kind — "kick" is the only one webdsp provides today
  // (model/instrumentParams.js#SYNTH_PARAMS_BY_KIND); state/store.js#setInstrumentOutput seeds
  // instrumentParams with that kind's catalog defaults the first time. Switching to "sample"
  // clears channel/kind (model/instrument.js's own default shape), since a sample instrument
  // reads neither.
  function setOutputType(type, kind = null) {
    instrumentController.setOutput(
      index,
      type === "midi"
        ? { type: "midi", channel: outputChannel ?? MIDI_CHANNEL_MIN, kind: null }
        : type === "instrument"
          ? { type: "instrument", channel: null, kind }
          : { type: "sample", channel: null, kind: null },
    );
  }

  function setChannel(displayValue) {
    const channel = Math.min(MIDI_CHANNEL_MAX, Math.max(MIDI_CHANNEL_MIN, displayValue - 1));
    instrumentController.setOutput(index, { type: "midi", channel });
  }

  return (
    <div className="instrument-editor">
      <div className="instrument-editor__header">
        {toHex(index)} — {name || "(empty)"}
      </div>

      <div className="fx-panel__target">
        <button
          type="button"
          className={`fx-panel__target-btn${outputType === "sample" ? " fx-panel__target-btn--active" : ""}`}
          onClick={() => setOutputType("sample")}
        >
          SAMPLE
        </button>
        <button
          type="button"
          className={`fx-panel__target-btn${outputType === "midi" ? " fx-panel__target-btn--active" : ""}`}
          onClick={() => setOutputType("midi")}
        >
          MIDI
        </button>
        <button
          type="button"
          className={`fx-panel__target-btn${outputType === "instrument" ? " fx-panel__target-btn--active" : ""}`}
          onClick={() => setOutputType("instrument", "kick")}
        >
          KICK
        </button>
      </div>

      {outputType === "midi" ? (
        <label className="fx-module__field">
          <span className="fx-module__field-label" title="MIDI Channel">
            Channel
          </span>
          <input
            type="number"
            min={1}
            max={16}
            value={(outputChannel ?? MIDI_CHANNEL_MIN) + 1}
            onChange={(e) => setChannel(Number(e.target.value))}
          />
          <span className="fx-module__value" />
        </label>
      ) : outputType === "instrument" ? (
        // webdsp's synthesized instrument controls (model/instrumentParams.js — the engine's
        // own public contract for this kind, e.g. KICK_PARAMS) — same slider pattern as the
        // envelope section below, one commit per field (state/store.js#setInstrumentParam
        // merges, it doesn't replace).
        <>
          <div className="note-editor__section">{(outputKind ?? "").toUpperCase()}</div>
          {getSynthParams(outputKind).map((param) => (
            <label className="fx-module__field" key={param.id}>
              <span className="fx-module__field-label" title={param.label}>
                {param.label}
              </span>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={synthParamValues[param.id]}
                onChange={(e) => instrumentController.setInstrumentParam(index, param.id, Number(e.target.value))}
              />
              <span className="fx-module__value">{formatSynthParamValue(synthParamValues[param.id], param)}</span>
            </label>
          ))}
        </>
      ) : (
        hasSample && (
          <>
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

            {/* ADSR amplitude envelope (model/instrument.js#envelope, webdsp's
                EnvelopeParams — node_modules/webdsp's docs/adsr-envelope.md) — per
                sample/instrument, never a track/bus property (see model/envelopeParams.js's
                own doc comment), so it lives here directly below Gain rather than in the
                mixer or FX panel. Each slider commits only the one field it owns —
                setEnvelope merges, it doesn't replace (state/store.js#setInstrumentEnvelope). */}
            <div className="note-editor__section">ENVELOPE</div>
            {ENVELOPE_PARAMS.map((param) => (
              <label className="fx-module__field" key={param.id}>
                <span className="fx-module__field-label" title={param.label}>
                  {param.label}
                </span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={envelopeValues[param.id]}
                  onChange={(e) => instrumentController.setEnvelope(index, { [param.id]: Number(e.target.value) })}
                />
                <span className="fx-module__value">{formatEnvelopeValue(envelopeValues[param.id], param)}</span>
              </label>
            ))}
          </>
        )
      )}
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
