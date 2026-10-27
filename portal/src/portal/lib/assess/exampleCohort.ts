import type { SaResults, SaTaskResult, SaStop } from '../../types/childTestSa';

/**
 * The example dashboard's 1,000 synthetic students (sandbox only, switch sa_example_dashboard).
 *
 * Every student carries a session in the exact shape the results API returns (SaResults), so the dashboard's
 * numbers come from the same fields real sessions will fill. Seeded: the same seed gives the same 1,000 students,
 * so a screenshot and a re-open agree. Nothing here is written anywhere; the ids, schools and names are made up
 * ("Example school …", "EX-0001"), never a real child or school.
 *
 * The model is deliberately plain: a child's ability is the sector's, the school's and the grade's effect plus noise,
 * and each item is right with a logistic chance of that ability minus the task's difficulty. Girls and boys share
 * one distribution, so the example never shows a gender gap that real data has not shown.
 */

export const SECTORS = ['Urban-I', 'Urban-II', 'Bhara Kahu', 'Nilore', 'Sihala', 'Tarnol'] as const;
export type Sector = (typeof SECTORS)[number];
export type Gender = 'girl' | 'boy';
export type ReadLang = 'ur' | 'en';

/** How a task is counted on the dashboard. */
export type TaskKind = 'items' | 'passage' | 'comprehension' | 'fluency';

export type TaskSpec = {
  taskId: string;
  domain: ReadLang | 'ma';
  kind: TaskKind;
  /** the items the child can get right (for a passage: its words; for fluency: the 20 sums) */
  max: number;
  mode: 'tap' | 'keypad' | 'record' | 'oral';
  /** how hard the task is for the model below (higher = harder) */
  difficulty: number;
};

/** The Wave 3 RDF form, as sandbox sessions record it (task ids from child_test_blocks.block). No blending task. */
export const TASKS: TaskSpec[] = [
  { taskId: 'ur.letter_names5', domain: 'ur', kind: 'items', max: 5, mode: 'record', difficulty: -1.2 },
  { taskId: 'ur.letter_sounds5', domain: 'ur', kind: 'items', max: 5, mode: 'record', difficulty: -0.4 },
  { taskId: 'ur.words4', domain: 'ur', kind: 'items', max: 4, mode: 'record', difficulty: 0.2 },
  { taskId: 'ur.story_w3', domain: 'ur', kind: 'passage', max: 60, mode: 'record', difficulty: 0.3 },
  { taskId: 'ur.story_comp_w3', domain: 'ur', kind: 'comprehension', max: 4, mode: 'oral', difficulty: 0.6 },
  { taskId: 'en.letter_names5', domain: 'en', kind: 'items', max: 5, mode: 'record', difficulty: -0.6 },
  { taskId: 'en.letter_sounds5', domain: 'en', kind: 'items', max: 5, mode: 'record', difficulty: 0.4 },
  { taskId: 'en.words4', domain: 'en', kind: 'items', max: 4, mode: 'record', difficulty: 0.8 },
  { taskId: 'en.story_w3', domain: 'en', kind: 'passage', max: 55, mode: 'record', difficulty: 1.0 },
  { taskId: 'en.story_comp_w3', domain: 'en', kind: 'comprehension', max: 3, mode: 'oral', difficulty: 1.3 },
  { taskId: 'ma.number_id8', domain: 'ma', kind: 'items', max: 8, mode: 'record', difficulty: -1.0 },
  { taskId: 'ma.discrimination2', domain: 'ma', kind: 'items', max: 2, mode: 'tap', difficulty: -0.8 },
  { taskId: 'ma.missing4', domain: 'ma', kind: 'items', max: 4, mode: 'keypad', difficulty: 0.4 },
  { taskId: 'ma.add2i', domain: 'ma', kind: 'items', max: 2, mode: 'record', difficulty: -0.2 },
  { taskId: 'ma.sub2i', domain: 'ma', kind: 'items', max: 2, mode: 'record', difficulty: 0.3 },
  { taskId: 'ma.mul2i', domain: 'ma', kind: 'items', max: 2, mode: 'record', difficulty: 1.0 },
  { taskId: 'ma.fluency1m', domain: 'ma', kind: 'fluency', max: 20, mode: 'record', difficulty: 0.2 },
];

export type DashStudent = {
  id: string;
  /** one of SECTORS in the example; on real data the school's own schools.region (realCohort.ts) */
  sector: string;
  schoolId: string;
  schoolName: string;
  grade: 1 | 2 | 3 | 4 | 5;
  /** null on real data until the roster records it */
  gender: Gender | null;
  results: SaResults;
  /** live data with sa_dash_filters (round 7b): coach-led or auto, the coach, the start and the session's skips/stops */
  mode?: 'coach_led' | 'auto';
  coachId?: string | null;
  coachName?: string | null;
  startedAt?: string | null;
  stops?: SaStop[];
  /** item 15: from the random draw, or added by the coach */
  origin?: 'drawn' | 'added' | null;
};

