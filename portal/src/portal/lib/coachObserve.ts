/**
 * bd-5rz1v.6 — a coach's /observe observation, run from the portal.
 *
 * The entry follows the teachers' Option B: ONE button that names the goal (it
 * does not promise to record) and a sheet with the two ways — record it now in
 * her class, or send a recording already on the phone. Its words mirror
 * whichever B variant the operator picks for teachers (canvas EntryB-1..4),
 * so they live here and nowhere else: change ENTRY_VARIANT, every coach screen
 * follows.
 *
 * Sending reuses the teacher's sendLesson (every file to R2 first, then the
 * start), pointed at the coach's endpoints and carrying the observed teacher.
 */

import { leader, portal } from "../services/api";
import type { CoachObservationView, ObserveStep } from "../services/api";
import { sendLesson, SendError, type PlanChoice } from "./coachingSend";

export type EntryVariant = "B1" | "B2" | "B3" | "B4";

/** The operator's pick for the teachers' button (2026-10-02: B3, colour Colour-3 deep green). */
export const ENTRY_VARIANT: EntryVariant = "B3";

type EntryCopy = {
  title: string; sub: string; sheet: (name: string) => string;
  rec: string; recSub: string; file: string; fileSub: string;
};

export const ENTRY_COPY: Record<EntryVariant, EntryCopy> = {
  B1: {
    title: "Ask your Digital Coach about a lesson",
    sub: "Share one lesson you watched. Get tips for the teacher.",
    sheet: (name) => `Share ${name}’s lesson`,
    rec: "Record now",
    recSub: "Start when her class starts.",
    file: "Send a recording",
    fileSub: "One already on your phone.",
  },
  B2: {
    title: "Get tips for a teacher",
    sub: "Your Digital Coach listens to her lesson and suggests what to try next.",
    sheet: (name) => `How will you share ${name}’s lesson?`,
    rec: "Record now",
    recSub: "Start when her class starts.",
    file: "Send a recording",
    fileSub: "One already on your phone.",
  },
  // The operator's pick (2026-10-02): B3, with the teachers' sheet words
  // "Record Live Lecture" / "Upload Recording".
  B3: {
    title: "Send a lesson to your Digital Coach",
    sub: "Record it in her class, or send one you already have.",
    sheet: (name) => `Send ${name}’s lesson`,
    rec: "Record Live Lecture",
    recSub: "Start when her class starts.",
    file: "Upload Recording",
    fileSub: "One already on your phone.",
  },
  B4: {
    title: "Get feedback on a lesson",
    sub: "Your Digital Coach listens and drafts her feedback.",
    sheet: (name) => `${name}’s lesson`,
    rec: "Record it now",
    recSub: "Start when her class starts.",
    file: "Send a recording",
    fileSub: "One already on your phone.",
  },
};

export function entryCopy(variant: EntryVariant = ENTRY_VARIANT): EntryCopy {
  return ENTRY_COPY[variant] || ENTRY_COPY.B3;
}

/** The first name, for "Talk with Ayesha" — the whole name when there is no space. */
export function firstName(name: string | null | undefined): string {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0] : "the teacher";
}

// ── the steps, in the order WhatsApp /observe walks her through them ────────

export type TrackerItem = { key: "analysed" | "draft" | "talk" | "feedback" | "report"; label: string };

export function trackerItems(name: string): TrackerItem[] {
  return [
    { key: "analysed", label: "Lesson analysed" },
    { key: "draft", label: "Check the draft report" },
    { key: "talk", label: `Talk with ${name}` },
    { key: "feedback", label: "Your feedback" },
    { key: "report", label: `Send ${name} her report` },
  ];
}

/** How far along the tracker a step is: items before it are done, it is "you". */
export function trackerIndex(step: ObserveStep): number {
  switch (step) {
    case "analysing": return 0;
    case "draft": return 1;
    case "talk": case "listening": return 2;
    case "feedback": return 3;
    case "report": case "sending": return 4;
    case "waiting_teacher": case "sent": case "done": return 5;
    default: return -1;
  }
}

