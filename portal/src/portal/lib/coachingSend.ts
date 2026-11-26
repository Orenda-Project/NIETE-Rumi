/**
 * bd-5rz1v — "Send to Digital Coach".
 *
 * Every file goes straight to R2 (presign → PUT), then the analysis starts.
 * Nothing is started unless EVERY file arrived: a lesson analysed without the
 * plan she attached would be a worse report than one that waits.
 *
 * A lesson plan is either a FILE (her own plan, or a photo of it) — uploaded as
 * `lesson_plan` — or a LIBRARY pick, which uploads nothing and travels as
 * `lessonPlan`; the bot links it the way the WhatsApp list does.
 *
 * Failures are SendError with a kind the page can say something useful about.
 *
 * bd-bmc9a0.1 — ICT IAB rows 28–29 ("No internet" on strong Wi-Fi). A file she PICKED is never sent as itself: an
 * in-memory copy of its bytes is. In the Android app a picked file is a handle the WebView re-opens to send it, and for
 * some files (production, 21–28 Oct: 1,538 failures from 39 teachers) that request died in under a second, every time,
 * while the same bytes went through from WhatsApp's browser and the app's own recordings (a Blob) went through from the
 * same app. A transport failure is still kind "network" (every screen handles it), and now carries `detail`: which part
 * did not go, whether the phone was offline (only then is it "No internet"), and whether the file could not be read.
 */

import { portal, type LiveMovesRecord } from "../services/api";
import { failureOf, reportSendFailure, type SendFailure } from "./dcUploadReport";
import { isHeld, readPicked, READ_RETRY_MS, Unreadable } from "./pickedRead";
import { PiecesUnavailable, sendInPieces, type PiecesApi, type PiecesOptions, type WaitInfo } from "./pieceUpload";
import { readConfigShared } from "./useNewUi";

export type LibraryPick = { assetId: string } | { lessonId: string } | { segmentId: string; lang: "en" | "ur" } | { ownId: string };

export type PlanChoice =
  | { kind: "library"; pick: LibraryPick }
  | { kind: "file"; file: File };

/**
 * bd-fmf24g.9 — the class (grade·subject) she picked in the teacher app. It travels with the recording and is the
 * subject the lesson is scored on. `subjectKey` is the registry key (maths, science…) when her pick carried one.
 */
export type TeacherClass = { grade: number; subject: string; subjectKey?: string };

/** already_sent (bd-c5reix): that recording is already a DC observation of hers (a kept WhatsApp recording sent twice). */
/** empty_recording (bd-r2uzg1.23.5, ICT call 6A): the recording is 0 bytes — nothing was recorded or it never arrived. */
export type SendKind = "network" | "in_progress" | "already_sent" | "plan_not_ready" | "plan_not_found" | "refused" | "empty_recording";

/** bd-bmc9a0.1 — the part that did not go: the recording, her plan file, or photo N (1-based; 0 for the others). */
export type SendPart = { kind: "audio" | "lesson_plan" | "photo"; photo: number };

/**
 * bd-bmc9a0.1 — what a "network" failure was. `part` is null when every file arrived and starting the analysis failed.
 * `offline`: the phone said it had no connection (navigator.onLine === false) — the only time the page says
 * "No internet". `unreadable`: the phone could not read the file she picked, so nothing was sent for it.
 */
export type SendDetail = { part: SendPart | null; offline: boolean; unreadable: boolean };

export class SendError extends Error {
  constructor(public kind: SendKind, public coachingSessionId?: string, message?: string, public detail?: SendDetail) {
    super(message || kind);
    this.name = "SendError";
  }
}

/** bd-bmc9a0.1 — the phone says it has no connection. Unknown (no navigator) is not offline. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** bd-q261rec — `pieces`: her recording in pieces that resume (lib/pieceUpload); absent, one PUT as before. */
type Api = Pick<typeof portal, "presignCoachingUpload" | "uploadToR2" | "startCoachingUpload"> & { pieces?: PiecesApi };

/**
 * bd-q261rec (queue #261) — is portal_upload_pieces on for the signed-in user (/config features.uploadPieces)? The shared
 * /config read, so no extra request. Fail-closed: an unreadable config sends the old way.
 */
export async function uploadPiecesOn(): Promise<boolean> {
  try {
    const cfg = await readConfigShared();
    return (cfg as { features?: { uploadPieces?: unknown } } | null)?.features?.uploadPieces === true;
  } catch {
    return false;
  }
}

