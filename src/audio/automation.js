// Cell automation on the audio clock. audio/compile.js#compileRowAutomation says what each step
// writes; this turns those descriptors into webdsp scheduleParams events (a step, or a linear
// ramp for a glide), and puts the authored values back when playback stops.
//
// Automation writes the parameter's BASE value in the engine only: the model keeps the authored
// base (trackChannel.fx / instrument.instrumentParams / instrument.envelope), the engine's LFOs
// ride on whatever base is playing, and stopping restores the model's base. Nothing is written
// back into the model during playback.
//
// The pure half (toScheduledParams) takes its resolvers by injection so it is unit-testable
// without webdsp; the bridge half (createAutomationScheduler) is wired in playbackController.js.

// Descriptor -> webdsp ScheduledParam, or null if its target has no live engine object yet (an FX
// instance without an EffectId, an instrument slot with no engine instrument / sample).
//   ctx: { trackBusIds, instruments, effectId(trackIndex, instanceId), nodeParam(paramId),
//          instrumentParam(kind, paramId), sampleParam(paramId) }
export function toScheduledParam(item, time, ctx) {
  const out = { time, value: item.value };
  if (item.from !== undefined) {
    out.from = item.from;
    out.ramp = item.ramp;
  }
  if (item.kind === "fx") {
    const bus = ctx.trackBusIds[item.trackIndex];
    const effect = ctx.effectId(item.trackIndex, item.instanceId);
    const param = ctx.nodeParam(item.paramId);
    if (bus === undefined || effect === undefined || param === undefined) return null;
    return { ...out, target: { effect: { bus, effect } }, param };
  }
  const instrument = ctx.instruments[item.slot];
  if (!instrument) return null;
  if (instrument.output?.type === "instrument" && instrument.output.kind) {
    const param = ctx.instrumentParam(instrument.output.kind, item.paramId);
    if (instrument.engineInstrumentId == null || param === undefined) return null;
    return { ...out, target: { instrument: instrument.engineInstrumentId }, param };
  }
  if (instrument.output?.type === "sample" || !instrument.output) {
    const param = ctx.sampleParam(item.paramId);
    if (instrument.sampleId == null || param === undefined) return null;
    return { ...out, target: { sample: instrument.sampleId }, param };
  }
  return null;
}

// A parameter automation has touched this session, by the same key the descriptors address.
const touchKey = (item) => (item.kind === "fx" ? `fx:${item.trackIndex}:${item.instanceId}:${item.paramId}` : `inst:${item.slot}:${item.paramId}`);

// `ctx` as above, plus `restore` writers for the stop path:
//   restore.fx(trackIndex, instanceId, paramId, value)
//   restore.instrument(instrument, paramId, value)   (a synth control or a sample envelope stage)
export function createAutomationScheduler(getRuntime, getContext, restore) {
  const touched = new Map(); // touchKey -> descriptor

  return {
    // One step's descriptors, all at `time`. Unresolvable ones are dropped quietly.
    schedule(items, time) {
      const runtime = getRuntime();
      const ctx = getContext();
      const events = [];
      for (const item of items) {
        const event = toScheduledParam(item, time, ctx);
        if (!event) continue;
        events.push(event);
        touched.set(touchKey(item), item);
      }
      if (events.length > 0) runtime.scheduleParams(events);
    },

    // Writes the authored base back for every parameter automation moved. Direct writes also end
    // any ramp still running in the engine, so call this after runtime.cancelScheduled().
    restoreBase(getBase) {
      for (const item of touched.values()) {
        const base = getBase(item);
        if (base === null || base === undefined) continue;
        if (item.kind === "fx") restore.fx(item.trackIndex, item.instanceId, item.paramId, base);
        else restore.instrument(item.slot, item.paramId, base);
      }
      touched.clear();
    },
  };
}
