import type { LibraryPick } from '../../lib/coachingSend';

/**
 * bd-fmf24g.4 — what the hub hands to the send page: her class, the lesson plan and the photos she chose.
 * Held in memory (a File cannot ride in the URL) until the lesson is sent: she may leave the recording to
 * open her lesson plan and come back by the recording bar, and the send page must still have them. The
 * hub replaces it on every Start; the send page clears it once sent. The recording itself goes the way
 * it always has (useSendFlow: the recording session, or lessonHandoff for an uploaded file).
 */
export type Combo = { grade: number; subject: string };

export type DraftPlan =
  | { kind: 'library'; pick: LibraryPick; title: string; chips: string[] }
  | { kind: 'file'; file: File; asPhoto: boolean };

export type Draft = { combo: Combo | null; plan: DraftPlan | null; photos: File[] };

let held: Draft | null = null;

export function holdDraft(draft: Draft): void {
  held = draft;
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
export type Prefill = { grade: number | null; subjectKey: string | null; plan: string | null; pick: LibraryPick | null };

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
  return { grade, subjectKey, plan: pick ? raw : null, pick };
}

/** A pick's key as GET /lesson-plans/recent spells it, to name it from her recent plans. */
export function planKeyOf(pick: LibraryPick): string | null {
  if ('lessonId' in pick) return `k5:${pick.lessonId}`;
  if ('segmentId' in pick) return `g612:${pick.segmentId}`;
  return null;
}
