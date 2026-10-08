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
export const LESSONS_VIEWER = `${LESSONS_HOME}/plan`;
export const LESSONS_ALL = `${LESSONS_HOME}/all`;

export type LessonsView = 'chapters' | 'lessons' | 'preparing';

export type LessonsAt = {
  grade: number;
  subject: string;
  key?: string | null;
  chapter?: string;
  lesson?: string;
  render?: string;
};

export function lessonsUrl(view: LessonsView, at: LessonsAt): string {
  const q = new URLSearchParams({ grade: String(at.grade), subject: at.subject });
  if (at.key) q.set('key', at.key);
  if (at.chapter) q.set('chapter', at.chapter);
  if (at.lesson) q.set('lesson', at.lesson);
  if (at.render) q.set('render', at.render);
  return `${LESSONS_HOME}/${view}?${q.toString()}`;
}

/** The page's address, or null when it does not name a grade (1–12) and a subject. */
export function readAt(search: string): LessonsAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || !subject) return null;
  const at: LessonsAt = { grade, subject };
  for (const k of ['key', 'chapter', 'lesson', 'render'] as const) {
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
export type DcPrefill = { grade: number | null; subjectKey: string | null; plan: string | null; lang: string | null };

export function dcHref(base: string, dc: DcPrefill | null | undefined): string {
  if (!dc) return base;
  const q = new URLSearchParams();
  if (dc.grade != null) q.set('grade', String(dc.grade));
  if (dc.subjectKey) q.set('subject', dc.subjectKey);
  if (dc.plan) q.set('plan', dc.plan);
  if (dc.plan && dc.plan.startsWith('g612:') && dc.lang) q.set('lang', dc.lang);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
