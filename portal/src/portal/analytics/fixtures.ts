/**
 * bd-s6qbts.3 — a GET /api/portal/analytics/schools answer for tests and screenshots. FICTIONAL schools and numbers.
 *
 * Only the per-school rows are written by hand; the region and overview roll-ups are worked out from them the way
 * PLAN v3 §2 says the server does (counts and "x of N" summed, averages pooled as Σ score ÷ Σ n), so the fixture can
 * never disagree with itself.
 */
import type { SchoolsAnalyticsCounts, SchoolsAnalyticsResponse, SchoolsAnalyticsSchool } from '../types/portal';

// The six ICT regions, the only ones the server counts (bd-s6qbts.4): a school outside them is in no row and no total.
export const REGION_ORDER = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'] as const;

type Row = [id: string, emis: string | null, name: string, region: string, teachers: number,
  lpsOpened: number, teachersOpenedLp: number,
  dcObservations: number, teachersWithDc: number, humanObservations: number,
  avgFico: number | null, ficoN: number, avgHitl: number | null, hitlN: number];

const ROWS: Row[] = [
  ['s-01', '84980', 'IMCB (VI-XII) Bhatta Jabbar Khurd', 'B.K', 20, 31, 9, 6, 4, 1, 59.2, 6, 61.0, 1],
  ['s-02', '20594', 'IMCB (VI-XII) Chak Jabbar', 'Sihala', 30, 52, 14, 17, 9, 6, 68.4, 17, 55.5, 6],
  ['s-04', '87434', 'IMCB (VI-XII) Dhok Jabbar', 'Sihala', 29, 0, 0, 0, 0, 0, null, 0, null, 0],
  ['s-05', '52845', 'IMCG (VI-XII) F-10/3', 'Urban-II', 35, 88, 21, 27, 15, 6, 62.3, 27, 45.1, 6],
  ['s-06', '75573', 'IMCB (VI-XII) F-5/3', 'Urban-I', 30, 40, 11, 20, 10, 6, 62.0, 20, 51.2, 6],
  ['s-07', '15364', 'IMSG (I-V) F-6/4', 'Urban-I', 24, 60, 19, 2, 2, 6, 55.0, 2, 55.0, 6],
  ['s-08', '68366', 'IMCG (VI-XII) F-7/2', 'Urban-I', 23, 33, 11, 20, 7, 6, 75.0, 20, 70.3, 6],
  ['s-09', '87772', 'IMSB (I-X) F-7/3', 'Urban-I', 32, 25, 12, 12, 6, 6, 58.1, 12, 52.4, 6],
  ['s-10', '70119', 'IMSB (I-X) F-8/3', 'Urban-II', 26, 7, 3, 7, 3, 5, 67.0, 7, 53.0, 5],
  ['s-11', '46344', 'IMCG (VI-XII) G-6/1', 'Urban-I', 26, 71, 15, 10, 5, 8, 63.2, 10, 51.0, 8],
  ['s-12', '31149', 'IMSB (VI-X) Humak', 'Nilore', 38, 44, 15, 8, 3, 9, 82.0, 8, 73.3, 9],
  ['s-13', '40211', 'IMSG (I-V) Nilore', 'Nilore', 18, 19, 7, 4, 2, 1, 64.5, 4, 60.0, 1],
  ['s-14', '55120', 'IMCB (VI-XII) Tarnol', 'Tarnol', 41, 102, 22, 30, 14, 12, 61.8, 30, 57.7, 12],
  ['s-15', null, 'IMSB (I-VIII) Sangjani', 'Tarnol', 15, 4, 2, 1, 1, 0, 49.0, 1, null, 0],
  ['s-16', '61022', 'IMSG (I-X) Kirpa', 'B.K', 22, 28, 8, 9, 4, 2, 57.4, 9, 48.5, 2],
  ['s-18', '36620', 'IMCG (VI-XII) Sihala', 'Sihala', 33, 57, 16, 15, 8, 3, 66.1, 15, 59.9, 3],
];

export const FIXTURE_SCHOOLS: SchoolsAnalyticsSchool[] = ROWS.map(([schoolId, emis, name, region, teachers,
  lpsOpened, teachersOpenedLp, dcObservations, teachersWithDc, humanObservations,
  avgFico, ficoN, avgHitl, hitlN]) => ({
  schoolId, emis, name, region, teachers, lpsOpened, teachersOpenedLp, dcObservations, teachersWithDc,
  humanObservations, avgFico, ficoN, avgHitl, hitlN,
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
    dcObservations: sum('dcObservations'),
    teachersWithDc: sum('teachersWithDc'),
    humanObservations: sum('humanObservations'),
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
    // Every region, whatever the filter (v3 §3), so the chips always carry their counts.
    regions: REGION_ORDER.map((region) => ({ region, ...rollUp(FIXTURE_SCHOOLS.filter((s) => s.region === region)) })),
    schools: inScope,
  };
}
