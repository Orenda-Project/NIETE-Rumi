/**
 * bd-5rz1v.6 — a coach's /observe observation, run from the portal.
 *
 * The entry follows the teachers' Option B structure: ONE button, then a sheet
 * with the two ways — record it now in the class, or upload a recording already
 * on the phone. Its words live here (COACH_ENTRY) and nowhere else.
 *
 * Sending reuses the teacher's sendLesson (every file to R2 first, then the
 * start), pointed at the coach's endpoints and carrying the observed teacher.
 */

import { leader, portal } from "../services/api";
import type { CoachObservationView, ObserveLesson, ObserveNote, ObserveStep } from "../services/api";
import { sendLesson, SendError, uploadPiecesOn, type PlanChoice } from "./coachingSend";
import { PiecesUnavailable, sendInPieces, type PiecesOptions, type WaitInfo } from "./pieceUpload";

type EntryCopy = {
  title: string; sub: string; sheet: (name: string) => string;
  rec: string; recSub: string; file: string; fileSub: string;
};

/**
 * The coach's entry (operator, 2026-10-02): it speaks to the COACH — "Record
 * your Teacher's Lesson" — not to a teacher about her own lesson. The sheet's
 * two ways keep the teachers' words (Record Live Lecture / Upload Recording).
 * Neutral throughout: the teacher may be a man.
 */
export const COACH_ENTRY: EntryCopy = {
  title: "Record your Teacher’s Lesson",
  sub: "Record it in their class, or upload one you already have.",
  sheet: (name) => `Record ${name}’s lesson`,
  rec: "Record Live Lecture",
  recSub: "Start when their class starts.",
  file: "Upload Recording",
  fileSub: "One already on your phone.",
};

export function entryCopy(): EntryCopy {
  return COACH_ENTRY;
}

/** The first name, for "Talk with Ayesha" — the whole name when there is no space. */
export function firstName(name: string | null | undefined): string {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0] : "the teacher";
}

// ── coach app v2 (bd-o15qnr.19) ──────────────────────────────────────────────
//
// The draft, talk and observation pages are shared with coaches who do not have
// v2. Reached from v2 they carry ?from=coach: they then name the steps the v2
// way (operator: "Draft should be Feedback Form, Talk should be Debrief") and
// return to the v2 observation page. Without it they render exactly as before.

export const FROM_COACH = "from=coach";

/** True when this page was opened from the coach app v2. */
export function openedFromCoach(search: URLSearchParams): boolean {
  return search.get("from") === "coach";
}

/** Where "back" goes: the v2 observation page from v2, the observation page otherwise. */
export function observationHome(id: string | undefined, fromCoach: boolean): string {
  return fromCoach ? `/portal/coach/observation/${id}` : `/portal/leader/observe/${id}`;
}

export const V2_STEP = { draft: "Feedback Form", talk: "Debrief" } as const;

// ── the steps, in the order WhatsApp /observe walks her through them ────────

export type TrackerItem = { key: "analysed" | "draft" | "talk" | "feedback" | "report"; label: string };

