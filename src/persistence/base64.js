// Manual base64 <-> ArrayBuffer conversion (no library) for embedding sample bytes in a
// project file. Chunked to avoid blowing the call stack on String.fromCharCode/apply for
// large buffers (the classic failure mode of the naive one-shot version).
const CHUNK_SIZE = 0x8000;

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