type Args = {
  /** The recording to upload, or (bd-c5reix) the key of one already in R2: her recording kept from WhatsApp. */
  /** bd-q261rec — `recordingId`: an in-app recording's id, so its pieces are found again after a kill (pieceUpload). */
  audio: { blob: Blob; filename: string; recordingId?: string | null } | { key: string };
  plan: PlanChoice | null;
  photos: File[];
  /** Digital Coaching from the teacher app: the class she picked. Absent elsewhere. */
  teacherClass?: TeacherClass | null;
  /** bd-v0toag.31: what the live screen saw while she recorded. Absent when it was off. */
  liveMoves?: LiveMovesRecord | null;
  /**
   * bd-bmc9a0.1 — what already arrived, by the file the page holds: Try again (the same map) sends only the rest. A
   * WeakMap, so a file she removed takes its entry with it.
   */
  uploaded?: WeakMap<Blob, string>;
  /** bd-bmc9a0.2 (ICT IAB row 31): "Save recording" — the same send, marked saved to come back to. */
  saveForLater?: boolean;
  /** bd-r2uzg1.9: the waits before each extra try of a picked file's failed read (READ_RETRY_MS; tests pass zeros). */
  readWaits?: number[];
  /**
   * bd-tfya0m (queue #205) — the waits before each extra try of a START that got no answer (no response, or a 5xx such
   * as a deploy restarting the bot). Absent: one try, as before (the teacher's start answers a repeat with 409). The
   * coach's start answers a repeat of the same recording with the same observation, so its send passes waits.
   */
  startRetryMs?: number[];
  /**
   * bd-q261rec (queue #261) — send the recording in pieces (when `api.pieces` is there): true / false, or absent to ask
   * /config (uploadPiecesOn). `onWait`: the line dropped and the send waits to go on (she is told, with Try now).
   * `pieceOptions`: the sender's own options (tests: memo, put, sleep, waits, piece size).
   */
  piecesOn?: boolean;
  onWait?: (w: WaitInfo) => void;
  pieceOptions?: Partial<PiecesOptions>;
};

type Item = { blob: Blob; filename: string; kind: "audio" | "lesson_plan" | "photo"; photo: number };

/**
 * bd-bmc9a0.1 — files up to this size are copied into memory to be sent (a 45-minute m4a is about 40 MB; the same
 * order as the duplicate check's whole-file read, which phones already do at pick time). A larger one is sent as a
 * slice: a plain Blob over the same bytes, read through the browser's blob store rather than re-opened as a file.
 */
export const COPY_MAX_BYTES = 64 * 1024 * 1024;

type Body = { body: Blob; sentAs: SendFailure["sentAs"] };

/** A picked file (File) — as opposed to a Blob the page made itself (an in-app recording). */
function isPicked(blob: Blob): boolean {
  return typeof File !== "undefined" && blob instanceof File;
}

/**
 * What is PUT for one file: never a picked File itself (see the header). A Blob the page made, or (bd-r2uzg1.9) a photo
 * the page read into memory when she picked it, is sent as it is.
 */
async function bodyOf(blob: Blob, waits: number[]): Promise<Body> {
  if (!isPicked(blob) || isHeld(blob)) return { body: blob, sentAs: "blob" };
  if (blob.size <= COPY_MAX_BYTES) {
    try {
      // bd-r2uzg1.9: a failed read is tried again before it counts (readPicked); after every try it is Unreadable.
      return { body: new Blob([await readPicked(blob, waits)], { type: blob.type }), sentAs: "copy" };
    } catch (err) {
      // Out of memory for the copy is not her file's fault: the slice below still sends it. Anything else is a file
      // this phone cannot read.
      if (!(err instanceof RangeError)) throw err instanceof Unreadable ? err : new Unreadable(null, String((err as Error)?.message || err));
    }
  }
  return { body: blob.slice(0, blob.size, blob.type), sentAs: "slice" };
}

/** bd-w0zbbe — SendError("refused").message when our API answers 403/404: this account cannot send here. */
export const NOT_AVAILABLE = "not_available";

function httpStatus(err: unknown): number | null {
  const s = (err as { response?: { status?: number } })?.response?.status;
  return typeof s === "number" ? s : null;
}

function body(err: unknown): Record<string, unknown> {
  return ((err as { response?: { data?: Record<string, unknown> } })?.response?.data) || {};
}

/** bd-tfya0m — the start got no answer: no response at all, or a 5xx (the bot or its proxy, e.g. during a deploy). */
function unanswered(err: unknown): boolean {
  const s = httpStatus(err);
  return s === null || s >= 500;
}

