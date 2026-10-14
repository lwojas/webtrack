// The only place this app talks to IndexedDB directly — deliberately not unit-tested, the same
// convention src/persistence/projectIO.js and webdsp's own AudioRuntime/decode.ts already use
// for browser-API glue that needs a real browser to exercise (see webdsp's ARCHITECTURE.md,
// "Deliberately not unit-tested"). Everything that can be pure logic (what to serialize, when
// to write) lives in persistence/recovery.js instead, which takes this module's read/write
// functions as plain injected callbacks.
//
// Two object stores, one database:
//   - "localAssets": one entry per sample an Instrument currently references (either origin —
//     see model/instrument.js's origin doc comment), keyed by the localAssetId appContext.js
//     assigns at load/resample time. Written once per load, never rewritten by the debounced
//     recovery writer — this is what keeps persistence/recovery.js's own writes cheap (see its
//     module doc comment).
//   - "recovery": a single record (fixed key "latest" — webtracker recovers one session at a
//     time, not a multi-project history) holding the lightweight project snapshot
//     persistence/recovery.js produces, plus which localAssets it depends on.
const DB_NAME = "webtracker";
const DB_VERSION = 1;
const LOCAL_ASSETS_STORE = "localAssets";
const RECOVERY_STORE = "recovery";
const RECOVERY_KEY = "latest";

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_ASSETS_STORE)) db.createObjectStore(LOCAL_ASSETS_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// { id, mimeType, fileName, data: ArrayBuffer } — data is stored as a raw ArrayBuffer (IndexedDB
// structured-clones it), not base64: that's strictly smaller and needs no encode/decode step,
// unlike project JSON, which must stay plain text.
export async function putLocalAsset(asset) {
  const db = await openDb();
  const tx = db.transaction(LOCAL_ASSETS_STORE, "readwrite");
  tx.objectStore(LOCAL_ASSETS_STORE).put(asset);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalAsset(id) {
  const db = await openDb();
  const tx = db.transaction(LOCAL_ASSETS_STORE, "readonly");
  return idbRequest(tx.objectStore(LOCAL_ASSETS_STORE).get(id));
}

export async function deleteLocalAsset(id) {
  const db = await openDb();
  const tx = db.transaction(LOCAL_ASSETS_STORE, "readwrite");
  tx.objectStore(LOCAL_ASSETS_STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// record: whatever shape persistence/recovery.js chooses (an opaque blob as far as this file is
// concerned) — stamped with the fixed RECOVERY_KEY so a later write always replaces the same
// single slot rather than accumulating history.
export async function putRecoveryState(record) {
  const db = await openDb();
  const tx = db.transaction(RECOVERY_STORE, "readwrite");
  tx.objectStore(RECOVERY_STORE).put({ ...record, id: RECOVERY_KEY });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRecoveryState() {
  const db = await openDb();
  const tx = db.transaction(RECOVERY_STORE, "readonly");
  return idbRequest(tx.objectStore(RECOVERY_STORE).get(RECOVERY_KEY));
}

export async function clearRecoveryState() {
  const db = await openDb();
  const tx = db.transaction(RECOVERY_STORE, "readwrite");
  tx.objectStore(RECOVERY_STORE).delete(RECOVERY_KEY);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
