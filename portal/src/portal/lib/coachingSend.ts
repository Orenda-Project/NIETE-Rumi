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
 */

import { portal, type LiveMovesRecord } from "../services/api";
import { failureOf, reportSendFailure, type SendFailure } from "./dcUploadReport";

export type LibraryPick = { assetId: string } | { lessonId: string } | { segmentId: string; lang: "en" | "ur" };

export type PlanChoice =
  | { kind: "library"; pick: LibraryPick }
  | { kind: "file"; file: File };

/**
 * bd-fmf24g.9 — the class (grade·subject) she picked in the teacher app. It travels with the recording and is the
 * subject the lesson is scored on. `subjectKey` is the registry key (maths, science…) when her pick carried one.
 */
export type TeacherClass = { grade: number; subject: string; subjectKey?: string };

/** already_sent (bd-c5reix): that recording is already a DC observation of hers (a kept WhatsApp recording sent twice). */
export type SendKind = "network" | "in_progress" | "already_sent" | "plan_not_ready" | "plan_not_found" | "refused";

export class SendError extends Error {
  constructor(public kind: SendKind, public coachingSessionId?: string, message?: string) {
    super(message || kind);
    this.name = "SendError";
  }
}

type Api = Pick<typeof portal, "presignCoachingUpload" | "uploadToR2" | "startCoachingUpload">;

type Args = {
  /** The recording to upload, or (bd-c5reix) the key of one already in R2: her recording kept from WhatsApp. */
  audio: { blob: Blob; filename: string } | { key: string };
  plan: PlanChoice | null;
  photos: File[];
  /** Digital Coaching from the teacher app: the class she picked. Absent elsewhere. */
  teacherClass?: TeacherClass | null;
  /** bd-v0toag.31: what the live screen saw while she recorded. Absent when it was off. */
  liveMoves?: LiveMovesRecord | null;
};

type Item = { blob: Blob; filename: string; kind: "audio" | "lesson_plan" | "photo" };

function httpStatus(err: unknown): number | null {
  const s = (err as { response?: { status?: number } })?.response?.status;
  return typeof s === "number" ? s : null;
}

function body(err: unknown): Record<string, unknown> {
  return ((err as { response?: { data?: Record<string, unknown> } })?.response?.data) || {};
}

export async function sendLesson(
  { audio, plan, photos, teacherClass, liveMoves }: Args,
  api: Api = portal,
  onProgress?: (pct: number) => void,
  /** bd-1d6g8o: where a failure is reported (the logs); never changes the outcome. */
  report: (f: SendFailure) => void = reportSendFailure,
): Promise<{ coachingSessionId: string }> {
  const saved = "key" in audio ? audio.key : null;
  const items: Item[] = [
    ...("key" in audio ? [] : [{ blob: audio.blob, filename: audio.filename, kind: "audio" as const }]),
    ...(plan && plan.kind === "file" ? [{ blob: plan.file, filename: plan.file.name, kind: "lesson_plan" as const }] : []),
    ...photos.map((p) => ({ blob: p, filename: p.name, kind: "photo" as const })),
  ];
  const total = items.reduce((n, it) => n + it.blob.size, 0) || 1;
  let done = 0;
  const progress = (bytes: number) => onProgress?.(Math.min(100, Math.round((bytes / total) * 100)));

  const startedAt = Date.now();
  const tell = (f: Omit<SendFailure, "items" | "elapsedMs">) => {
    try { report({ ...f, items: items.length, elapsedMs: Date.now() - startedAt }); } catch { /* never decides */ }
  };
  const keys: { kind: Item["kind"]; key: string }[] = [];
  let at = 0;
  let stage: "presign" | "upload" = "presign";
  try {
    for (const it of items) {
      at += 1;
      stage = "presign";
      // eslint-disable-next-line no-await-in-loop
      const { key, uploadUrl, contentType } = await api.presignCoachingUpload({
        filename: it.filename, sizeBytes: it.blob.size, kind: it.kind,
      });
      stage = "upload";
      // eslint-disable-next-line no-await-in-loop
      await api.uploadToR2(uploadUrl, it.blob, contentType, (loaded) => progress(done + loaded));
      done += it.blob.size;
      progress(done);
      keys.push({ kind: it.kind, key });
    }
  } catch (err) {
    const it = items[at - 1];
    tell({ stage, kind: it ? it.kind : null, item: at, ...failureOf(err), sizeBytes: it ? it.blob.size : 0, type: it ? it.blob.type || "" : "" });
    const status = httpStatus(err);
    if (status === 400) throw new SendError("refused", undefined, String(body(err).reason || "refused"));
    throw new SendError("network");
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

  try {
    return await api.startCoachingUpload(start);
  } catch (err) {
    tell({ stage: "start", kind: null, item: 0, ...failureOf(err), sizeBytes: 0, type: "" });
    const status = httpStatus(err);
    const b = body(err);
    if (status === 409 && (b.status === "in_progress" || b.status === "already_sent")) {
      throw new SendError(b.status, typeof b.coachingSessionId === "string" ? b.coachingSessionId : undefined);
    }
    if (status === 400 && (b.reason === "plan_not_ready" || b.reason === "plan_not_found")) {
      throw new SendError(b.reason);
    }
    if (status != null && status >= 400 && status < 500) throw new SendError("refused", undefined, String(b.reason || ""));
    throw new SendError("network");
  }
}
