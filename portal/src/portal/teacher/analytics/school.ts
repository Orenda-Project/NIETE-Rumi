import type { LeaderPatchTeacher, SchoolAnalyticsResponse } from '../../types/portal';
import type { KpiItem } from '../ui';
import { ANALYTICS_V2_COPY, type AnalyticsCopy } from './copy';
import { ANALYTICS_HOME } from './paths';

/**
 * bd-fmf24g.27 — what the principal's views show, from the answers the server already has:
 * GET /leader/school-analytics (her OWN school, read from her session on the server; `?teacherId=` is checked
 * against that school) and GET /leader/teachers (the same school's roster, with lifetime counts).
 *
 * A number the server does not give at school scope is left OUT of the page (never "—", never faded): courses done
 * and attendance days (the progress service takes one user id; no route serves a school or another teacher).
 */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function tile(value: unknown, before: unknown, label: string, hasBefore: boolean, feature: KpiItem['feature']): KpiItem | null {
  const v = num(value);
  if (v === null) return null;
  const out: KpiItem = { value: v, label, feature };
  const b = num(before);
  if (hasBefore && b !== null) out.delta = v - b;
  return out;
}

/** Lesson Plans (made), Assessments (papers made), Coach Observations, Digital Coaching; each with its change against `prev`. */
export function schoolKpis(cur: SchoolAnalyticsResponse, prev: SchoolAnalyticsResponse | null, C: AnalyticsCopy = ANALYTICS_V2_COPY): KpiItem[] {
  const has = prev !== null;
  return [
    tile(cur.school?.totalLessonPlans, prev?.school?.totalLessonPlans, C.lessonPlansUsed, has, 'lessons'),
    tile(cur.school?.totalExams, prev?.school?.totalExams, C.papersMade, has, 'assessment'),
    tile(cur.analytics?.humanObservations, prev?.analytics?.humanObservations, C.observations, has, 'observations'),
    tile(cur.analytics?.digitalCoachObservations, prev?.analytics?.digitalCoachObservations, C.digitalCoaching, has, 'coaching'),
  ].filter((t): t is KpiItem => t !== null);
}

export type TeacherRow = { id: string; name: string; extra: string; to: string };

/** Her school's teachers (not herself, not another principal), by name; a row opens that teacher's analytics. */
export function teacherRows(
  teachers: ReadonlyArray<LeaderPatchTeacher & { isPrincipal?: boolean }> | null | undefined,
  C: AnalyticsCopy = ANALYTICS_V2_COPY,
): TeacherRow[] {
  return (teachers ?? [])
    .filter((t) => t.rumiUserId && t.onRumi && !t.isPrincipal)
    .map((t) => ({
      id: t.rumiUserId as string,
      name: (t.name ?? '').trim(),
      extra: C.teacherCounts(t.observations || 0, t.coachingSessions || 0),
      to: oneTeacherPath(t.rumiUserId as string),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const oneTeacherPath = (id: string) => `${ANALYTICS_HOME}/teacher/${encodeURIComponent(id)}`;
