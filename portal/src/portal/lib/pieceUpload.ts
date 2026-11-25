/**
 * bd-q261rec (queue #261) — send a recording IN PIECES, so a slow or broken line resumes instead of starting over.
 *
 * Before: one PUT of the whole file (10–40 MB for a lesson) straight to R2, no timeout, no retry. One drop and the next
 * try started from byte 0 (production 25 Nov: four failed sends of one recording, each from zero).
 *
 * Now (the bot's portal-upload-pieces.service does the server half):
 *   begin   the file's size and piece size → its final key and the pieces the server already holds (asked with the key
 *           this phone remembers for this recording, after a drop, a reload or a killed app).
 *   PUT     each piece still missing, one at a time, a plain byte range of the file. A PUT that stops moving for
 *           STALL_MS is given up (a dead line does not hang forever).
 *   join    with each piece's sha256: the bot joins them into the final key, byte-identical to the phone's file, and
 *           names any piece missing or different, which is sent again.
 *
 * A drop waits (RETRY_WAITS_MS: 3 s, 20 s, 1 min, 5 min, 15 min) and then asks begin again; the wait ends early when the
 * phone says it is back online, or when wakePieces() is called (Try now). Each piece that arrives resets the waits, so a
 * line that is slow but moving never gives up; one that moves nothing through every wait does, and what arrived stays
 * on the server: Try again (the same send) picks it up from there.
 *
 * Which recording is which: a fingerprint of its size and its first and last 64 KB (cheap, and the same for a Blob rebuilt
 * from the phone's copy as for the one recorded), remembered with its key in localStorage. A recording that grew (she
 * resumed it) is a new fingerprint and a new upload.
 */

import { sha256Hex } from "./audioHash";

export type BeginAnswer = {
  key: string; contentType: string; pieceBytes: number; pieces: number; have: number[]; joined: boolean;
};

export type PiecesApi = {
  begin: (a: { filename: string; sizeBytes: number; pieceBytes: number; key?: string }) => Promise<BeginAnswer>;
  sign: (a: { key: string; pieces: number[]; attempt: number }) => Promise<{ contentType: string; urls: { n: number; url: string }[] }>;
  join: (a: { key: string; sizeBytes: number; pieceBytes: number; digests?: string[] }) => Promise<{ key: string; sizeBytes: number; sha256?: string }>;
};

/** PUT one piece; onProgress(bytes of THIS piece sent). Rejects on any failure. */
export type PutPiece = (url: string, body: Blob, contentType: string, onProgress?: (loaded: number) => void) => Promise<void>;

export type Remembered = { key: string; pieceBytes: number; sizeBytes: number; at: number };
export type Memo = {
  get: (fp: string) => Remembered | null;
  set: (fp: string, v: Remembered) => void;
  forget: (fp: string) => void;
};

/** What a caller is told while a send waits to try again. */
export type WaitInfo = { ms: number; attempt: number; sent: number; pieces: number; sentBytes: number; online: boolean };

/** A failed PUT or sign, for the caller's failure report (coachingSend's tell). */
export type PieceFailure = { piece: number; pieces: number; attempt: number; err: unknown; sentBytes: number };

export const RETRY_WAITS_MS = [3_000, 20_000, 60_000, 300_000, 900_000];
/** A PUT that sends nothing for this long is given up. */
export const STALL_MS = 45_000;
const MIN_PIECE = 256 * 1024;
const MAX_PIECE = 8 * 1024 * 1024;
const STEP = 64 * 1024;
const TARGET_PIECES = 80;
const SIGN_BATCH = 20;
const FP_EDGE = 64 * 1024;
const MEMO_KEY = "niete.upload.pieces";
const MEMO_DAYS = 21;

/** The pieces routes are not there (an older server): the caller sends the whole file the old way. */
export class PiecesUnavailable extends Error {
  constructor() { super("pieces_unavailable"); this.name = "PiecesUnavailable"; }
}

/**
 * About a minute of a weak (2G-ish, ~4 KB/s) line per piece for an in-app lesson (256 KB), bigger for a big file so a
 * lesson is never more than about 80 pieces; always a multiple of 64 KB, never over 8 MB.
 */
export function choosePieceBytes(size: number): number {
  const want = Math.ceil(size / TARGET_PIECES / STEP) * STEP;
  return Math.min(MAX_PIECE, Math.max(MIN_PIECE, want));
}

function httpStatus(err: unknown): number | null {
  const s = (err as { response?: { status?: number } })?.response?.status;
  return typeof s === "number" ? s : null;
}
function reasonOf(err: unknown): string {
  return String((err as { response?: { data?: { reason?: unknown } } })?.response?.data?.reason || "");
}

/** Our API answered and refused (a 4xx that is not "try later"): asking again will not help. */
function refused(err: unknown): boolean {
  const s = httpStatus(err);
  return s !== null && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

// ── waking a wait early: back online, or Try now ────────────────────────────

const wakers = new Set<() => void>();

/** End every wait now (Try now, or the page came back): each send asks the server again at once. */
export function wakePieces(): void {
  [...wakers].forEach((w) => w());
}

let wired = false;
function wireWake(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", wakePieces);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wakePieces(); });
  }
}

