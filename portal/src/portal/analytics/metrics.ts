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
