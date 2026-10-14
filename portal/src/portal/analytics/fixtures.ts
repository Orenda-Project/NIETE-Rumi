/**
 * bd-s6qbts.3 — a GET /api/portal/analytics/schools answer for tests and screenshots. FICTIONAL schools and numbers.
 *
 * Only the per-school rows are written by hand; the region and overview roll-ups are worked out from them the way
 * PLAN v3 §2 says the server does (counts and "x of N" summed, averages pooled as Σ score ÷ Σ n), so the fixture can
 * never disagree with itself.
 */
import type {
  CoachingAnalyticsCounts, CoachingAnalyticsResponse, CoachingAnalyticsSchool,
  SchoolsAnalyticsCounts, SchoolsAnalyticsResponse, SchoolsAnalyticsSchool,
} from '../types/portal';

// The six ICT regions, the only ones the server counts (bd-s6qbts.4): a school outside them is in no row and no total.
export const REGION_ORDER = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'] as const;

type Row = [id: string, emis: string | null, name: string, region: string, teachers: number,
  lpsOpened: number, teachersOpenedLp: number, trainingModules: number, teachersTrained: number,
  dcObservations: number, teachersWithDc: number, humanObservations: number,
  avgFico: number | null, ficoN: number, avgHitl: number | null, hitlN: number];

const ROWS: Row[] = [
  ['s-01', '84980', 'IMCB (VI-XII) Bhatta Jabbar Khurd', 'B.K', 20, 31, 9, 14, 6, 6, 4, 1, 59.2, 6, 61.0, 1],
  ['s-02', '20594', 'IMCB (VI-XII) Chak Jabbar', 'Sihala', 30, 52, 14, 23, 11, 17, 9, 6, 68.4, 17, 55.5, 6],
  ['s-04', '87434', 'IMCB (VI-XII) Dhok Jabbar', 'Sihala', 29, 0, 0, 0, 0, 0, 0, 0, null, 0, null, 0],
  ['s-05', '52845', 'IMCG (VI-XII) F-10/3', 'Urban-II', 35, 88, 21, 41, 17, 27, 15, 6, 62.3, 27, 45.1, 6],
  ['s-06', '75573', 'IMCB (VI-XII) F-5/3', 'Urban-I', 30, 40, 11, 18, 9, 20, 10, 6, 62.0, 20, 51.2, 6],
  ['s-07', '15364', 'IMSG (I-V) F-6/4', 'Urban-I', 24, 60, 19, 9, 5, 2, 2, 6, 55.0, 2, 55.0, 6],
  ['s-08', '68366', 'IMCG (VI-XII) F-7/2', 'Urban-I', 23, 33, 11, 26, 12, 20, 7, 6, 75.0, 20, 70.3, 6],
  ['s-09', '87772', 'IMSB (I-X) F-7/3', 'Urban-I', 32, 25, 12, 11, 6, 12, 6, 6, 58.1, 12, 52.4, 6],
  ['s-10', '70119', 'IMSB (I-X) F-8/3', 'Urban-II', 26, 7, 3, 3, 2, 7, 3, 5, 67.0, 7, 53.0, 5],
  ['s-11', '46344', 'IMCG (VI-XII) G-6/1', 'Urban-I', 26, 71, 15, 30, 13, 10, 5, 8, 63.2, 10, 51.0, 8],
  ['s-12', '31149', 'IMSB (VI-X) Humak', 'Nilore', 38, 44, 15, 47, 20, 8, 3, 9, 82.0, 8, 73.3, 9],
  ['s-13', '40211', 'IMSG (I-V) Nilore', 'Nilore', 18, 19, 7, 6, 3, 4, 2, 1, 64.5, 4, 60.0, 1],
  ['s-14', '55120', 'IMCB (VI-XII) Tarnol', 'Tarnol', 41, 102, 22, 52, 19, 30, 14, 12, 61.8, 30, 57.7, 12],
  ['s-15', null, 'IMSB (I-VIII) Sangjani', 'Tarnol', 15, 4, 2, 2, 1, 1, 1, 0, 49.0, 1, null, 0],
  ['s-16', '61022', 'IMSG (I-X) Kirpa', 'B.K', 22, 28, 8, 12, 7, 9, 4, 2, 57.4, 9, 48.5, 2],
  ['s-18', '36620', 'IMCG (VI-XII) Sihala', 'Sihala', 33, 57, 16, 28, 14, 15, 8, 3, 66.1, 15, 59.9, 3],
];

