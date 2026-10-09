import type { CoachTeacher } from '../types';
import type { KpiItem, ChipTone } from '../../teacher/ui';
import { scoreBandFor, type BandKey } from '../../lib/scoreBands';
import { ANALYTICS_V2_COPY, type AnalyticsCopy } from '../../teacher/analytics/copy';

/**
 * bd-fmf24g.27 — the coach's Analytics numbers, from what the coach API already serves (GET /coach/people and
 * /coach/teacher/:ext, both scoped to HER teachers on the server). They are LIFETIME counts: there is no date range
 * for a coach, so the page has no range bar and no change pill. A tile with no number is left out.
 */

const sum = (xs: ReadonlyArray<number | null | undefined>) => xs.reduce<number>((n, x) => n + (typeof x === 'number' ? x : 0), 0);

/** Coach Observations, Digital Coaching, Courses done, Assessments over these teachers. */
export function coachKpis(teachers: readonly CoachTeacher[], C: AnalyticsCopy = ANALYTICS_V2_COPY): KpiItem[] {
  return [
    { value: sum(teachers.map((t) => t.hitl)), label: C.observations, feature: 'observations' },
    { value: sum(teachers.map((t) => t.dc)), label: C.digitalCoaching, feature: 'coaching' },
    { value: sum(teachers.map((t) => t.trainingModules)), label: C.modulesDone, feature: 'training' },
    { value: sum(teachers.map((t) => t.examsGenerated)), label: C.papersMade, feature: 'assessment' },
  ];
}

/** One teacher's tiles; a count the API does not give her (lpOpened null: not on the app) is left out. */
export function oneTeacherKpis(t: CoachTeacher, C: AnalyticsCopy = ANALYTICS_V2_COPY): KpiItem[] {
  const items: Array<KpiItem | null> = [
    typeof t.lpOpened === 'number' ? { value: t.lpOpened, label: C.lessonPlansUsed, feature: 'lessons' } : null,
    typeof t.trainingModules === 'number' ? { value: t.trainingModules, label: C.modulesDone, feature: 'training' } : null,
    typeof t.examsGenerated === 'number' ? { value: t.examsGenerated, label: C.papersMade, feature: 'assessment' } : null,
    { value: t.hitl, label: C.observations, feature: 'observations' },
    { value: t.dc, label: C.digitalCoaching, feature: 'coaching' },
  ];
  return items.filter((i): i is KpiItem => i !== null);
}

const TONE: Record<BandKey, ChipTone> = { excellent: 'done', good: 'done', average: 'info', below_average: 'waiting', needs_support: 'waiting' };

/** Her average Observation rating as a band chip (never a number); none when she has no rated observation. */
export function ratingChip(avg: number | null | undefined, C: AnalyticsCopy = ANALYTICS_V2_COPY): { text: string; tone: ChipTone } | null {
  const key = scoreBandFor(avg);
  return key ? { text: C.bands[key], tone: TONE[key] } : null;
}

export const teacherPathOf = (ext: string) => `/portal/coach/analytics/teacher/${encodeURIComponent(ext)}`;

/** Teachers of the chosen school (all when `school` is ''), by name. */
export function visibleTeachers(teachers: readonly CoachTeacher[], school: string): CoachTeacher[] {
  return teachers
    .filter((t) => !t.isPrincipal && t.teacherExtId && (!school || (t.schoolExtId || t.schoolName || '') === school))
    .sort((a, b) => a.name.localeCompare(b.name));
}
