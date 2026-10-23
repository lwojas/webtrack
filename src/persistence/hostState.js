// The project in a host's session (webdsp's getHostState(), e.g. a DAW plugin): the same record the local recovery
// write builds (persistence/recovery.js: the project serialized with sample *references*, embedSampleBytes: false)
// handed to the host as an opaque snapshot, with the sample bytes as blobs keyed by localAssetId. See webdsp
// docs/host-state.md. When a host is present it is the source of truth, so the local recovery slot is not used.
export const HOST_STATE_APP = "webtracker";
// Version of the snapshot's `data` (a recovery record as JSON). The project inside carries its own formatVersion too.
export const HOST_STATE_FORMAT = 1;

// Sample bytes by localAssetId, from the instruments in memory (the same ArrayBuffers every publish, so the host
// does not receive an unchanged sample twice).
export function collectBlobs(instruments) {
  const blobs = {};
  for (const instrument of instruments) {
    if (instrument.localAssetId && instrument.sampleAsset?.buffer) blobs[instrument.localAssetId] = instrument.sampleAsset.buffer;
  }
  return blobs;
}

export function toHostSnapshot(record, blobs) {
  return { app: HOST_STATE_APP, format: HOST_STATE_FORMAT, data: JSON.stringify(record), blobs };
}

export function publishRecord(host, record, instruments) {
  host.publish(toHostSnapshot(record, collectBlobs(instruments)));
}

// The record and blobs in a restored snapshot, or null when it is not ours, not a format we read, or malformed:
// "start fresh", never an error.
export function fromHostSnapshot(snapshot) {
  if (!snapshot || snapshot.app !== HOST_STATE_APP || snapshot.format !== HOST_STATE_FORMAT) return null;
  let record;
  try {
    record = JSON.parse(snapshot.data);
  } catch {
    return null;
  }
  if (!record || typeof record !== "object" || !record.project || typeof record.project !== "object") return null;
  if (typeof record.project.formatVersion !== "number") return null;
  return { record, blobs: snapshot.blobs ?? {} };
}
