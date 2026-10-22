import type { LibraryPick } from '../../lib/coachingSend';
import type { LiveMovesRecord } from '../../services/api';
import type { Audio } from '../../newui/coaching/useSendFlow';

/**
 * bd-fmf24g.4 — what the Digital Coaching page holds: the recording, the lesson plan and the photos she chose.
 * Held in memory (a File cannot ride in the URL) until the lesson is sent: she may leave for the recording page, her
 * lesson plan or the library and come back, and the page must find them as she left them.
 *
 * bd-fmf24g.76 — no class (the WhatsApp flow asks for none), and the RECORDING is part of it: Record opens the recording page
 * (SendPage), which puts the finished recording here and returns to the page; Upload attaches in place. Submit sends
 * exactly what is held (SendPage, start 'submit'); the send page clears it once sent.
 */

export type DraftPlan =
  | { kind: 'library'; pick: LibraryPick; title: string; chips: string[] }
  | { kind: 'file'; file: File; asPhoto: boolean };

/** The class she picked on the one screen (sent as teacherClass); subjectKey when it is one of her own classes. */
export type DraftClass = {
  grade: number; subject: string; subjectKey: string | null;
  /** bd-1p5nkt — the lesson-plan catalogue's key for this class (the library opens it), when known. */
  featureKey?: string | null;
};

/**
 * bd-v0toag.31.3 — `live`: the live moves record (ticks and taps) the recording page puts here at Stop, sent with Submit.
 * Left out, the held one is kept while it still belongs to the same recording and the same lesson.
 */
/**
 * bd-c5reix — her recording from WhatsApp, already kept on our side (GET /coaching-upload/pending): nothing to upload;
 * Submit sends its key. Listened to through its short-lived link.
 */
export type SavedAudio = { kind: 'saved'; key: string; id: string; listenUrl: string | null; durationMs: number | null };
export type DcAudio = Audio | SavedAudio;
export const isSavedAudio = (a: DcAudio | null | undefined): a is SavedAudio => !!a && 'kind' in a && a.kind === 'saved';

export type Draft = { audio: DcAudio | null; plan: DraftPlan | null; photos: File[]; cls?: DraftClass | null; live?: LiveMovesRecord | null };

let held: Draft | null = null;

const belongs = (live: LiveMovesRecord, d: Draft): boolean =>
  !isSavedAudio(d.audio) && d.audio?.recordingId === live.liveId && d.plan?.kind === 'library' && 'lessonId' in d.plan.pick && d.plan.pick.lessonId === live.lessonId;

export function holdDraft(draft: Draft): void {
  const live = draft.live !== undefined ? draft.live : held?.live ?? null;
  held = { ...draft, live: live && belongs(live, draft) ? live : null };
}

export function peekDraft(): Draft | null {
  return held;
}

export function clearDraft(): void {
  held = null;
}

/**
 * What "Start DC observation" on a lesson plan opens the hub with (teacher/lessons/paths dcHref):
 * `?grade=4&subject=science&plan=k5:<lessonId>` or `plan=g612:<segmentId>&lang=en|ur` — the keys the
 * coaching upload takes as { lessonId } | { segmentId, lang }.
 */
export type Prefill = {
  grade: number | null; subjectKey: string | null; plan: string | null; pick: LibraryPick | null;
  /** bd-fgj73x.10 — the plan's subject as the lesson catalogue keys it (lessons pages), or by name (Recent / All). */
  lpSubject: string | null; subjectName: string | null;
};

export function readPrefill(search: string): Prefill {
  const q = new URLSearchParams(search);
  const g = Number(q.get('grade'));
  const grade = Number.isInteger(g) && g >= 1 && g <= 12 ? g : null;
  const subjectKey = (q.get('subject') || '').trim() || null;
  const raw = (q.get('plan') || '').trim();
  let pick: LibraryPick | null = null;
  const k5 = raw.match(/^k5:(.+)$/);
  const g612 = raw.match(/^g612:(.+)$/);
  if (k5) pick = { lessonId: k5[1] };
  else if (g612) pick = { segmentId: g612[1], lang: q.get('lang') === 'ur' ? 'ur' : 'en' };
  const lpSubject = (q.get('lpSubject') || '').trim() || null;
  const subjectName = (q.get('subjectName') || '').trim() || null;
  return { grade, subjectKey, plan: pick ? raw : null, pick, lpSubject, subjectName };
}

/** A pick's key as GET /lesson-plans/recent spells it, to name it from her recent plans. */
export function planKeyOf(pick: LibraryPick): string | null {
  if ('lessonId' in pick) return `k5:${pick.lessonId}`;
  if ('segmentId' in pick) return `g612:${pick.segmentId}`;
  return null;
}
