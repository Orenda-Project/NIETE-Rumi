/**
 * bd-s1oo0.7 — send a child-test item from the phone: presign → PUT to R2 →
 * the bot attaches it to the block (and starts the marking). Only after all
 * three is the phone copy deleted; any failure leaves it to be sent again.
 *
 *   network  no answer / a 5xx / a PUT that did not finish → try again later
 *   refused  the bot said no (4xx) — kept, with the reason, for the coach to see
 */

import { deleteRecording, listPending, type PendingItem } from "./recordings";

export type UploadApi = {
  presignBlockUpload: (sessionId: string, args: { block: string; kind: "audio" | "photo"; contentType: string; sizeBytes: number })
    => Promise<{ key: string; uploadUrl: string; contentType: string }>;
  uploadToR2: (uploadUrl: string, blob: Blob, contentType: string) => Promise<void>;
  registerBlockMedia: (sessionId: string, args: { block: string; audioKey?: string; photoKey?: string; timing?: Record<string, unknown> })
    => Promise<{ scoring?: string }>;
};

export type UploadResult =
  | { ok: true; scoring?: string }
  | { ok: false; error: "network" }
  | { ok: false; error: "refused"; reason: string };

function refusal(err: unknown): string | null {
  const r = (err as { response?: { status?: number; data?: { reason?: string } } })?.response;
  if (r && typeof r.status === "number" && r.status >= 400 && r.status < 500) return String(r.data?.reason || `http_${r.status}`);
  return null;
}

export async function uploadItem({ meta, blob }: PendingItem, api: UploadApi): Promise<UploadResult> {
  const sessionId = meta.sessionId as string;
  const block = meta.block as string;
  const kind = meta.kind as "audio" | "photo";
  try {
    const signed = await api.presignBlockUpload(sessionId, { block, kind, contentType: meta.mimeType, sizeBytes: blob.size });
    await api.uploadToR2(signed.uploadUrl, blob, signed.contentType);
    const reg = await api.registerBlockMedia(sessionId, kind === "photo"
      ? { block, photoKey: signed.key }
      : { block, audioKey: signed.key, ...(meta.timing ? { timing: meta.timing } : {}) });
    try { await deleteRecording(meta.id); } catch { /* sent; a leftover copy is resent harmlessly as already attached */ }
    return { ok: true, scoring: reg?.scoring };
  } catch (err) {
    const reason = refusal(err);
    if (reason === "already_scored") {
      // the block is locked with an earlier take; this copy can never be used
      try { await deleteRecording(meta.id); } catch { /* nothing to do */ }
      return { ok: true, scoring: "already_scored" };
    }
    if (reason) return { ok: false, error: "refused", reason };
    return { ok: false, error: "network" };
  }
}

export async function flushPending(api: UploadApi, sessionId?: string): Promise<(UploadResult & { id: string; block?: string; kind?: string })[]> {
  let pending: PendingItem[] = [];
  try {
    pending = await listPending(sessionId);
  } catch {
    return [];
  }
  const out = [];
  for (const item of pending) {
    // eslint-disable-next-line no-await-in-loop
    const r = await uploadItem(item, api);
    out.push({ ...r, id: item.meta.id, block: item.meta.block, kind: item.meta.kind });
  }
  return out;
}
