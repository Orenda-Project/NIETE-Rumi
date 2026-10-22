import { featurePath } from '../paths';

/**
 * bd-fmf24g.3 — where the teacher v2 Lesson Plans pages live. Every inner page stands on its address
 * (grade, subject, chapter… in the query), so Back and a reload land where she was — the same rule
 * as today's Lesson Plans (newui/lessons/shared.ts pageUrl).
 *
 *   subject   the lesson-plan catalogue's own key: a grades 1–5 subject_key ("math"), a grades 6–12
 *             corpus name ("Physics") — what lessonPlansApi wants back
 *   key       the one subject key across features ("maths"; GET /me/grade-subjects subjectKey), when
 *             known: Start DC observation passes it on
 */

export const LESSONS_HOME = featurePath('lessons');
/** bd-fgj73x — step 1 of 3 of a new lesson plan: Grade and subject (then Chapter, then Lesson). */
export const LESSONS_NEW = `${LESSONS_HOME}/new`;
export const LESSONS_VIEWER = `${LESSONS_HOME}/plan`;
export const LESSONS_ALL = `${LESSONS_HOME}/all`;
/** Reopen a plan by its key (Recent, All lesson plans): `?plan=k5:<id>|g612:<segment>&lang=&title=&grade=`. */
export const LESSONS_OPEN = `${LESSONS_HOME}/open`;

/**
 * bd-4joiqz — THE way back to the lesson plans, for every page that sends someone there (an FLN list's Back, an FLN
 * plan's "not available", "This lesson isn't available"): the Lesson Plans page, or its step 1 (`'new'`, where the
 * Reading Hour & Numeracy band is). One answer for a teacher and a leader alike: a teacher's Lesson Plans and a
 * leader's Lesson Plans tab are the same page, which TeacherGate opens to the leader family (routes.tsx `leaders`),
 * so no target has to ask who is reading — and none can send a leader to a page that turns them away.
 */
export function lessonsBack(to: 'home' | 'new' = 'home'): string {
  return to === 'new' ? LESSONS_NEW : LESSONS_HOME;
}

export type LessonsView = 'chapters' | 'lessons' | 'preparing';

export type LessonsAt = {
  grade: number;
  subject: string;
  key?: string | null;
  chapter?: string;
  lesson?: string;
  render?: string;
  /** A plan's title, when the page cannot look it up (Preparing reached from Recent). */
  title?: string;
  /** `dc`: Digital Coaching's From the library (bd-fgj73x.5): the pages CHOOSE a plan for her lesson. */
  pick?: string;
};

export function lessonsUrl(view: LessonsView, at: LessonsAt): string {
  const q = new URLSearchParams({ grade: String(at.grade), subject: at.subject });
  if (at.key) q.set('key', at.key);
  if (at.chapter) q.set('chapter', at.chapter);
  if (at.lesson) q.set('lesson', at.lesson);
  if (at.render) q.set('render', at.render);
  if (at.title) q.set('title', at.title);
  if (at.pick) q.set('pick', at.pick);
  return `${LESSONS_HOME}/${view}?${q.toString()}`;
}

/** The page's address, or null when it does not name a grade (1–12) and a subject. */
export function readAt(search: string): LessonsAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || !subject) return null;
  const at: LessonsAt = { grade, subject };
  for (const k of ['key', 'chapter', 'lesson', 'render', 'title', 'pick'] as const) {
    const v = q.get(k);
    if (v) at[k] = v;
  }
  return at;
}

/**
 * What Start DC observation prefills on Digital Coaching: her grade and subject, and THIS plan —
 * `k5:<lesson_id>` or `g612:<segment_id>` with its language, the keys GET /lesson-plans/recent uses
 * and the coaching upload takes ({ lessonId } | { segmentId, lang }).
 */
export type DcPrefill = {
  grade: number | null; subjectKey: string | null; plan: string | null; lang: string | null;
  /** bd-fgj73x.10 — so DC picks the plan's class even when it is not hers: the catalogue's subject key, or its name. */
  lpSubject?: string | null; subjectName?: string | null;
};

export function dcHref(base: string, dc: DcPrefill | null | undefined): string {
  if (!dc) return base;
  const q = new URLSearchParams();
  if (dc.grade != null) q.set('grade', String(dc.grade));
  if (dc.subjectKey) q.set('subject', dc.subjectKey);
  if (dc.plan) q.set('plan', dc.plan);
  if (dc.plan && dc.plan.startsWith('g612:') && dc.lang) q.set('lang', dc.lang);
  if (dc.lpSubject) q.set('lpSubject', dc.lpSubject);
  if (dc.subjectName) q.set('subjectName', dc.subjectName);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** A plan to reopen by its key, with what the viewer and Start DC need. */
export type PlanRef = {
  plan: string; lang?: string | null; title?: string | null; grade?: number | null;
  /** `dc`: opened from Digital Coaching's attached plan, to read it (no Start DC on it). */
  from?: 'dc';
  /** bd-fgj73x.10 — the plan's subject name (Recent / All lesson plans), carried on to Start DC observation. */
  subject?: string | null;
};

/**
 * bd-fgj73x.10 — a plan link already built by openUrl, with the plan's subject name added (openUrl's `subject`). The
 * Recent and All lesson plans rows add it this way, after the row is built, so their `to:` lines stay exactly as on
 * `main` (the FLN link): a change beside those lines would conflict on every promotion.
 */
export function withSubject(url: string | undefined, subject: string | null | undefined): string | undefined {
  if (!url || !subject) return url;
  const [path, query = ''] = url.split('?');
  const q = new URLSearchParams(query);
  q.set('subject', subject);
  return `${path}?${q.toString()}`;
}

export function openUrl(ref: PlanRef): string {
  const q = new URLSearchParams({ plan: ref.plan });
  if (ref.lang && ref.plan.startsWith('g612:')) q.set('lang', ref.lang);
  if (ref.title) q.set('title', ref.title);
  if (ref.grade != null) q.set('grade', String(ref.grade));
  if (ref.from) q.set('from', ref.from);
  if (ref.subject) q.set('subject', ref.subject);
  return `${LESSONS_OPEN}?${q.toString()}`;
}
