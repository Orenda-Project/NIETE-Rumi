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
  ObservationsAnalyticsResponse, ObservationsCounts, ObservationsKind, ObservationsSchool,
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
    regions: REGION_ORDER.map((region) => ({ region, ...coachingRollUp([region]), ...coachingV7(region) })),
    schools: FIXTURE_COACHING_SCHOOLS.filter((s) => !wanted || s.region.toLowerCase() === wanted),
  };
}

/**
 * bd-97x22y.5 — the v7 coaching region fields (her Coaching tab): how many schools are in the region and its coaches'
 * names, A to Z. FICTIONAL names, one per fixture coach (COACHES above); a coach in two regions is listed in both.
 */
const COACH_NAMES: Record<string, string> = {
  'c-1': 'Ayesha Noor', 'c-2': 'Bilal Ahmed', 'c-3': 'Hina Tariq', 'c-4': 'Sadia Rauf', 'c-5': 'Kamran Ali',
  'c-6': 'Mariam Iqbal', 'c-7': 'Usman Ghani', 'c-8': 'Farah Naz', 'c-9': 'Zeeshan Haider',
};

function coachingV7(region: string): { schools: number; coachNames: string[] } {
  const r = region.toLowerCase();
  return {
    schools: FIXTURE_SCHOOLS.filter((s) => s.region.toLowerCase() === r).length,
    coachNames: COACHES.filter((c) => c.regions.some((x) => x.toLowerCase() === r))
      .map((c) => COACH_NAMES[c.id])
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
  };
}

/**
 * bd-97x22y.5 — a GET /api/portal/analytics/observations answer (PLAN v7), FICTIONAL, for the same schools: per school
 * its observations of each kind (the schools fixture's DC / human counts), teachers observed and the three FICO
 * sections with their n. Section B is scored on fewer observations than C and D (no lesson plan, no Section B).
 * Roll-ups are worked out as the server does: counts summed; the overview's sections pooled (Σ % × n ÷ Σ n); a region's
 * sections her rule — the mean of its schools' scores, each scored school once — with n still the observations scored.
 */
type Sec = [b: number | null, bN: number, c: number | null, d: number | null];
const OBS_SECTIONS: Record<string, { dc: Sec; human: [teachers: number, ...Sec] }> = {
  's-01': { dc: [71, 4, 75, 55], human: [1, 72, 1, 78, 58] },
  's-02': { dc: [69, 12, 70, 50], human: [4, 70, 5, 66, 49] },
  's-04': { dc: [null, 0, null, null], human: [0, null, 0, null, null] },
  's-05': { dc: [77, 20, 80, 56], human: [5, 76, 4, 81, 59] },
  's-06': { dc: [79, 14, 81, 60], human: [4, 80, 5, 79, 62] },
  's-07': { dc: [52, 1, 58, 44], human: [5, 64, 6, 71, 52] },
  's-08': { dc: [83, 15, 84, 63], human: [5, 82, 6, 86, 61] },
  's-09': { dc: [74, 9, 77, 57], human: [5, 75, 4, 74, 56] },
  's-10': { dc: [66, 5, 68, 51], human: [4, 69, 3, 72, 54] },
  's-11': { dc: [76, 7, 79, 58], human: [6, 78, 7, 80, 60] },
  's-12': { dc: [70, 6, 72, 48], human: [7, 68, 8, 70, 50] },
  's-13': { dc: [64, 3, 66, 46], human: [1, 66, 1, 69, 47] },
  's-14': { dc: [72, 22, 71, 51], human: [9, 73, 10, 72, 52] },
  's-15': { dc: [null, 0, 62, 41], human: [0, null, 0, null, null] },
  's-16': { dc: [71, 6, 74, 55], human: [2, 70, 2, 73, 53] },
  's-18': { dc: [70, 11, 66, 50], human: [3, 71, 3, 64, 51] },
};

function obsSchool(s: SchoolsAnalyticsSchool, kind: 'dc' | 'human'): ObservationsSchool {
  const row = OBS_SECTIONS[s.schoolId];
  const observations = kind === 'dc' ? s.dcObservations : s.humanObservations;
  const [b, bN, c, d] = kind === 'dc' ? row.dc : (row.human.slice(1) as Sec);
  const teachersObserved = kind === 'dc' ? s.teachersWithDc : row.human[0];
  const n = observations;
  return {
    schoolId: s.schoolId, emis: s.emis, name: s.name, region: s.region, observations, teachersObserved,
    sectionB: bN > 0 ? b : null, sectionBN: bN,
    sectionC: n > 0 ? c : null, sectionCN: c === null ? 0 : n,
    sectionD: n > 0 ? d : null, sectionDN: d === null ? 0 : n,
  };
}

function obsRollUp(rows: ObservationsSchool[]): ObservationsCounts & { schools: number } {
  const pool = (avg: 'sectionB' | 'sectionC' | 'sectionD', nKey: 'sectionBN' | 'sectionCN' | 'sectionDN') => {
    const n = rows.reduce((t, r) => t + r[nKey], 0);
    return { avg: n ? round1(rows.reduce((t, r) => t + (r[avg] ?? 0) * r[nKey], 0) / n) : null, n };
  };
  const b = pool('sectionB', 'sectionBN');
  const c = pool('sectionC', 'sectionCN');
  const d = pool('sectionD', 'sectionDN');
  return {
    schools: rows.length,
    observations: rows.reduce((t, r) => t + r.observations, 0),
    teachersObserved: rows.reduce((t, r) => t + r.teachersObserved, 0),
    sectionB: b.avg, sectionBN: b.n, sectionC: c.avg, sectionCN: c.n, sectionD: d.avg, sectionDN: d.n,
  };
}

/** A region's sections, her rule: the mean of its schools' scores (each school with a score once); n summed. */
function obsSectorMeans(rows: ObservationsSchool[]) {
  const mean = (avg: 'sectionB' | 'sectionC' | 'sectionD', nKey: 'sectionBN' | 'sectionCN' | 'sectionDN') => {
    const scored = rows.filter((r) => r[nKey] > 0 && r[avg] !== null);
    return scored.length ? round1(scored.reduce((t, r) => t + (r[avg] as number), 0) / scored.length) : null;
  };
  return { sectionB: mean('sectionB', 'sectionBN'), sectionC: mean('sectionC', 'sectionCN'), sectionD: mean('sectionD', 'sectionDN') };
}

/** The observations answer for one window and region filter ('all' or a region name), shaped as the server sends it. */
export function fixtureObservations(opts: { from?: string | null; to?: string | null; region?: string | null } = {}): ObservationsAnalyticsResponse {
  const wanted = opts.region && opts.region.toLowerCase() !== 'all' ? opts.region.toLowerCase() : null;
  const kindOf = (kind: 'dc' | 'human'): ObservationsKind => {
    const all = FIXTURE_SCHOOLS.map((s) => obsSchool(s, kind));
    const inScope = all.filter((s) => !wanted || s.region.toLowerCase() === wanted);
    const regions = REGION_ORDER.map((region) => {
      const rows = all.filter((s) => s.region === region);
      return { region, ...obsRollUp(rows), ...obsSectorMeans(rows) };
    });
    return {
      overview: {
        ...obsRollUp(inScope),
        sectorsActive: regions.filter((r) => (!wanted || r.region.toLowerCase() === wanted) && r.observations > 0).length,
      },
      regions,
      schools: inScope,
    };
  };
  return { success: true, range: { from: opts.from ?? null, to: opts.to ?? null }, dc: kindOf('dc'), human: kindOf('human') };
}
