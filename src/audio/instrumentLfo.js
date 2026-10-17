// Pure planning half of the LFO bridge (audio/instrument.js applies the result to the runtime):
// turns a slot's model LFOs (model/instrumentLfos.js — names) into per-slot engine operations
// (webdsp AudioRuntime.setInstrumentLfo / clearInstrumentLfo — ids/indices), validating against
// what the engine reports. Kept free of webdsp imports so it is unit-testable.
//
// `options`: { maxLfos, waveforms: string[], divisions: string[], targets: string[] } as built by
// audio/instrument.js#getModulationOptions. `resolveParam(name)` -> engine param id or undefined.
// A waveform/division/target the engine does not know (or no longer offers as a modulation
// target) plans a clear for that slot rather than sending something invalid.
export function planLfoUpdates(lfos, options, resolveParam, previous = []) {
  const ops = [];
  for (let slot = 0; slot < options.maxLfos; slot++) {
    const lfo = lfos?.[slot];
    const waveform = lfo ? options.waveforms.indexOf(lfo.waveform) : -1;
    const division = lfo ? options.divisions.indexOf(lfo.division) : -1;
    const target = lfo ? resolveParam(lfo.target) : undefined;
    const valid = lfo && waveform >= 0 && target !== undefined && options.targets.includes(lfo.target) && (!lfo.sync || division >= 0);
    const sig = valid ? JSON.stringify(lfo) : "";
    if (sig === (previous[slot] ?? "")) continue;
    previous[slot] = sig;
    ops.push(
      valid
        ? {
            slot,
            settings: {
              target,
              amount: lfo.amount,
              waveform,
              sync: lfo.sync,
              rateHz: lfo.rateHz,
              division: Math.max(0, division),
              phase: lfo.phase,
            },
          }
        : { slot, clear: true },
    );
  }
  return ops;
}
