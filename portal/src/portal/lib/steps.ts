import type { StepsTeacherRow } from '../types/portal';

/**
 * Shared by the principal's STEPS home and a teacher's own STEPS row, so the
 * two can never word the same fact two ways.
 */

export const REMARKS_URL = '/portal/leader/school-analytics#remarks';

/** The five steps, in the order the pages link to each other. */
export const STEPS_JOURNEY = [
  { n: 1, to: '/portal/leader', label: 'Your school at a glance' },
  { n: 2, to: '/portal/leader/teachers', label: 'Pick a teacher' },
  { n: 3, to: '/portal/leader/lessons', label: 'Review lessons', letters: 'S · T · E' },
  { n: 4, to: '/portal/leader/attendance', label: 'Check presence', letters: 'P' },
  { n: 5, to: REMARKS_URL, label: 'Give your remark', letters: 'S' },
] as const;


/** Presence in words — deliberately not a band (NIETE has no single P score). */
export function presenceWords(p: StepsTeacherRow['presence']): string {
  if (p.markedDays === 0) return p.leave > 0 ? `On leave · ${p.leave} day${p.leave === 1 ? '' : 's'}` : 'Not marked yet';
  return `${p.present} of ${p.markedDays} days`;
}

export const REMARK_WORDS = { done: 'Done', todo: 'To do', no_cycle: 'No open cycle' } as const;

