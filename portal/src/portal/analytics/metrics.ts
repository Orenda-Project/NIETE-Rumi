/**
 * bd-s6qbts.3 — the six numbers every school, region and the overview carry, in the order the page shows them.
 * bd-wfl8oz: no LPs generated, no coach visits (operator, 2026-10-13 — human observations are the visits).
 */
export type MetricKey =
  | 'teachers' | 'lpsOpened' | 'dcObservations' | 'humanObservations' | 'avgFico' | 'avgHitl';

export const METRIC_KEYS: readonly MetricKey[] = [
  'teachers', 'lpsOpened', 'dcObservations', 'humanObservations', 'avgFico', 'avgHitl',
];
