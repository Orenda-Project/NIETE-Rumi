/**
 * bd-97x22y.4 — a GET /api/portal/analytics/training-levels answer for tests and screenshots. FICTIONAL numbers, on
 * the page fixture's schools (fixtures.ts).
 *
 * Only the per-school counts are made here (from each school's class range: I-V is primary, VI-… is middle/high,
 * I-X both); the region and overview blocks are summed from them the way the server does (services/training-levels-
 * analytics.service.js: counts add school → region → overview, % passed = passed ÷ teachers, one decimal), so the
 * fixture never disagrees with itself.
 */
import type {
  TrainingBand, TrainingBandSplit, TrainingLevelCounts, TrainingLevelsResponse, TrainingLevelsSchool, TrainingPartnerCard,
} from '../types/portal';
import { FIXTURE_SCHOOLS, REGION_ORDER } from './fixtures';

export const FIXTURE_LEVELS = [
  { levelId: 1, levelOrder: 0, name: 'Aspiring Teacher' },
  { levelId: 2, levelOrder: 1, name: 'Emerging Practitioner' },
  { levelId: 3, levelOrder: 2, name: 'Skilled Practitioner' },
  { levelId: 4, levelOrder: 3, name: 'Teacher Leader' },
] as const;

const ORDERS: Record<TrainingBand, readonly number[]> = { primary: [0, 1, 2, 3], midhigh: [2, 3] };

// Share of the band's teachers who passed each level, and who are part-way, before a per-school nudge.
const PASSED: Record<TrainingBand, Record<number, number>> = {
  primary: { 0: 0.91, 1: 0.85, 2: 0.72, 3: 0.5 },
  midhigh: { 2: 0.46, 3: 0.31 },
};
const IN_PROGRESS: Record<number, number> = { 0: 0.03, 1: 0.05, 2: 0.09, 3: 0.14 };

