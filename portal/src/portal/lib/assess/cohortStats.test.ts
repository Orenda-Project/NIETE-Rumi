import { describe, it, expect } from 'vitest';
import { exampleCohort, SECTORS, TASKS } from './exampleCohort';
import {
  applyFilter, correctOf, groupBy, headline, orfBand, summariseTask, specOf,
} from './cohortStats';
import type { DashStudent } from './exampleCohort';

// The example dashboard's data and numbers: 1,000 seeded synthetic students in the results API's shape, and the
// counts the page shows (mean, zero scores, distribution, benchmarks, sector and school rows).

const cohort = exampleCohort();

function one(tasks: DashStudent['results']['tasks'], extra: Partial<DashStudent> = {}): DashStudent {
  return {
    id: 'EX-9999', sector: 'Nilore', schoolId: 's', schoolName: 'S', grade: 3, gender: 'girl',
    results: { session: { id: 'x', grade: 3, form: 'A', block: 'rdf_auto', status: 'completed', startedAt: '2026-10-23T04:00:00Z', endedAt: '2026-10-23T04:08:00Z', lang: 'ur' }, tasks },
    ...extra,
  };
}
const t = (taskId: string, score: Record<string, number> | null, correct: number | null = null) => ({
  taskId, mode: 'record' as const, attempted: null, correct, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: 'complete', recording: 'scored' as const, score,
});

describe('exampleCohort', () => {
  it('is 1,000 students, the same for the same seed, different for another', () => {
    expect(cohort).toHaveLength(1000);
    expect(exampleCohort()).toEqual(cohort);
    expect(exampleCohort(1000, 7)[0]).not.toEqual(cohort[0]);
  });

  it('covers every sector, both grades and both genders, with synthetic ids only', () => {
    expect(new Set(cohort.map((s) => s.sector))).toEqual(new Set(SECTORS));
    expect(new Set(cohort.map((s) => s.grade))).toEqual(new Set([3, 5]));
    expect(new Set(cohort.map((s) => s.gender))).toEqual(new Set(['girl', 'boy']));
    expect(cohort.every((s) => /^EX-\d{4}$/.test(s.id) && s.schoolName.startsWith('Example school'))).toBe(true);
  });

  it('every session carries every task of the form, in the results shape, within the task\'s range', () => {
    for (const s of cohort) {
      expect(s.results.tasks.map((x) => x.taskId)).toEqual(TASKS.map((x) => x.taskId));
      for (const task of s.results.tasks) {
        const c = correctOf(task) as number;
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual((specOf(task.taskId) as { max: number }).max);
      }
    }
  });

  it('is plausible: grade 5 reads faster than grade 3, and some children score zero', () => {
    const g3 = headline(applyFilter(cohort, { grade: 3 }));
    const g5 = headline(applyFilter(cohort, { grade: 5 }));
    expect(g5.orfMedian.ur as number).toBeGreaterThan(g3.orfMedian.ur as number);
    expect(g3.orfZero.ur as number).toBeGreaterThan(0.05);
    expect(g3.orfZero.ur as number).toBeLessThan(0.6);
  });
});

describe('cohortStats', () => {
  it('correctOf reads the scorer\'s count for a spoken task and the phone\'s for tap / keypad; null when unscored', () => {
    expect(correctOf(t('ur.words4', { correct: 3, attempted: 4 }))).toBe(3);
    expect(correctOf(t('ma.missing4', null, 2))).toBe(2);
    expect(correctOf(t('ur.story_w3', null))).toBeNull();
    expect(correctOf(undefined)).toBeNull();
  });

  it('ORF bands: 0 zero, 1-19 beginning, 20-39 developing, 40+ fluent', () => {
    expect([0, 1, 19, 20, 39, 40, 90].map(orfBand)).toEqual(['zero', 'beginning', 'beginning', 'developing', 'developing', 'fluent', 'fluent']);
  });

  it('summariseTask: mean share, zero share, distribution per score, and the maths 75% benchmark', () => {
    const students = [
      one([t('ma.missing4', null, 0)]), one([t('ma.missing4', null, 3)]), one([t('ma.missing4', null, 4)]), one([t('ur.words4', { correct: 1 })]),
    ];
    const s = summariseTask(students, specOf('ma.missing4') as never);
    expect(s.n).toBe(3);
    expect(s.meanShare).toBeCloseTo(7 / 12);
    expect(s.zeroShare).toBeCloseTo(1 / 3);
    expect(s.distribution).toEqual([1, 0, 0, 1, 1]);
    expect(s.benchmarkShare).toBeCloseTo(2 / 3);
  });

  it('a passage\'s distribution is per ORF band; comprehension uses its own number of questions', () => {
    const students = [one([t('ur.story_w3', { correct: 0 })]), one([t('ur.story_w3', { correct: 25 })]), one([t('ur.story_w3', { correct: 45 })])];
    expect(summariseTask(students, specOf('ur.story_w3') as never).distribution).toEqual([1, 0, 1, 1]);
    const comp = [one([t('en.story_comp_w3', { correct: 3, of: 3 })]), one([t('en.story_comp_w3', { correct: 2, of: 3 })])];
    expect(summariseTask(comp, specOf('en.story_comp_w3') as never).benchmarkShare).toBeCloseTo(0.5);
  });

  it('headline: reading with comprehension at 80%, ORF median, minutes', () => {
    const students = [
      one([t('ur.story_w3', { correct: 30 }), t('ur.story_comp_w3', { correct: 4, of: 4 })]),
      one([t('ur.story_w3', { correct: 10 }), t('ur.story_comp_w3', { correct: 3, of: 4 })]),
    ];
    const h = headline(students);
    expect(h.readingWithComprehension.ur).toBeCloseTo(0.5);
    expect(h.readingWithComprehension.en).toBeNull();
    expect(h.orfMedian.ur).toBe(20);
    expect(h.minutesMedian).toBe(8);
  });

  it('filters and groups by sector and school', () => {
    const urban = applyFilter(cohort, { sector: 'Urban-I', grade: 3 });
    expect(urban.every((s) => s.sector === 'Urban-I' && s.grade === 3)).toBe(true);
    const rows = groupBy(cohort, 'sector');
    expect(rows.map((r) => r.key).sort()).toEqual([...SECTORS].sort());
    expect(rows.reduce((a, r) => a + r.n, 0)).toBe(1000);
    expect(groupBy(applyFilter(cohort, { sector: 'Sihala' }), 'school').every((r) => r.label.includes('Sihala'))).toBe(true);
  });
});
