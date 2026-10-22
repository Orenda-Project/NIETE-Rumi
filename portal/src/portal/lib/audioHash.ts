/**
 * bd-c5reix — the sha256 of a recording she picked, so the app can ask "has she sent this before?" BEFORE it uploads
 * anything. The same hash the bot's dedupe takes over the same bytes (audio-hash-cache.js computeAudioHash), so the
 * answer matches what the analysis would have found.
 *
 * SubtleCrypto has no streaming digest: the file is read whole, in memory. So only up to HASH_MAX_BYTES — a 45-minute
 * m4a is about 40 MB; a raw wav can be 250 MB, which a low-end Android in WhatsApp's browser should not be asked to
 * hold twice. Above the cap, without SubtleCrypto, or on any error the answer is null: no check, and the server's own
 * dedupe (after Submit) still stands.
 */
export const HASH_MAX_BYTES = 48 * 1024 * 1024;

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function sha256Hex(blob: Blob, maxBytes: number = HASH_MAX_BYTES): Promise<string | null> {
  try {
    if (!blob || !blob.size || blob.size > maxBytes) return null;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest("SHA-256", await readBytes(blob));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
