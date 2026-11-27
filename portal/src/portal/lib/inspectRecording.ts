/**
 * bd-8sr958 (queue #320) — look at a picked recording WITHOUT decoding it: walk its top-level boxes with Blob.slice and
 * say whether it is whole. Mirrors bot/shared/services/coaching/recording-repair/inspectRecording (the server repairs;
 * the page only checks, so there is one repair engine with one set of tests).
 *
 *   'empty'      0 bytes: refused at the pick ("Empty file"), she chooses another.
 *   'damaged'    an MP4/M4A with no moov box (the recorder never finished) or a media box cut short. Send stays on; the
 *                server rebuilds it before transcription.
 *   'ok'         an MP4/M4A with its moov and a whole mdat.
 *   'unchecked'  any other container (ogg, webm, wav, mp3 …): not judged here.
 */
export type RecordingInspection = { kind: 'ok' | 'damaged' | 'empty' | 'unchecked'; signature: string | null };

const MAX_BOXES = 64;

async function bytes(file: Blob, from: number, to: number): Promise<Uint8Array> {
  try {
    const part = file.slice(from, to);
    if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer());
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.onerror = () => resolve(new Uint8Array(0));
      r.readAsArrayBuffer(part);
    });
  } catch {
    return new Uint8Array(0);
  }
}

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...Array.from(b.subarray(at, at + n)));

export async function inspectRecording(file: Blob): Promise<RecordingInspection> {
  if (!file || file.size === 0) return { kind: 'empty', signature: null };
  const head = await bytes(file, 0, 16);
  if (head.length < 12 || text(head, 4, 4) !== 'ftyp') return { kind: 'unchecked', signature: null };
  const brand = text(head, 8, 4).trim();
  let freeSize = 0;
  let sawMoov = false;
  let torn = false;
  let o = 0;
  for (let i = 0; i < MAX_BOXES && o + 8 <= file.size; i++) {
    const h = await bytes(file, o, o + 16);
    if (h.length < 8) break;
    const view = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = view.getUint32(0);
    const type = text(h, 4, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    if (size === 1) {
      if (h.length < 16) break;
      size = Number(view.getBigUint64(8));
    }
    if (size === 0 || size < 8) { if (type === 'mdat') torn = true; size = file.size - o; }
    if (o + size > file.size) { if (type === 'mdat' || type === 'moov') torn = true; size = file.size - o; }
    if (type === 'free' && !freeSize) freeSize = size;
    if (type === 'moov' && !torn) sawMoov = true;
    o += size;
  }
  const signature = `M4A ${brand} free=${freeSize}`;
  return sawMoov && !torn ? { kind: 'ok', signature } : { kind: 'damaged', signature };
}
