import type { SaDashboardSession } from '../../types/childTestSa';
import type { DashStudent } from './exampleCohort';

/**
 * The results dashboard on real sessions (switch sa_real_dashboard): each session the server returns becomes a
 * dashboard student, so the example's numbers code runs unchanged. The roster has no gender, so it is null; a school
 * with no sub-region groups under NO_SECTOR. No names reach this page.
 *
 * Small groups are masked: a cell of 1–4 children shows "<5" and no numbers, so one child cannot be read off a row.
 */

export const NO_SECTOR = '(none)';
export const MIN_CELL = 5;

export function masked(n: number): boolean {
  return n > 0 && n < MIN_CELL;
}

const GRADES = [1, 2, 3, 4, 5] as const;

/** How many sessions have a recording where the scorer heard another voice (their scores may include help). */
export function secondVoiceCount(students: DashStudent[]): number {
  return (students || []).filter((s) => s.results.tasks.some((t) => t.secondVoice === true)).length;
}

export function toDashStudents(sessions: SaDashboardSession[]): DashStudent[] {
  const out: DashStudent[] = [];
  for (const s of sessions || []) {
    const grade = GRADES.find((g) => g === s.grade);
    if (!grade) continue;
    const schoolId = s.schoolId || '';
    out.push({
      id: s.results.session.id,
      sector: s.sector || NO_SECTOR,
      schoolId,
      schoolName: s.schoolName || schoolId,
      grade,
      gender: null,
      results: s.results,
      // sa_dash_filters (round 7b): present only when the server sends them
      ...(s.mode ? { mode: s.mode } : {}),
      ...(s.coachId !== undefined ? { coachId: s.coachId ?? null, coachName: s.coachName ?? null } : {}),
      ...(s.startedAt !== undefined ? { startedAt: s.startedAt ?? null } : {}),
      ...(Array.isArray(s.stops) ? { stops: s.stops } : {}),
      ...(s.origin !== undefined ? { origin: s.origin ?? null } : {}),
    });
  }
  return out;
}

const PKT_MS = 5 * 60 * 60 * 1000;

/** The Pakistan day (YYYY-MM-DD) of an ISO time; '' when there is none. Pakistan is UTC+5 all year. */
export function pktDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t + PKT_MS).toISOString().slice(0, 10) : '';
}

/** "DD/MM HH:MM" in Pakistan time; '' when there is none. */
export function pktWhen(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + PKT_MS).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
}
