/**
 * bd-s6qbts.3 — a GET /api/portal/analytics/schools answer for tests and screenshots. FICTIONAL schools and numbers.
 *
 * Only the per-school rows are written by hand; the region and overview roll-ups are worked out from them the way
 * PLAN v3 §2 says the server does (counts and "x of N" summed, averages pooled as Σ score ÷ Σ n), so the fixture can
 * never disagree with itself.
 */
import type { SchoolsAnalyticsCounts, SchoolsAnalyticsResponse, SchoolsAnalyticsSchool } from '../types/portal';

export const REGION_ORDER = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol', 'Unassigned'] as const;

type Row = [id: string, emis: string | null, name: string, region: string, teachers: number,
  lpsOpened: number, teachersOpenedLp: number, lpsGenerated: number,
  dcObservations: number, teachersWithDc: number, humanObservations: number, coachVisits: number,
  avgFico: number | null, ficoN: number, avgHitl: number | null, hitlN: number];

const ROWS: Row[] = [
  ['s-01', '84980', 'IMCB (VI-XII) Bhatta Jabbar Khurd', 'B.K', 20, 31, 9, 44, 6, 4, 1, 2, 59.2, 6, 61.0, 1],
  ['s-02', '20594', 'IMCB (VI-XII) Chak Jabbar', 'Sihala', 30, 52, 14, 71, 17, 9, 6, 3, 68.4, 17, 55.5, 6],
  ['s-03', '86871', 'IMSG (I-V) Chak Jalal Kalan', 'Unassigned', 27, 12, 5, 20, 3, 2, 0, 0, 71.0, 3, null, 0],
  ['s-04', '87434', 'IMCB (VI-XII) Dhok Jabbar', 'Sihala', 29, 0, 0, 0, 0, 0, 0, 0, null, 0, null, 0],
  ['s-05', '52845', 'IMCG (VI-XII) F-10/3', 'Urban-II', 35, 88, 21, 120, 27, 15, 6, 4, 62.3, 27, 45.1, 6],
  ['s-06', '75573', 'IMCB (VI-XII) F-5/3', 'Urban-I', 30, 40, 11, 55, 20, 10, 6, 2, 62.0, 20, 51.2, 6],
  ['s-07', '15364', 'IMSG (I-V) F-6/4', 'Urban-I', 24, 60, 19, 90, 2, 2, 6, 1, 55.0, 2, 55.0, 6],
  ['s-08', '68366', 'IMCG (VI-XII) F-7/2', 'Urban-I', 23, 33, 11, 48, 20, 7, 6, 3, 75.0, 20, 70.3, 6],
  ['s-09', '87772', 'IMSB (I-X) F-7/3', 'Urban-I', 32, 25, 12, 30, 12, 6, 6, 2, 58.1, 12, 52.4, 6],
  ['s-10', '70119', 'IMSB (I-X) F-8/3', 'Urban-II', 26, 7, 3, 9, 7, 3, 5, 1, 67.0, 7, 53.0, 5],
  ['s-11', '46344', 'IMCG (VI-XII) G-6/1', 'Urban-I', 26, 71, 15, 102, 10, 5, 8, 4, 63.2, 10, 51.0, 8],
  ['s-12', '31149', 'IMSB (VI-X) Humak', 'Nilore', 38, 44, 15, 60, 8, 3, 9, 2, 82.0, 8, 73.3, 9],
  ['s-13', '40211', 'IMSG (I-V) Nilore', 'Nilore', 18, 19, 7, 25, 4, 2, 1, 0, 64.5, 4, 60.0, 1],
  ['s-14', '55120', 'IMCB (VI-XII) Tarnol', 'Tarnol', 41, 102, 22, 140, 30, 14, 12, 5, 61.8, 30, 57.7, 12],
  ['s-15', '55188', 'IMSB (I-VIII) Sangjani', 'Tarnol', 15, 4, 2, 6, 1, 1, 0, 0, 49.0, 1, null, 0],
  ['s-16', '61022', 'IMSG (I-X) Kirpa', 'B.K', 22, 28, 8, 33, 9, 4, 2, 1, 57.4, 9, 48.5, 2],
  ['s-17', null, 'Durbeen', 'Unassigned', 11, 6, 2, 7, 4, 3, 4, 0, 48.0, 4, 44.0, 4],
  ['s-18', '36620', 'IMCG (VI-XII) Sihala', 'Sihala', 33, 57, 16, 80, 15, 8, 3, 2, 66.1, 15, 59.9, 3],
];

export const FIXTURE_SCHOOLS: SchoolsAnalyticsSchool[] = ROWS.map(([schoolId, emis, name, region, teachers,
  lpsOpened, teachersOpenedLp, lpsGenerated, dcObservations, teachersWithDc, humanObservations, coachVisits,
  avgFico, ficoN, avgHitl, hitlN]) => ({
  schoolId, emis, name, region, teachers, lpsOpened, teachersOpenedLp, lpsGenerated, dcObservations, teachersWithDc,
  humanObservations, coachVisits, avgFico, ficoN, avgHitl, hitlN,
}));

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Counts and "x of N" summed; averages pooled (Σ score ÷ Σ n), null when no score at all. */
export function rollUp(schools: SchoolsAnalyticsSchool[]): SchoolsAnalyticsCounts & { schools: number } {
  const sum = (k: keyof SchoolsAnalyticsCounts) => schools.reduce((t, s) => t + ((s[k] as number | null) ?? 0), 0);
  const ficoN = sum('ficoN');
  const hitlN = sum('hitlN');
  const ficoTotal = schools.reduce((t, s) => t + (s.avgFico ?? 0) * s.ficoN, 0);
  const hitlTotal = schools.reduce((t, s) => t + (s.avgHitl ?? 0) * s.hitlN, 0);
  return {
    schools: schools.length,
    teachers: sum('teachers'),
    lpsOpened: sum('lpsOpened'),
    teachersOpenedLp: sum('teachersOpenedLp'),
    lpsGenerated: sum('lpsGenerated'),
    dcObservations: sum('dcObservations'),
    teachersWithDc: sum('teachersWithDc'),
    humanObservations: sum('humanObservations'),
    coachVisits: sum('coachVisits'),
    avgFico: ficoN ? round1(ficoTotal / ficoN) : null,
    ficoN,
    avgHitl: hitlN ? round1(hitlTotal / hitlN) : null,
    hitlN,
  };
}

/** The answer for one window and region filter ('all' or a region name), shaped as the server sends it. */
export function fixtureResponse(opts: { from?: string | null; to?: string | null; region?: string | null } = {}): SchoolsAnalyticsResponse {
  const wanted = opts.region && opts.region.toLowerCase() !== 'all' ? opts.region.toLowerCase() : null;
  const inScope = wanted ? FIXTURE_SCHOOLS.filter((s) => s.region.toLowerCase() === wanted) : FIXTURE_SCHOOLS;
  return {
    success: true,
    range: { from: opts.from ?? null, to: opts.to ?? null },
    lpOpensLoggedSince: '2026-10-04',
    overview: rollUp(inScope),
    // Every bucket, whatever the filter (v3 §3), so the chips always carry their counts.
    regions: REGION_ORDER.map((region) => ({ region, ...rollUp(FIXTURE_SCHOOLS.filter((s) => s.region === region)) })),
    schools: inScope,
  };
}