function wakeableSleep(ms: number): Promise<void> {
  wireWake();
  return new Promise((resolve) => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const done = () => { if (t) clearTimeout(t); wakers.delete(done); resolve(); };
    wakers.add(done);
    t = setTimeout(done, ms);
  });
}

// ── which recording is which ────────────────────────────────────────────────

async function fingerprint(blob: Blob, filename: string): Promise<string> {
  const head = await sha256Hex(blob.slice(0, Math.min(FP_EDGE, blob.size)));
  const tail = await sha256Hex(blob.slice(Math.max(0, blob.size - FP_EDGE), blob.size));
  if (head && tail) return `${blob.size}:${head.slice(0, 24)}:${tail.slice(0, 24)}`;
  return `${blob.size}:${String(filename || "").slice(0, 80)}`;
}

/** The phone's memory of which key each recording went up under: localStorage, pruned after MEMO_DAYS. */
export function localMemo(): Memo {
  const read = (): Record<string, Remembered> => {
    try {
      const v = JSON.parse(window.localStorage.getItem(MEMO_KEY) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch { return {}; }
  };
  const write = (all: Record<string, Remembered>) => {
    try {
      const cut = Date.now() - MEMO_DAYS * 86_400_000;
      const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => v && v.at > cut));
      window.localStorage.setItem(MEMO_KEY, JSON.stringify(kept));
    } catch { /* a private window: a reopened send then starts fresh, as before */ }
  };
  return {
    get: (fp) => read()[fp] || null,
    set: (fp, v) => { const all = read(); all[fp] = v; write(all); },
    forget: (fp) => { const all = read(); delete all[fp]; write(all); },
  };
}

/** For tests (and a page that wants nothing kept). */
export function memoryMemo(): Memo {
  const m = new Map<string, Remembered>();
  return { get: (fp) => m.get(fp) || null, set: (fp, v) => { m.set(fp, v); }, forget: (fp) => { m.delete(fp); } };
}

// ── the PUT ─────────────────────────────────────────────────────────────────

/**
 * PUT one piece by XHR (upload progress; no cookie: R2 needs none). Given up when nothing moved for STALL_MS, and
 * after a generous cap for the whole piece (2 KB/s), so a dead line never hangs a send.
 */
export const xhrPutPiece: PutPiece = (url, body, contentType, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  let stall: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => { try { xhr.abort(); } catch { /* gone */ } reject(new Error("upload failed (stalled)")); }, STALL_MS);
  };
  const end = () => { if (stall) clearTimeout(stall); };
  xhr.open("PUT", url);
  xhr.timeout = Math.max(120_000, Math.ceil(body.size / 2048) * 1000);
  xhr.setRequestHeader("Content-Type", contentType);
  xhr.upload.onprogress = (e) => { arm(); if (e.lengthComputable) onProgress?.(e.loaded); };
  xhr.onload = () => {
    end();
    if (xhr.status >= 200 && xhr.status < 300) resolve();
    else reject(new Error(`upload failed (${xhr.status})`));
  };
  xhr.onerror = () => { end(); reject(new Error("upload failed (network)")); };
  xhr.ontimeout = () => { end(); reject(new Error("upload failed (timeout)")); };
  xhr.onabort = () => { end(); reject(new Error("upload failed (abort)")); };
  arm();
  xhr.send(body);
});

// ── the send ────────────────────────────────────────────────────────────────

export type PiecesOptions = {
  api: PiecesApi;
  put?: PutPiece;
  memo?: Memo;
  /** The waits between tries with nothing new arriving (RETRY_WAITS_MS); after the last, the send fails. */
  waits?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** Forced piece size (tests); otherwise choosePieceBytes(size). */
  pieceBytes?: number;
  /**
   * An in-app recording's own id ("rec:<recordingId>"): its pieces are found again by the id, not by its bytes, because a
   * recording rebuilt from the phone's copy can carry a rewritten header (its duration) or more audio (she resumed). The
   * join's per-piece sha256 then names the pieces that changed and only those are sent again. Used only where this phone
   * can compute sha256 (without it, the content fingerprint, as for a picked file).
   */
  identity?: string;
  /** Bytes of this file the server has (pieces held + the piece going up). */
  onProgress?: (loaded: number) => void;
  onWait?: (w: WaitInfo) => void;
  onFailure?: (f: PieceFailure) => void;
};

/**
 * Send `blob` in pieces and join it; resolves to the final R2 key (the one the start reads). Rejects with the last
 * error when every wait ran out (what arrived stays: the same call picks it up), at once when our API refuses (a 4xx),
 * and with PiecesUnavailable when the pieces routes are not there (404 on begin: send the old way).
 */
