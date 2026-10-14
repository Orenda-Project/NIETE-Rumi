/**
 * bd-s6qbts.3 — the seven numbers every school, region and the overview carry, in the order the page shows them.
 * bd-wfl8oz: no LPs generated, no coach visits (operator, 2026-10-13 — human observations are the visits).
 * bd-9vkl9x: training modules completed, beside LPs opened — the two things teachers do on their own.
 */
export type MetricKey =
  | 'teachers' | 'lpsOpened' | 'trainingModules' | 'dcObservations' | 'humanObservations' | 'avgFico' | 'avgHitl';

export const METRIC_KEYS: readonly MetricKey[] = [
  'teachers', 'lpsOpened', 'trainingModules', 'dcObservations', 'humanObservations', 'avgFico', 'avgHitl',
];

/** bd-97x22y.2 — a column of a sector's school table: one of the seven, or the Coaching tab's coach visits. */
export type ColumnKey = MetricKey | 'coachVisits';

/** The two scores: the only numbers shown as % (operator, 2026-10-14). */
export const SCORE_KEYS = ['avgFico', 'avgHitl'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export const isScoreKey = (k: string): k is ScoreKey => (SCORE_KEYS as readonly string[]).includes(k);