export function trackerItems(name: string, fromCoach = false): TrackerItem[] {
  return [
    { key: "analysed", label: "Lesson analysed" },
    { key: "draft", label: fromCoach ? V2_STEP.draft : "Check the draft report" },
    { key: "talk", label: fromCoach ? V2_STEP.talk : `Talk with ${name}` },
    { key: "feedback", label: "Your feedback" },
    { key: "report", label: `Send ${name} the report` },
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
  talk: "Talk with the teacher",
  listening: "Listening to your talk",
  feedback: "Your feedback is ready",
  report: "Send the report",
  sending: "Sending",
  waiting_teacher: "Waiting for the teacher",
  sent: "Report sent",
  done: "Done",
  stopped: "Stopped",
};

// ── sending ────────────────────────────────────────────────────────────────

/** bd-q261rec — `observePieces`: her recording in pieces that resume (absent in older tests: one PUT, as before). */
type ObserveApi = Pick<typeof leader, "presignObserveUpload" | "startObservation" | "startTalk">
  & Partial<Pick<typeof leader, "observePieces">>;

/** bd-q261rec (queue #261) — how her recording goes up: in pieces or not (absent: /config says), and who is told it waits. */
export type PieceChoice = { piecesOn?: boolean; onWait?: (w: WaitInfo) => void; pieceOptions?: Partial<PiecesOptions> };
type UploadApi = Pick<typeof portal, "uploadToR2">;

/**
 * bd-tfya0m (queue #205) — an unanswered start is asked again after these waits. Production 19 Nov: a coach's recording
 * reached R2 and no start ever reached the server. The bot answers a repeated start of the same recording with the same
 * observation, so asking again never starts a second one.
 */
export const START_RETRY_MS = [2_000, 6_000];

/** Send her lesson: the teacher's sendLesson, through the coach's endpoints, for this teacher. */
export function sendObservation(
  args: {
    teacherExtId: string;
    schoolExtId?: string | null;
    audio: { blob: Blob; filename: string };
    /** bd-q261rec — the phone's copy of an in-app recording, so a killed send is picked up again by its id. */
    recordingId?: string | null;
    plan: PlanChoice | null;
    photos: File[];
    /** bd-ra8xu.40 — the class she named on Check and send; absent when it was not asked. */
    lesson?: ObserveLesson | null;
    /** bd-ra8xu.60 — her Observation Notes (Record and Check and send); the start carries them only when there is one. */
    notes?: ObserveNote[] | null;
    /** bd-tymy1n — what already arrived, by file (coachingSend's map): a second send sends only the rest. */
    uploaded?: WeakMap<Blob, string>;
    /** bd-tfya0m — waits before each extra ask of an unanswered start (START_RETRY_MS; tests pass zeros). */
    startRetryMs?: number[];
  } & PieceChoice,
  api: ObserveApi = leader,
  upload: UploadApi = portal,
  onProgress?: (pct: number) => void,
): Promise<{ coachingSessionId: string }> {
  const {
    teacherExtId, schoolExtId, audio, plan, photos, lesson, notes, uploaded, startRetryMs = START_RETRY_MS, piecesOn, onWait, pieceOptions,
    recordingId,
  } = args;
  return sendLesson({
    audio: recordingId ? { ...audio, recordingId } : audio, plan, photos, startRetryMs, ...(uploaded ? { uploaded } : {}),
    ...(piecesOn !== undefined ? { piecesOn } : {}), ...(onWait ? { onWait } : {}), ...(pieceOptions ? { pieceOptions } : {}),
  }, {
    ...(api.observePieces ? { pieces: api.observePieces } : {}),
    presignCoachingUpload: (a) => api.presignObserveUpload(a),
    uploadToR2: (url, blob, type, cb) => upload.uploadToR2(url, blob, type, cb),
    startCoachingUpload: (start) => api.startObservation({
      ...start, teacherExtId, schoolExtId: schoolExtId || null, ...(lesson ? { lesson } : {}), ...(notes && notes.length ? { notes } : {}),
    }),
  }, onProgress);
}

/**
 * Send her talk with the teacher: one audio file to R2, then attach it to the observation. bd-q261rec (queue #261): with
 * portal_upload_pieces on for her, in pieces that resume after a drop (an older server: one PUT, as before).
 */
export async function sendTalk(
  coachingSessionId: string,
  audio: { blob: Blob; filename: string; recordingId?: string | null },
  api: ObserveApi = leader,
  upload: UploadApi = portal,
  onProgress?: (pct: number) => void,
  choice: PieceChoice = {},
): Promise<void> {
  let key: string | null = null;
  const pct = (loaded: number) => onProgress?.(Math.min(100, Math.round((loaded / (audio.blob.size || 1)) * 100)));
  try {
    const pieces = api.observePieces && (choice.piecesOn ?? await uploadPiecesOn()) ? api.observePieces : null;
    if (pieces) {
      try {
        key = await sendInPieces(audio.blob, audio.filename, {
          ...(audio.recordingId ? { identity: `rec:${audio.recordingId}` } : {}),
          ...choice.pieceOptions, api: pieces, onProgress: pct, onWait: choice.onWait,
        });
      } catch (err) {
        if (!(err instanceof PiecesUnavailable)) throw err;
      }
    }
    if (!key) {
      const signed = await api.presignObserveUpload({ filename: audio.filename, sizeBytes: audio.blob.size, kind: "audio" });
      await upload.uploadToR2(signed.uploadUrl, audio.blob, signed.contentType, pct);
      key = signed.key;
    }
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

/**
 * Whose a recording kept on this phone is. bd-ma9jiy: `kind` "dbrf" is a debrief talk (with its `observationId`), never
 * offered as a classroom observation; no kind (saved before this) is an observation, as it always was.
 */
export type UnsentFor = {
  teacherExtId: string; schoolExtId: string | null; teacherName: string;
  kind?: "obs" | "dbrf"; observationId?: string | null; visitId?: string | null;
};

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
