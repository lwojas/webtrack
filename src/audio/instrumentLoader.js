import { getRuntime } from "./runtime.js";

export async function loadSample(arrayBuffer, name) {
  const runtime = await getRuntime();
  return runtime.loadSample(arrayBuffer, { name });
}

export async function loadSampleFromUrl(url, name) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return loadSample(arrayBuffer, name ?? url.split("/").pop());
}
