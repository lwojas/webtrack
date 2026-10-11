export function createEmptyEvent() {
  return {
    note: null,
    instrument: null,
    velocity: null,
    pan: null,
    effectCommand: null,
    effectParam: null,
    // Steps the note holds for. null = auto (hold until the next non-empty note on the same
    // track, or a 1-step default — see audio/compile.js#noteDurationSteps).
    length: null,
  };
}

export function isEmptyEvent(event) {
  return (
    event.note === null &&
    event.instrument === null &&
    event.velocity === null &&
    event.pan === null &&
    event.effectCommand === null &&
    event.effectParam === null &&
    event.length === null
  );
}

export function cloneEvent(event) {
  return { ...event };
}
