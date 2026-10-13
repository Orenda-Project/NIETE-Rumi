/** bd-s6qbts.3 — the eight numbers every school, region and the overview carry, in the order the page shows them. */
export type MetricKey =
  | 'teachers' | 'lpsOpened' | 'lpsGenerated' | 'dcObservations' | 'humanObservations' | 'coachVisits' | 'avgFico' | 'avgHitl';

export const METRIC_KEYS: readonly MetricKey[] = [
  'teachers', 'lpsOpened', 'lpsGenerated', 'dcObservations', 'humanObservations', 'coachVisits', 'avgFico', 'avgHitl',
];