/** mulberry32: a small seeded generator, enough for example data. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const SECTOR_EFFECT: Record<Sector, number> = {
  'Urban-I': 0.4, 'Urban-II': 0.3, 'Tarnol': -0.1, 'Nilore': -0.2, 'Bhara Kahu': -0.3, 'Sihala': -0.4,
};
const SCHOOLS_PER_SECTOR = 8;
/** Ability by grade, against grade 3; set so the example's reading rises with the grade much as Rawalpindi's does. */
const GRADE_EFFECT: Record<DashStudent['grade'], number> = { 1: -1.5, 2: -0.8, 3: 0, 4: 0.6, 5: 1.1 };
const EXAMPLE_DAY = Date.UTC(2026, 9, 23, 4, 0, 0);

function taskResult(spec: TaskSpec, ability: number, rnd: () => number, orf: { ur: number; en: number }): SaTaskResult {
  const base: SaTaskResult = {
    taskId: spec.taskId, mode: spec.mode, attempted: null, correct: null, optionsN: null, chanceCorrected: null,
    itemsPerMin: null, stopReason: 'complete', recording: spec.mode === 'record' || spec.mode === 'oral' ? 'scored' : 'none', score: null,
  };
  if (spec.kind === 'passage') {
    // words correct in the 60 seconds; a child below the floor reads nothing (EGRA's zero score)
    const wcpm = ability - spec.difficulty < -1.1 ? 0 : Math.round(clamp((ability - spec.difficulty + 1.1) * 17 + normal(rnd) * 6, 0, spec.max));
    orf[spec.domain as ReadLang] = wcpm;
    return { ...base, stopReason: wcpm === 0 ? 'first_line' : 'time_up', score: { correct: wcpm, attempted: Math.min(spec.max, wcpm + Math.round(rnd() * 4)), per_minute: wcpm, seconds_used: 60 } };
  }
  if (spec.kind === 'comprehension') {
    // questions follow the reading: a child who read little is asked little and answers little
    const read = orf[spec.domain as ReadLang];
    const p = read === 0 ? 0 : logistic((read - 22) / 9 + (ability - spec.difficulty) * 0.5);
    let right = 0;
    for (let i = 0; i < spec.max; i += 1) if (rnd() < p) right += 1;
    return { ...base, attempted: read === 0 ? 0 : spec.max, score: { correct: right, of: spec.max } };
  }
  if (spec.kind === 'fluency') {
    const n = Math.round(clamp((ability - spec.difficulty + 1.4) * 6 + normal(rnd) * 2.5, 0, spec.max));
    return { ...base, stopReason: 'time_up', score: { correct: n, attempted: Math.min(spec.max, n + Math.round(rnd() * 3)), per_minute: n, seconds_used: 60 } };
  }
  let right = 0;
  for (let i = 0; i < spec.max; i += 1) if (rnd() < logistic(1.3 * (ability - spec.difficulty))) right += 1;
  if (spec.mode === 'tap') {
    return { ...base, attempted: spec.max, correct: right, optionsN: 2, chanceCorrected: Math.max(0, right - (spec.max - right)) };
  }
  if (spec.mode === 'keypad') return { ...base, attempted: spec.max, correct: right };
  return { ...base, score: { correct: right, attempted: spec.max } };
}

/** n synthetic students, deterministic for a seed. */
export function exampleCohort(n = 1000, seed = 20261022): DashStudent[] {
  const rnd = seeded(seed);
  const schools = SECTORS.flatMap((sector, si) => Array.from({ length: SCHOOLS_PER_SECTOR }, (_, k) => ({
    sector,
    schoolId: `ex-school-${si + 1}${String(k + 1).padStart(2, '0')}`,
    schoolName: `Example school ${sector} ${String(k + 1).padStart(2, '0')}`,
    effect: normal(rnd) * 0.35,
  })));
  const out: DashStudent[] = [];
  for (let i = 0; i < n; i += 1) {
    const school = schools[Math.floor(rnd() * schools.length)];
    const grade = (1 + Math.floor(rnd() * 5)) as DashStudent['grade'];
    const gender: Gender = rnd() < 0.5 ? 'girl' : 'boy';
    const general = SECTOR_EFFECT[school.sector] + school.effect + GRADE_EFFECT[grade] + normal(rnd);
    const ability = { ur: general + normal(rnd) * 0.5, en: general - 0.4 + normal(rnd) * 0.6, ma: general + normal(rnd) * 0.6 };
    const orf = { ur: 0, en: 0 };
    const tasks = TASKS.map((spec) => taskResult(spec, ability[spec.domain], rnd, orf));
    const started = EXAMPLE_DAY + Math.floor(rnd() * 5 * 3600) * 1000;
    const minutes = 6 + Math.round(rnd() * 5);
    const id = `EX-${String(i + 1).padStart(4, '0')}`;
    out.push({
      id, sector: school.sector, schoolId: school.schoolId, schoolName: school.schoolName, grade, gender,
      results: {
        session: {
          id: `example-${id.toLowerCase()}`, grade, form: 'A', block: 'rdf_auto', status: 'completed',
          startedAt: new Date(started).toISOString(), endedAt: new Date(started + minutes * 60000).toISOString(),
          lang: rnd() < 0.8 ? 'ur' : 'en',
        },
        tasks,
      },
    });
  }
  return out;
}