export const FIXTURE_SCHOOLS: SchoolsAnalyticsSchool[] = ROWS.map(([schoolId, emis, name, region, teachers,
  lpsOpened, teachersOpenedLp, trainingModules, teachersTrained, dcObservations, teachersWithDc, humanObservations,
  avgFico, ficoN, avgHitl, hitlN]) => ({
  schoolId, emis, name, region, teachers, lpsOpened, teachersOpenedLp, trainingModules, teachersTrained,
  dcObservations, teachersWithDc, humanObservations, avgFico, ficoN, avgHitl, hitlN,
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
    trainingModules: sum('trainingModules'),
    teachersTrained: sum('teachersTrained'),
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

/**
 * bd-97x22y.2 — a GET /api/portal/analytics/coaching answer (PLAN v6 §3), FICTIONAL, for the same schools.
 *
 * Coach visits are written per school; coaches by the regions their schools are in. A coach covering two regions
 * counts in both region cards and once in the overview, as the server counts them (coaches are not window-dependent).
 */
const VISITS: Record<string, number> = {
  's-01': 4, 's-16': 2, 's-02': 6, 's-04': 0, 's-18': 3, 's-05': 5, 's-10': 1, 's-06': 3,
  's-07': 0, 's-08': 4, 's-09': 2, 's-11': 1, 's-12': 3, 's-13': 0, 's-14': 7, 's-15': 1,
};

const COACHES: Array<{ id: string; regions: string[] }> = [
  { id: 'c-1', regions: ['B.K'] },
  { id: 'c-2', regions: ['B.K', 'Sihala'] },
  { id: 'c-3', regions: ['Sihala'] },
  { id: 'c-4', regions: ['Urban-I'] },
  { id: 'c-5', regions: ['Urban-I'] },
  { id: 'c-6', regions: ['Urban-I', 'Urban-II'] },
  { id: 'c-7', regions: ['Nilore'] },
  { id: 'c-8', regions: ['Tarnol'] },
  { id: 'c-9', regions: ['Tarnol'] },
];

export const FIXTURE_COACHING_SCHOOLS: CoachingAnalyticsSchool[] = FIXTURE_SCHOOLS.map(({ schoolId, emis, name, region }) => ({
  schoolId, emis, name, region, coachVisits: VISITS[schoolId] ?? 0,
}));

function coachingRollUp(regions: readonly string[]): CoachingAnalyticsCounts {
  const wanted = new Set(regions.map((r) => r.toLowerCase()));
  const schools = FIXTURE_COACHING_SCHOOLS.filter((s) => wanted.has(s.region.toLowerCase()));
  return {
    coaches: COACHES.filter((c) => c.regions.some((r) => wanted.has(r.toLowerCase()))).length,
    coachVisits: schools.reduce((t, s) => t + s.coachVisits, 0),
    schoolsVisited: schools.filter((s) => s.coachVisits > 0).length,
  };
}

/** The coaching answer for one window and region filter ('all' or a region name), shaped as the server sends it. */
export function fixtureCoaching(opts: { from?: string | null; to?: string | null; region?: string | null } = {}): CoachingAnalyticsResponse {
  const wanted = opts.region && opts.region.toLowerCase() !== 'all' ? opts.region.toLowerCase() : null;
  const scope = wanted ? REGION_ORDER.filter((r) => r.toLowerCase() === wanted) : [...REGION_ORDER];
  return {
    success: true,
    range: { from: opts.from ?? null, to: opts.to ?? null },
    overview: coachingRollUp(scope),
    regions: REGION_ORDER.map((region) => ({ region, ...coachingRollUp([region]) })),
    schools: FIXTURE_COACHING_SCHOOLS.filter((s) => !wanted || s.region.toLowerCase() === wanted),
  };
}
