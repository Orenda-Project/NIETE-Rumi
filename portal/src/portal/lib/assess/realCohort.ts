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
    });
  }
  return out;
}
