// The only browser-API glue for project files (Blob/anchor-click download, File reading).
// Kept separate from projectFile.js's pure serialize/deserialize logic so that logic stays
// unit-testable without a DOM.
//
// Note on the object URL below: it's created and revoked synchronously around a single
// download click — a transient trigger for the browser's save dialog, not something the app
// holds onto or depends on later. That's a different thing from the anti-pattern this
// project's persistence was built to avoid (treating a `URL.createObjectURL(file)` as a
// loaded sample's permanent "address", which breaks the moment the page reloads) — the actual
// sample bytes here are embedded as base64 in the saved JSON, not referenced by this URL.
export function downloadProjectFile(projectObject, fileName = "project.webtracker.json") {
  const blob = new Blob([JSON.stringify(projectObject)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

// ui/chrome/InstrumentPanel.jsx's per-slot DOWNLOAD button — saves an instrument's own sample
// bytes (import or resample origin alike, no distinction made here or in the UI — see
// docs/RESAMPLE.md's "What this doesn't do") as a standalone file, same Blob/anchor-click/
// revoke shape as downloadProjectFile above.
export function downloadBytes(buffer, mimeType, fileName) {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