/** How many of a school's teachers are in each band, from the class range in its name. */
function bandTeachers(name: string, teachers: number): Record<TrainingBand, number> {
  if (/\(I-V\)/.test(name)) return { primary: teachers, midhigh: 0 };
  if (/\(VI-/.test(name)) return { primary: Math.round(teachers * 0.1), midhigh: teachers };
  return { primary: Math.round(teachers * 0.6), midhigh: Math.round(teachers * 0.5) };
}

type Cell = { passed: number; inProgress: number; notStarted: number };

function schoolCells(band: TrainingBand): Array<{ school: (typeof FIXTURE_SCHOOLS)[number]; cells: Map<number, Cell> }> {
  return FIXTURE_SCHOOLS.map((school, i) => {
    const n = bandTeachers(school.name, school.teachers)[band];
    const nudge = (((i * 37) % 11) - 5) / 100;
    const cells = new Map<number, Cell>();
    for (const order of ORDERS[band]) {
      const passed = Math.max(0, Math.min(n, Math.round(n * (PASSED[band][order] + nudge))));
      const inProgress = Math.min(n - passed, Math.round(n * IN_PROGRESS[order]));
      cells.set(order, { passed, inProgress, notStarted: n - passed - inProgress });
    }
    return { school, cells };
  });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function counts(order: number, c: Cell): TrainingLevelCounts {
  const level = FIXTURE_LEVELS[order];
  const teachers = c.passed + c.inProgress + c.notStarted;
  return {
    levelId: level.levelId, levelOrder: order, passed: c.passed, inProgress: c.inProgress, notStarted: c.notStarted,
    teachers, pctPassed: teachers ? round1((c.passed / teachers) * 100) : null,
  };
}

function sum(band: TrainingBand, rows: Array<{ cells: Map<number, Cell> }>): TrainingLevelCounts[] {
  return ORDERS[band].map((order) => counts(order, rows.reduce<Cell>((t, r) => {
    const c = r.cells.get(order)!;
    return { passed: t.passed + c.passed, inProgress: t.inProgress + c.inProgress, notStarted: t.notStarted + c.notStarted };
  }, { passed: 0, inProgress: 0, notStarted: 0 })));
}

const top = (levels: TrainingLevelCounts[]) => levels[levels.length - 1];

// ── her Mid/High partner panels (FICTIONAL) ──────────────────────────────────────────────────────────────────────

export const FIXTURE_SESSIONS = ['SESSION#1', 'SESSION#2', 'SESSION#3', 'SESSION#4', 'SESSION#5', 'SESSION#6', 'SESSION#7'];
export const FIXTURE_BH_LEVELS = ['English', 'Mathematics', 'General Science', 'Computer Science'];

type Partners = {
  cohort: number; passedAll: number;
  ox: { passed: number; inProgress: number; sessions: TrainingBandSplit[]; completedAll: TrainingBandSplit };
  bh: { passed: number; inProgress: number; levels: TrainingBandSplit[] };
};

const split = (total: number): TrainingBandSplit => ({ middle: Math.round(total * 0.72), high: Math.round(total * 0.7), total });

function schoolPartners(cohort: number, i: number): Partners {
  const nudge = (((i * 29) % 9) - 4) / 100;
  const oxPassed = Math.max(0, Math.round(cohort * (0.3 + nudge)));
  const oxIp = Math.min(cohort - oxPassed, Math.round(cohort * 0.05));
  const bhPassed = Math.max(0, Math.round(cohort * (0.19 + nudge)));
  const bhIp = Math.min(cohort - bhPassed, Math.round(cohort * 0.12));
  return {
    cohort,
    passedAll: Math.min(oxPassed, bhPassed, Math.round(cohort * 0.11)),
    ox: {
      passed: oxPassed, inProgress: oxIp,
      sessions: FIXTURE_SESSIONS.map((_, k) => split(oxPassed + Math.round((oxIp * (FIXTURE_SESSIONS.length - k)) / FIXTURE_SESSIONS.length))),
      completedAll: split(oxPassed),
    },
    bh: { passed: bhPassed, inProgress: bhIp, levels: [0.6, 0.56, 0.5, 0.4].map((f) => split(Math.round(bhPassed * f))) },
  };
}

function addPartners(a: Partners, b: Partners): Partners {
  const s = (x: TrainingBandSplit, y: TrainingBandSplit) => ({ middle: x.middle + y.middle, high: x.high + y.high, total: x.total + y.total });
  return {
    cohort: a.cohort + b.cohort, passedAll: a.passedAll + b.passedAll,
    ox: { passed: a.ox.passed + b.ox.passed, inProgress: a.ox.inProgress + b.ox.inProgress,
      sessions: a.ox.sessions.map((x, k) => s(x, b.ox.sessions[k])), completedAll: s(a.ox.completedAll, b.ox.completedAll) },
    bh: { passed: a.bh.passed + b.bh.passed, inProgress: a.bh.inProgress + b.bh.inProgress, levels: a.bh.levels.map((x, k) => s(x, b.bh.levels[k])) },
  };
}

const card = (p: { passed: number; inProgress: number }, cohort: number): TrainingPartnerCard => ({
  passed: p.passed, inProgress: p.inProgress, notStarted: cohort - p.passed - p.inProgress, teachers: cohort,
  pctPassed: cohort ? round1((p.passed / cohort) * 100) : null,
});

function partnersOf(schools: string[]): Partners {
  return FIXTURE_SCHOOLS
    .map((school, i) => ({ school, i }))
    .filter(({ school }) => schools.includes(school.schoolId))
    .reduce((t, { school, i }) => addPartners(t, schoolPartners(bandTeachers(school.name, school.teachers).midhigh, i)),
      schoolPartners(0, 0));
}

/** The answer for one band and region filter ('all' or a region name), shaped as the server sends it. */
export function fixtureTrainingLevels(opts: { region?: string | null; band?: TrainingBand } = {}): TrainingLevelsResponse {
  const band = opts.band ?? 'primary';
  const wanted = opts.region && opts.region.toLowerCase() !== 'all' ? opts.region.toLowerCase() : null;
  const all = schoolCells(band);
  const inScope = wanted ? all.filter((r) => r.school.region.toLowerCase() === wanted) : all;
  const overviewLevels = sum(band, inScope).map((l) => ({ ...l, name: FIXTURE_LEVELS[l.levelOrder].name }));

  const schools: TrainingLevelsSchool[] = inScope
    .map(({ school, cells }) => {
      const levels = ORDERS[band].map((order) => counts(order, cells.get(order)!));
      return {
        schoolId: school.schoolId, emis: school.emis, name: school.name, region: school.region,
        teachers: top(levels).teachers, passedAll: top(levels).passed,
        levels: levels.map(({ levelOrder, passed, teachers, pctPassed }) => ({ levelOrder, passed, teachers, pctPassed })),
      };
    })
    .filter((s) => s.levels.some((l) => l.teachers > 0))
    .sort((a, b) => REGION_ORDER.indexOf(a.region as (typeof REGION_ORDER)[number]) - REGION_ORDER.indexOf(b.region as (typeof REGION_ORDER)[number])
      || a.name.localeCompare(b.name));

  if (band === 'midhigh') {
    // Hers on Mid/High: teachers = the cohort, passed all = NIETE's two + Oxbridge + Beaconhouse.
    const ids = (rows: typeof all) => rows.map((r) => r.school.schoolId);
    const o = partnersOf(ids(inScope));
    return {
      success: true,
      band,
      computedAt: '2026-10-14T10:51:38.908Z',
      overview: {
        teachers: o.cohort, passedAll: o.passedAll, levels: overviewLevels,
        partners: {
          oxbridge: { ...card(o.ox, o.cohort), sessions: FIXTURE_SESSIONS.map((name, k) => ({ name, ...o.ox.sessions[k] })), completedAll: o.ox.completedAll },
          beaconhouse: { ...card(o.bh, o.cohort), levels: FIXTURE_BH_LEVELS.map((name, k) => ({ name, ...o.bh.levels[k] })) },
        },
      },
      regions: REGION_ORDER.map((region) => {
        const rows = all.filter((r) => r.school.region === region);
        const p = partnersOf(ids(rows));
        return {
          region, teachers: p.cohort, passedAll: p.passedAll, levels: sum(band, rows),
          partners: { oxbridge: card(p.ox, p.cohort), beaconhouse: card(p.bh, p.cohort) },
        };
      }),
      schools: schools.map((s) => {
        const p = partnersOf([s.schoolId]);
        return { ...s, teachers: p.cohort, passedAll: p.passedAll };
      }),
    };
  }

  return {
    success: true,
    band,
    computedAt: '2026-10-14T10:51:38.908Z',
    overview: { teachers: top(overviewLevels).teachers, passedAll: top(overviewLevels).passed, levels: overviewLevels },
    regions: REGION_ORDER.map((region) => {
      const levels = sum(band, all.filter((r) => r.school.region === region));
      return { region, teachers: top(levels).teachers, passedAll: top(levels).passed, levels };
    }),
    schools,
  };
}
