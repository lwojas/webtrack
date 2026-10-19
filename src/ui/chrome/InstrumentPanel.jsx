import { useEffect, useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { loadSample } from "../../audio/instrumentLoader.js";
import { initRuntime } from "../../audio/runtime.js";
import { getModulationOptions } from "../../audio/instrument.js";
import {
  LFO_WAVEFORM_LABELS,
  LFO_RATE_STEPS,
  MAX_INSTRUMENT_LFOS,
  formatLfoRate,
  rateToSlider,
  sliderToRate,
} from "../../model/instrumentLfos.js";
import { toHex } from "../../model/notes.js";
import { ENVELOPE_PARAMS, formatEnvelopeValue } from "../../model/envelopeParams.js";
import { SYNTH_KINDS, getSynthParams, formatSynthParamValue, synthParamControl } from "../../model/instrumentParams.js";
import { downloadBytes } from "../../persistence/projectIO.js";
import { rangeFillStyle } from "../rangeFill.js";

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
          ? `${name}${isMidiOutput ? " · MIDI" : ""}${synthKind ? ` · ${(SYNTH_KINDS.find((k) => k.id === synthKind)?.name ?? synthKind).toUpperCase()}` : ""}${isResample ? " · R" : ""}`
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

// One LFO of the modulation slot. Primitive selector (the LFO serialised) because the model
// replaces the lfos array on every edit but selectors must return primitives (Gotcha #1).
function LfoRow({ store, instrumentController, index, lfoIndex, options, labelFor }) {
  const json = useStore(store, events.INSTRUMENTS_CHANGED, (s) => JSON.stringify(s.instruments[index]?.instrumentLfos?.[lfoIndex] ?? null));
  const lfo = JSON.parse(json);
  if (!lfo) return null;
  const set = (patch) => instrumentController.setLfo(index, lfoIndex, patch);
  const targetKnown = options.targets.includes(lfo.target);
  return (
    <div className="lfo-row">
      <div className="lfo-row__head">
        <span>LFO {lfoIndex + 1}</span>
        <button type="button" className="fx-panel__target-btn" onClick={() => instrumentController.removeLfo(index, lfoIndex)}>
          REMOVE
        </button>
      </div>
      <div className="fx-panel__target">
        {options.waveforms.map((w) => (
          <button
            type="button"
            key={w}
            className={`fx-panel__target-btn${lfo.waveform === w ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => set({ waveform: w })}
          >
            {LFO_WAVEFORM_LABELS[w] ?? w.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="fx-panel__target">
        <button type="button" className={`fx-panel__target-btn${lfo.sync ? "" : " fx-panel__target-btn--active"}`} onClick={() => set({ sync: false })}>
          FREE
        </button>
        <button type="button" className={`fx-panel__target-btn${lfo.sync ? " fx-panel__target-btn--active" : ""}`} onClick={() => set({ sync: true })}>
          BPM
        </button>
      </div>
      {lfo.sync ? (
        <label className="fx-module__field">
          <span className="fx-module__field-label">Division</span>
          <select value={options.divisions.includes(lfo.division) ? lfo.division : ""} onChange={(e) => set({ division: e.target.value })}>
            {options.divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="fx-module__value" />
        </label>
      ) : (
        <label className="fx-module__field">
          <span className="fx-module__field-label">Rate</span>
          <input
            type="range"
            min={0}
            max={LFO_RATE_STEPS}
            step={1}
            value={rateToSlider(lfo.rateHz)}
            onChange={(e) => set({ rateHz: sliderToRate(Number(e.target.value)) })}
            style={rangeFillStyle(rateToSlider(lfo.rateHz), 0, LFO_RATE_STEPS)}
          />
          <span className="fx-module__value">{formatLfoRate(lfo.rateHz)}</span>
        </label>
      )}
      <label className="fx-module__field">
        <span className="fx-module__field-label">Amount</span>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={Math.round(lfo.amount * 100)}
          onChange={(e) => set({ amount: Number(e.target.value) / 100 })}
          style={rangeFillStyle(Math.round(lfo.amount * 100), -100, 100)}
        />
        <span className="fx-module__value">{Math.round(lfo.amount * 100)}%</span>
      </label>
      <label className="fx-module__field">
        <span className="fx-module__field-label">Target</span>
        <select value={lfo.target} onChange={(e) => set({ target: e.target.value })}>
          {!targetKnown && <option value={lfo.target}>{labelFor(lfo.target)} (n/a)</option>}
          {options.targets.map((t) => (
            <option key={t} value={t}>
              {labelFor(t)}
            </option>
          ))}
        </select>
        <span className="fx-module__value" />
      </label>
    </div>
  );
}

// The synth editor's modulation slot: a compact list of LFOs, each routed to one control of the
// selected synth. Free mode shows Rate (Hz); BPM-sync swaps it for a Division. The option lists —
// waveforms, divisions and the synth's modulation targets — come from the engine
// (audio/instrument.js#getModulationOptions), never from a per-synth table here. Hidden for a
// kind with no modulation targets (the drums, Pad, FM).
function ModulationSection({ store, instrumentController, index, kind }) {
  const lfoCount = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentLfos?.length ?? 0);
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    if (kind) getModulationOptions(kind).then((o) => !cancelled && setOptions(o)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind]);
  if (!options || options.targets.length === 0) return null;
  const labelFor = (id) => getSynthParams(kind).find((p) => p.id === id)?.label ?? id;
  const max = Math.min(options.maxLfos, MAX_INSTRUMENT_LFOS);
  return (
    <>
      <div className="note-editor__section">MODULATION</div>
      {Array.from({ length: lfoCount }, (_, i) => (
        <LfoRow key={i} store={store} instrumentController={instrumentController} index={index} lfoIndex={i} options={options} labelFor={labelFor} />
      ))}
      <button
        type="button"
        className="fx-panel__target-btn"
        disabled={lfoCount >= max}
        onClick={() => instrumentController.addLfo(index, options.targets.includes("cutoff") ? "cutoff" : options.targets[0])}
      >
        + ADD LFO
      </button>
    </>
  );
}

function InstrumentEditor({ store, instrumentController }) {
  const index = useStore(store, events.CURSOR_MOVED, (s) => s.selectedInstrumentIndex);
  const name = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.name ?? "");
  const exists = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index] != null);
  const hasSample = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleId != null);
  const gain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.gain ?? 1);
  const outputType = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.type ?? "sample");
  const outputChannel = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.channel ?? null);
  const outputKind = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.kind ?? null);
  // null = MASTER_BUS (default); a track index routes this slot's live webdsp instrument into
  // that track's own insert bus instead, so it passes through that track's FX chain — see
  // model/instrument.js#output's own doc comment and audio/instrument.js#resolveSynthBus.
  const outputTrack = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.output?.track ?? null);
  // Not INSTRUMENTS_CHANGED-reactive — trackCount has no live resize UI today (same read-once
  // pattern ui/chrome/Mixer.jsx's own trackCount already uses).
  const { trackCount } = store.getState().song;
  // One primitive selector per field (not `s.instruments[index]?.envelope` itself) — the same
  // in-place-mutation gotcha every other mutable-object field on this page already works around
  // (see this file's own module doc comment / ARCHITECTURE.md's Gotcha #1).
  const attack = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.attack ?? 0);
  const decay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.decay ?? 0);
  const sustain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.sustain ?? 1);
  const release = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.envelope?.release ?? 0.01);
  const envelopeValues = { attack, decay, sustain, release };
  const sampleMode = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.sampleMode ?? "chromatic");
  const chopEditorOpen = useStore(store, events.CHOP_EDITOR_CHANGED, (s) => s.chopEditorOpen);

  // Every synth kind's own controls (model/instrumentParams.js — KICK_PARAMS/SNARE_PARAMS/
  // CLAP_PARAMS/TOM_PARAMS/HIHAT_PARAMS), one primitive selector per *unique param id* across
  // every kind's catalog (not per kind) — same one-primitive-per-field shape as envelopeValues
  // above, for the same Gotcha #1 reason. Only the ids belonging to the currently selected
  // outputKind are ever read (getSynthParams(outputKind) below); the rest are harmlessly
  // unused. "decay" is renamed synthDecay to avoid shadowing envelopeValues' own `decay` above
  // — every kind has its own decay range/default, but they all read the same store field.
  const tune = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.tune ?? 50);
  const synthDecay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.decay ?? 0.3);
  const pitchDrop = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pitchDrop ?? 2.5);
  const pitchDecay = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pitchDecay ?? 0.04);
  const punch = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.punch ?? 0.5);
  const drive = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.drive ?? 0.3);
  const snap = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.snap ?? 0.5);
  const noise = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.noise ?? 0.6);
  const spread = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.spread ?? 0.5);
  const body = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.body ?? 0.5);
  const damp = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.damp ?? 0.3);
  const metal = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.metal ?? 0.7);
  const tone = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.tone ?? 0.5);
  // Bass-only ids. attack/sustain/release are the Bass's own ADSR *instrument params* (its
  // internal amplitude envelope), not this slot's sample-style EnvelopeParams above, so they get
  // their own `synth*` names to avoid shadowing envelopeValues' fields.
  const bite = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.bite ?? 0.4);
  const cutoff = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.cutoff ?? 400);
  const resonance = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.resonance ?? 0.25);
  const synthAttack = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.attack ?? 0.003);
  const synthSustain = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.sustain ?? 0.6);
  const synthRelease = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.release ?? 0.1);
  const legato = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.legato ?? 0);
  const slide = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.slide ?? 0);
  // Pulse-only ids (cutoff/resonance/attack/release are shared with the Bass above).
  const pump = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pump ?? 0.5);
  const repeat = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.repeat ?? 0.4);
  const rate = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.rate ?? 2);
  const diffuse = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.diffuse ?? 0.3);
  // Pad-only ids (tone is shared with the Hi-Hat; attack/release with Bass and Pulse).
  const movement = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.movement ?? 0.5);
  const detune = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.detune ?? 0.4);
  const space = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.space ?? 0.6);
  // FM-only ids (snap, tone, attack, decay, sustain, release, legato, slide are shared).
  const ratio = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.ratio ?? 1);
  const timbre = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.timbre ?? 0.35);
  // Hypersaw-only id (detune, spread, cutoff and the envelope are shared).
  const density = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.density ?? 0.7);
  // PWM Beast-only ids (rate is Pulse's id with its own range; drive, cutoff, resonance and the
  // envelope are shared).
  const width = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.width ?? 0.3);
  const pwm = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.pwm ?? 0.5);
  const shape = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.shape ?? 0.35);
  const harmonics = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.harmonics ?? 0.5);
  const envamt = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.envamt ?? 0.7);
  const sub = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.sub ?? 0.25);
  // Digital Machine ids not used by any kind above (ratio, spread, body, noise, tone, damp, punch,
  // drive, decay, tune are shared by id; their ranges differ per kind).
  const fm = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.fm ?? 0.4);
  const sweep = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.sweep ?? 0);
  const chick = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.chick ?? 0.5);
  const structure = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.structure ?? 0);
  const hold = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.hold ?? 0);
  const burst = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.burst ?? 0);
  const chaos = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.chaos ?? 0.4);
  const fold = useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments[index]?.instrumentParams?.fold ?? 0.3);
  const synthParamValues = {
    tune, decay: synthDecay, pitchDrop, pitchDecay, punch, drive, snap, noise, spread, body, damp, metal, tone,
    bite, cutoff, resonance, attack: synthAttack, sustain: synthSustain, release: synthRelease,
    pump, repeat, rate, diffuse, legato, slide, movement, detune, space, ratio, timbre, density,
    width, pwm, shape, harmonics, envamt, sub, fm, sweep, chick, structure, hold, burst, chaos, fold,
  };

  if (!exists) return null;

  // Switching to "midi" needs a channel right away (compileEvent treats a missing channel as
  // "nothing to send" — see audio/compile.js) — default to the last one used, or channel 1.
  // Switching to "instrument" needs a kind, one of model/instrumentParams.js#SYNTH_KINDS
  // (kick/snare/clap/tom/hihat/bass/pulse/pad/fm/hypersaw/pwmbeast/dm_thump/dm_metal/dm_tone/dm_crack/dm_chaos); state/store.js#setInstrumentOutput (re)seeds instrumentParams
  // with that kind's own catalog defaults, both the first time a slot becomes "instrument" and
  // whenever the kind itself changes. `track` carries over across a kind switch (KICK -> SNARE
  // keeps whatever bus routing was already chosen) but resets to null (MASTER_BUS) switching to
  // "sample"/"midi", since only "instrument" output reads it. Switching to "sample" clears
  // channel/kind (model/instrument.js's own default shape), since a sample instrument reads
  // neither.
  function setOutputType(type, kind = null) {
    instrumentController.setOutput(
      index,
      type === "midi"
        ? { type: "midi", channel: outputChannel ?? MIDI_CHANNEL_MIN, kind: null, track: null }
        : type === "instrument"
          ? { type: "instrument", channel: null, kind, track: outputTrack }
          : { type: "sample", channel: null, kind: null, track: null },
    );
  }

  function setChannel(displayValue) {
    const channel = Math.min(MIDI_CHANNEL_MAX, Math.max(MIDI_CHANNEL_MIN, displayValue - 1));
    instrumentController.setOutput(index, { type: "midi", channel });
  }

  // The Instrument Editor's Output Bus selector — MASTER (the default, value "") or one of the
  // song's own tracks, routing this slot's live webdsp instrument into that track's insert bus
  // (see model/instrument.js#output's own doc comment). "" rather than a sentinel number because
  // 0 is itself a valid track index.
  function setOutputTrack(displayValue) {
    instrumentController.setOutput(index, { type: "instrument", channel: null, kind: outputKind, track: displayValue === "" ? null : Number(displayValue) });
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
        {/* One button per webdsp synth kind (model/instrumentParams.js#SYNTH_KINDS) — hand-
            mirrored from the engine's own capability list (node_modules/webdsp's
            docs/instruments.md) rather than a separate hardcoded button per kind; adding a
            future kind here needs only a new SYNTH_KINDS entry, not a new button. */}
        {SYNTH_KINDS.map((kind) => (
          <button
            type="button"
            key={kind.id}
            className={`fx-panel__target-btn${outputType === "instrument" && outputKind === kind.id ? " fx-panel__target-btn--active" : ""}`}
            onClick={() => setOutputType("instrument", kind.id)}
          >
            {kind.name.toUpperCase()}
          </button>
        ))}
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
          <label className="fx-module__field">
            <span className="fx-module__field-label" title="Which bus this instrument's output renders into">
              Output Bus
            </span>
            <select value={outputTrack ?? ""} onChange={(e) => setOutputTrack(e.target.value)}>
              <option value="">MASTER</option>
              {Array.from({ length: trackCount }, (_, i) => (
                <option key={i} value={i}>
                  TRK {i + 1}
                </option>
              ))}
            </select>
            <span className="fx-module__value" />
          </label>
          {getSynthParams(outputKind).map((param) => {
            const control = synthParamControl(param);
            const sliderValue = control.toSlider(synthParamValues[param.id]);
            return (
              <label className="fx-module__field" key={param.id}>
                <span className="fx-module__field-label" title={param.label}>
                  {param.label}
                </span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={sliderValue}
                  onChange={(e) =>
                    instrumentController.setInstrumentParam(index, param.id, control.fromSlider(Number(e.target.value)))
                  }
                  style={rangeFillStyle(sliderValue, control.min, control.max)}
                />
                <span className="fx-module__value">{formatSynthParamValue(synthParamValues[param.id], param)}</span>
              </label>
            );
          })}
          <ModulationSection store={store} instrumentController={instrumentController} index={index} kind={outputKind} />
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
                style={rangeFillStyle(gain, GAIN_MIN, GAIN_MAX)}
              />
              <span className="fx-module__value">{gain.toFixed(2)}x</span>
            </label>

            {/* ADSR amplitude envelope (model/instrument.js#envelope, webdsp's
                EnvelopeParams — node_modules/webdsp's docs/adsr-envelope.md) — per
                sample/instrument, never a track/bus property (see model/envelopeParams.js's
                own doc comment), so it lives here directly below Gain rather than in the
                mixer or FX panel. Each slider commits only the one field it owns —
                setEnvelope merges, it doesn't replace (state/store.js#setInstrumentEnvelope). */}
            {/* Chromatic: a cell's note transposes the sample. Chop: the note picks a slice of the
                sample's cue points (root note = slice 1) — model/chop.js. EDIT CHOPS opens the
                waveform/cue editor under the grid (ui/chrome/ChopEditor.jsx), which is too wide
                for this column. */}
            <div className="note-editor__section">PITCH</div>
            <div className="fx-panel__target">
              {["chromatic", "chop"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`fx-panel__target-btn${sampleMode === mode ? " fx-panel__target-btn--active" : ""}`}
                  onClick={() => instrumentController.setSampleMode(index, mode)}
                  title={mode === "chop" ? "A cell's note picks a slice of the sample" : "A cell's note transposes the sample"}
                >
                  {mode === "chromatic" ? "CHROMATIC" : "CHOP"}
                </button>
              ))}
            </div>
            {sampleMode === "chop" && (
              <button
                type="button"
                className={`fx-panel__target-btn${chopEditorOpen ? " fx-panel__target-btn--active" : ""}`}
                onClick={() => instrumentController.setChopEditorOpen(!chopEditorOpen)}
              >
                {chopEditorOpen ? "CLOSE CHOPS" : "EDIT CHOPS"}
              </button>
            )}

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
                  style={rangeFillStyle(envelopeValues[param.id], param.min, param.max)}
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