/** Steps that change by themselves — the page re-reads while one is showing. */
export function isWaiting(view: Pick<CoachObservationView, "step" | "preparing">): boolean {
  return view.step === "analysing" || view.step === "listening" || view.step === "sending"
    || (view.step === "report" && view.preparing);
}

export const STEP_CHIP: Record<ObserveStep, string> = {
  analysing: "Being analysed",
  draft: "Check the draft",
  talk: "Talk with her",
  listening: "Listening to your talk",
  feedback: "Your feedback is ready",
  report: "Send her the report",
  sending: "Sending",
  waiting_teacher: "Waiting for her",
  sent: "Sent to her",
  done: "Done",
  stopped: "Stopped",
};

// ── sending ────────────────────────────────────────────────────────────────

type ObserveApi = Pick<typeof leader, "presignObserveUpload" | "startObservation" | "startTalk">;
type UploadApi = Pick<typeof portal, "uploadToR2">;

/** Send her lesson: the teacher's sendLesson, through the coach's endpoints, for this teacher. */
export function sendObservation(
  args: {
    teacherExtId: string;
    schoolExtId?: string | null;
    audio: { blob: Blob; filename: string };
    plan: PlanChoice | null;
    photos: File[];
  },
  api: ObserveApi = leader,
  upload: UploadApi = portal,
  onProgress?: (pct: number) => void,
): Promise<{ coachingSessionId: string }> {
  const { teacherExtId, schoolExtId, audio, plan, photos } = args;
  return sendLesson({ audio, plan, photos }, {
    presignCoachingUpload: (a) => api.presignObserveUpload(a),
    uploadToR2: (url, blob, type, cb) => upload.uploadToR2(url, blob, type, cb),
    startCoachingUpload: (start) => api.startObservation({ ...start, teacherExtId, schoolExtId: schoolExtId || null }),
  }, onProgress);
}

/** Send her talk with the teacher: one audio file to R2, then attach it to the observation. */
export async function sendTalk(
  coachingSessionId: string,
  audio: { blob: Blob; filename: string },
  api: ObserveApi = leader,
  upload: UploadApi = portal,
  onProgress?: (pct: number) => void,
): Promise<void> {
  let key: string;
  try {
    const signed = await api.presignObserveUpload({ filename: audio.filename, sizeBytes: audio.blob.size, kind: "audio" });
    await upload.uploadToR2(signed.uploadUrl, audio.blob, signed.contentType,
      (loaded) => onProgress?.(Math.min(100, Math.round((loaded / (audio.blob.size || 1)) * 100))));
    key = signed.key;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    throw new SendError(status === 400 ? "refused" : "network");
  }
  try {
    await api.startTalk(coachingSessionId, key);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    throw new SendError(status != null && status >= 400 && status < 500 ? "refused" : "network");
  }
}

// ── a recording not sent yet: whose lesson it was ──────────────────────────
//
// The recorder keeps every lesson on the phone until it has arrived
// (recordingStore). For a coach, the recording alone does not say which
// teacher it was, so the teacher is kept beside its id here.

const UNSENT_KEY = "niete-coach-observe-recordings";

export type UnsentFor = { teacherExtId: string; schoolExtId: string | null; teacherName: string };

function readUnsent(): Record<string, UnsentFor> {
  try {
    const raw = window.localStorage.getItem(UNSENT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberRecording(recordingId: string, teacher: UnsentFor): void {
  try {
    const all = readUnsent();
    all[recordingId] = teacher;
    window.localStorage.setItem(UNSENT_KEY, JSON.stringify(all));
  } catch { /* a convenience: the recording is still on the phone either way */ }
}

export function recordingTeacher(recordingId: string): UnsentFor | null {
  return readUnsent()[recordingId] || null;
}

export function forgetRecording(recordingId: string): void {
  try {
    const all = readUnsent();
    delete all[recordingId];
    window.localStorage.setItem(UNSENT_KEY, JSON.stringify(all));
  } catch { /* nothing to forget */ }
}