const wait = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/**
 * bd-tfya0m (queue #205) — ask for the start again while no answer comes back: once, then once after each wait. An
 * answer (2xx, or a 4xx such as not_your_teacher) ends it at once. `onUnanswered` sees every unanswered try.
 */
async function startWithRetry<T>(ask: () => Promise<T>, waits: number[], onUnanswered: (err: unknown) => void): Promise<T> {
  for (let n = 0; ; n += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await ask();
    } catch (err) {
      if (!unanswered(err)) throw err;
      onUnanswered(err);
      if (n >= waits.length) throw err;
      // eslint-disable-next-line no-await-in-loop
      await wait(waits[n]);
    }
  }
}

/** The MIME type without its parameters ("audio/ogg; codecs=opus" → "audio/ogg"), for the failure report. */
function bareType(type: string): string {
  return String(type || "").split(";")[0].trim();
}

export async function sendLesson(
  {
    audio, plan, photos, teacherClass, liveMoves, uploaded, saveForLater, readWaits = READ_RETRY_MS, startRetryMs = [],
    piecesOn, onWait, pieceOptions,
  }: Args,
  api: Api = portal,
  onProgress?: (pct: number) => void,
  /** bd-1d6g8o: where a failure is reported (the logs); never changes the outcome. */
  report: (f: SendFailure) => void = reportSendFailure,
): Promise<{ coachingSessionId: string }> {
  const saved = "key" in audio ? audio.key : null;
  // bd-r2uzg1.23.5 (queue #274, ICT call 6A): an empty recording is stopped before anything is uploaded; the server
  // refuses one too (reason recording_empty), so an analysis is never started on it.
  if (!("key" in audio) && audio.blob.size === 0) throw new SendError("empty_recording");
  const items: Item[] = [
    ...("key" in audio ? [] : [{ blob: audio.blob, filename: audio.filename, kind: "audio" as const, photo: 0 }]),
    ...(plan && plan.kind === "file" ? [{ blob: plan.file, filename: plan.file.name, kind: "lesson_plan" as const, photo: 0 }] : []),
    ...photos.map((p, i) => ({ blob: p, filename: p.name, kind: "photo" as const, photo: i + 1 })),
  ];
  const total = items.reduce((n, it) => n + it.blob.size, 0) || 1;
  let done = 0;
  const progress = (bytes: number) => onProgress?.(Math.min(100, Math.round((bytes / total) * 100)));

  const startedAt = Date.now();
  const tell = (f: Omit<SendFailure, "items" | "elapsedMs" | "online">) => {
    try { report({ ...f, items: items.length, elapsedMs: Date.now() - startedAt, online: !isOffline() }); } catch { /* never decides */ }
  };
  const keys: { kind: Item["kind"]; key: string }[] = [];
  let at = 0;
  let stage: SendFailure["stage"] = "presign";
  let sentAs: SendFailure["sentAs"] = "none";
  let sentBytes = 0;
  // bd-q261rec — the pieces sender reports each failed try itself (onFailure); the catch below then does not repeat it.
  let reportedByPieces = false;
  const pieces = api.pieces && items.some((it) => it.kind === "audio")
    ? (piecesOn ?? await uploadPiecesOn()) && api.pieces
    : null;
  try {
    for (const it of items) {
      at += 1;
      sentAs = "none";
      sentBytes = 0;
      const already = uploaded?.get(it.blob);
      if (already) {
        // Arrived on an earlier Submit from this screen: not sent again.
        keys.push({ kind: it.kind, key: already });
        done += it.blob.size;
        progress(done);
        continue;
      }
      stage = "read";
      // eslint-disable-next-line no-await-in-loop
      const out = await bodyOf(it.blob, readWaits);
      sentAs = out.sentAs;
      if (it.kind === "audio" && pieces) {
        // bd-q261rec (queue #261): the recording in pieces that resume after a drop; on an older server (no pieces
        // routes) it falls through to the one PUT below.
        stage = "upload";
        try {
          const base = done;
          // eslint-disable-next-line no-await-in-loop
          const rid = !("key" in audio) ? audio.recordingId : null;
          const key = await sendInPieces(out.body, it.filename, {
            ...(rid ? { identity: `rec:${rid}` } : {}),
            ...pieceOptions,
            api: pieces,
            onProgress: (loaded) => { sentBytes = loaded; progress(base + loaded); },
            onWait,
            onFailure: (f) => {
              reportedByPieces = true;
              tell({
                stage: f.piece < 0 ? "presign" : "upload", kind: "audio", item: at, ...failureOf(f.err),
                sizeBytes: it.blob.size, type: bareType(it.blob.type), sentBytes: f.sentBytes, sentAs: "pieces",
                piece: f.piece, pieces: f.pieces, attempt: f.attempt,
              });
            },
          });
          done += it.blob.size;
          progress(done);
          keys.push({ kind: it.kind, key });
          uploaded?.set(it.blob, key);
          continue;
        } catch (err) {
          if (!(err instanceof PiecesUnavailable)) throw err;
          reportedByPieces = false;
        }
      }
      stage = "presign";
      // eslint-disable-next-line no-await-in-loop
      const { key, uploadUrl, contentType } = await api.presignCoachingUpload({
        filename: it.filename, sizeBytes: it.blob.size, kind: it.kind,
      });
      stage = "upload";
      // eslint-disable-next-line no-await-in-loop
      await api.uploadToR2(uploadUrl, out.body, contentType, (loaded) => { sentBytes = loaded; progress(done + loaded); });
      done += it.blob.size;
      progress(done);
      keys.push({ kind: it.kind, key });
      uploaded?.set(it.blob, key);
    }
  } catch (err) {
    const it = items[at - 1];
    const unreadable = err instanceof Unreadable;
    const part = it ? { kind: it.kind, photo: it.photo } : null;
    if (!reportedByPieces) tell({
      stage, kind: it ? it.kind : null, item: at,
      ...(unreadable ? { status: null, reason: "unreadable" as const, errName: err.errName } : failureOf(err)),
      sizeBytes: it ? it.blob.size : 0, type: it ? bareType(it.blob.type) : "", sentBytes, sentAs,
    });
    const status = httpStatus(err);
    if (status === 400) throw new SendError("refused", undefined, String(body(err).reason || "refused"));
    // bd-w0zbbe: our API's 403/404 means this account cannot send here (production 16 Nov: a principal the observe API
    // does not admit read "The internet stopped" on every try). Not the internet; nothing to retry.
    if (status === 403 || status === 404) throw new SendError("refused", undefined, NOT_AVAILABLE);
    throw new SendError("network", undefined, undefined, { part, offline: isOffline(), unreadable });
  }

  if (!items.length) onProgress?.(100);
  const start: Parameters<Api["startCoachingUpload"]>[0] = {
    key: saved ?? keys.find((k) => k.kind === "audio")!.key,
    photoKeys: keys.filter((k) => k.kind === "photo").map((k) => k.key),
  };
  const lessonPlanKey = keys.find((k) => k.kind === "lesson_plan")?.key;
  if (lessonPlanKey) start.lessonPlanKey = lessonPlanKey;
  if (plan && plan.kind === "library") start.lessonPlan = plan.pick;
  if (teacherClass) start.teacherClass = teacherClass;
  if (liveMoves) start.liveMoves = liveMoves;
  if (saveForLater === true) start.saveForLater = true;

  try {
    return await startWithRetry(() => api.startCoachingUpload(start), startRetryMs, (err) => {
      // Each unanswered try is logged as it happens, so a start that needed a second ask is visible too.
      tell({ stage: "start", kind: null, item: 0, ...failureOf(err), sizeBytes: 0, type: "", sentBytes: 0, sentAs: "none" });
    });
  } catch (err) {
    if (!unanswered(err)) {
      tell({ stage: "start", kind: null, item: 0, ...failureOf(err), sizeBytes: 0, type: "", sentBytes: 0, sentAs: "none" });
    }
    const status = httpStatus(err);
    const b = body(err);
    if (status === 409 && (b.status === "in_progress" || b.status === "already_sent")) {
      throw new SendError(b.status, typeof b.coachingSessionId === "string" ? b.coachingSessionId : undefined);
    }
    if (status === 400 && (b.reason === "plan_not_ready" || b.reason === "plan_not_found")) {
      throw new SendError(b.reason);
    }
    if (status === 400 && b.reason === "recording_empty") throw new SendError("empty_recording");
    if (status === 403 || status === 404) throw new SendError("refused", undefined, NOT_AVAILABLE);
    if (status != null && status >= 400 && status < 500) throw new SendError("refused", undefined, String(b.reason || ""));
    throw new SendError("network", undefined, undefined, { part: null, offline: isOffline(), unreadable: false });
  }
}
