import { getHostFiles } from "webdsp";

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
//
// Where the host has its own file dialogs (webdsp's getHostFiles(): a plugin's WebView has no file input and ignores
// downloads), they are used instead; in a browser it is the download link and the file input, as ever. Resolves true when
// the file was written, false if the user cancelled the host's dialog.
export async function downloadProjectFile(projectObject, fileName = "project.webtracker.json") {
  const text = JSON.stringify(projectObject);
  const files = getHostFiles();
  if (files) return (await files.saveFile({ suggestedName: fileName, data: text })) !== null;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// The host's open dialog as a File (so everything that takes a picked File takes this), or null if there is no host
// dialog or the user cancelled. The LOAD control uses it in place of its file input where the host has dialogs.
export async function pickProjectFileFromHost() {
  const files = getHostFiles();
  if (!files) return null;
  const picked = await files.openFile({ extensions: ["json"] });
  return picked ? new File([picked.data], picked.name, { type: "application/json" }) : null;
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