export async function sendInPieces(blob: Blob, filename: string, opts: PiecesOptions): Promise<string> {
  const {
    api, put = xhrPutPiece, memo = localMemo(), waits = RETRY_WAITS_MS, sleep = wakeableSleep, onProgress, onWait, onFailure,
  } = opts;
  const size = blob.size;
  const byId = !!opts.identity && !!globalThis.crypto?.subtle;
  const fp = byId ? `id:${opts.identity}` : await fingerprint(blob, filename);
  let remembered = memo.get(fp);
  // A picked file is the same file only at the same size; an in-app recording keeps its pieces as it grows.
  if (remembered && !byId && remembered.sizeBytes !== size) remembered = null;
  const pieceBytes = remembered ? remembered.pieceBytes : (opts.pieceBytes || choosePieceBytes(size));

  let fails = 0;
  let attempt = 0;
  let sent = 0;
  let pieces = Math.ceil(size / pieceBytes);
  let progressed = false;
  let digests: (string | null)[] = [];

  const sliceOf = (n: number) => blob.slice(n * pieceBytes, Math.min((n + 1) * pieceBytes, size));
  const sizeOf = (n: number) => Math.min((n + 1) * pieceBytes, size) - n * pieceBytes;

  for (;;) {
    attempt += 1;
    progressed = false;
    let current = -1;
    let currentBytes = 0;
    try {
      let b: BeginAnswer;
      try {
        b = await api.begin({ filename, sizeBytes: size, pieceBytes, ...(remembered ? { key: remembered.key } : {}) });
      } catch (err) {
        if (httpStatus(err) === 404) throw new PiecesUnavailable();
        if (remembered && refused(err)) {
          // The key this phone remembered is no good any more (another account, a bad row): start fresh.
          memo.forget(fp);
          remembered = null;
          b = await api.begin({ filename, sizeBytes: size, pieceBytes });
        } else {
          throw err;
        }
      }
      remembered = { key: b.key, pieceBytes: b.pieceBytes, sizeBytes: size, at: Date.now() };
      memo.set(fp, remembered);
      pieces = b.pieces;
      if (b.joined) {
        // Joined already (a send whose answer was lost, or a Try again after the start failed): nothing to send.
        onProgress?.(size);
        return b.key;
      }
      const held = new Set(b.have);
      let heldBytes = [...held].reduce((s, n) => s + sizeOf(n), 0);
      sent = held.size;
      onProgress?.(heldBytes);

      let rounds = 0;
      for (;;) {
        const todo: number[] = [];
        for (let n = 0; n < pieces; n += 1) if (!held.has(n)) todo.push(n);
        for (let i = 0; i < todo.length; i += SIGN_BATCH) {
          const batch = todo.slice(i, i + SIGN_BATCH);
          // eslint-disable-next-line no-await-in-loop
          const signed = await api.sign({ key: b.key, pieces: batch, attempt });
          for (const { n, url } of signed.urls) {
            current = n;
            currentBytes = 0;
            const base = heldBytes;
            // eslint-disable-next-line no-await-in-loop
            await put(url, sliceOf(n), signed.contentType, (loaded) => {
              currentBytes = loaded;
              onProgress?.(Math.min(size, base + loaded));
            });
            held.add(n);
            heldBytes += sizeOf(n);
            sent = held.size;
            progressed = true;
            onProgress?.(heldBytes);
          }
        }
        current = -1;
        if (digests.length !== pieces) digests = new Array(pieces).fill(null);
        for (let n = 0; n < pieces; n += 1) {
          // eslint-disable-next-line no-await-in-loop
          if (!digests[n]) digests[n] = await sha256Hex(sliceOf(n), Number.MAX_SAFE_INTEGER);
        }
        try {
          const all = digests.every((d) => !!d) ? (digests as string[]) : undefined;
          const out = await api.join({ key: b.key, sizeBytes: size, pieceBytes: b.pieceBytes, ...(all ? { digests: all } : {}) });
          onProgress?.(size);
          // Kept (pruned after MEMO_DAYS): a Try again after a failed start finds it joined and sends nothing again.
          return out.key || b.key;
        } catch (err) {
          const again = (err as { response?: { data?: { missing?: number[]; bad?: number[] } } })?.response?.data;
          const redo = reasonOf(err) === "pieces_missing" ? again?.missing : reasonOf(err) === "pieces_mismatch" ? again?.bad : null;
          if (!redo || !redo.length || rounds >= 2) throw err;
          rounds += 1;
          redo.forEach((n) => { if (held.delete(n)) heldBytes -= sizeOf(n); });
          sent = held.size;
        }
      }
    } catch (err) {
      if (err instanceof PiecesUnavailable) throw err;
      try { onFailure?.({ piece: current, pieces, attempt, err, sentBytes: currentBytes }); } catch { /* reporting never decides */ }
      if (refused(err)) throw err;
      if (progressed) fails = 0;
      if (fails >= waits.length) throw err;
      const ms = waits[fails];
      fails += 1;
      try {
        onWait?.({ ms, attempt, sent, pieces, sentBytes: Math.min(size, sent * pieceBytes), online: isOnline() });
      } catch { /* never decides */ }
      // eslint-disable-next-line no-await-in-loop
      await sleep(ms);
    }
  }
}
