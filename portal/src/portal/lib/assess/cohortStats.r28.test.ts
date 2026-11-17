import { describe, it, expect } from 'vitest';
import { exampleCohort, TASKS } from './exampleCohort';
import { comprehensionShare, headline, specOf, summariseTask } from './cohortStats';
import { DASH_COPY } from './dashboardCopy';
import type { DashStudent } from './exampleCohort';
import type { SaTaskResult } from '../../types/childTestSa';

// Round 28: the new tapped tasks (letter_pick10, story_mcq_w3) have their own specs and their own rows, never merged
// with the old spoken ones; the headline's "reading with comprehension" reads whichever comprehension task a child has.

function one(id: string, tasks: SaTaskResult[]): DashStudent {
  return {
    id, sector: 'Nilore', schoolId: 's', schoolName: 'S', grade: 3, gender: null,
    results: { session: { id, grade: 3, form: 'A', block: 'rdf_auto', status: 'completed', startedAt: '2026-10-23T04:00:00Z', endedAt: '2026-10-23T04:08:00Z', lang: 'ur' }, tasks },
  };
}
const oral = (taskId: string, correct: number, of: number): SaTaskResult => ({
  taskId, mode: 'oral', attempted: of, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null,
  stopReason: 'complete', recording: 'scored', score: { correct, of },
});
const tap = (taskId: string, correct: number, attempted: number, optionsN: number, extra: Partial<SaTaskResult> = {}): SaTaskResult => ({
  taskId, mode: 'tap', attempted, correct, optionsN, chanceCorrected: null, itemsPerMin: null,
  stopReason: 'complete', recording: 'none', score: null, ...extra,
});

const TODAY_IDS = [
  'ur.letter_names5', 'ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3',
  'en.letter_names5', 'en.letter_sounds5', 'en.words4', 'en.story_w3', 'en.story_comp_w3',
  'ma.number_id8', 'ma.discrimination2', 'ma.missing4', 'ma.add2i', 'ma.sub2i', 'ma.mul2i', 'ma.fluency1m',
];
const NEW_IDS = ['ur.letter_pick10', 'en.letter_pick10', 'ur.story_mcq_w3', 'en.story_mcq_w3'];

describe('round 28 task specs', () => {
  it('the four new ids have specs: picker items of 10 by tap, MCQ comprehension of 6 by tap', () => {
    for (const lang of ['ur', 'en'] as const) {
      expect(specOf(`${lang}.letter_pick10`)).toMatchObject({ domain: lang, kind: 'items', max: 10, mode: 'tap', example: false });
      expect(specOf(`${lang}.story_mcq_w3`)).toMatchObject({ domain: lang, kind: 'comprehension', max: 6, mode: 'tap', example: false });
    }
  });

  it('the example cohort still carries exactly today\'s task ids per student', () => {
    const cohort = exampleCohort(50);
    for (const s of cohort) expect(s.results.tasks.map((x) => x.taskId)).toEqual(TODAY_IDS);
    expect(TASKS.filter((x) => x.example !== false).map((x) => x.taskId)).toEqual(TODAY_IDS);
    expect(TASKS.filter((x) => x.example === false).map((x) => x.taskId).sort()).toEqual([...NEW_IDS].sort());
  });

  it('labels: the new ids carry the distinguishing title (EN and UR); the old titles are unchanged', () => {
    for (const lang of ['ur', 'en']) {
      expect(DASH_COPY.en.tasks[`${lang}.letter_pick10`]).toBe('Letter sounds (listen and tap)');
      expect(DASH_COPY.en.tasks[`${lang}.story_mcq_w3`]).toBe('Story questions (listen and tap)');
      expect(DASH_COPY.ur.tasks[`${lang}.letter_pick10`]).toBe('حروف کی آوازیں (سن کر ٹیپ)');
      expect(DASH_COPY.ur.tasks[`${lang}.story_mcq_w3`]).toBe('کہانی کے سوال (سن کر ٹیپ)');
      expect(DASH_COPY.en.tasks[`${lang}.letter_sounds5`]).toBe('Letter sounds');
      expect(DASH_COPY.en.tasks[`${lang}.story_comp_w3`]).toBe('Reading comprehension');
      expect(DASH_COPY.ur.tasks[`${lang}.letter_sounds5`]).toBe('حروف کی آوازیں');
      expect(DASH_COPY.ur.tasks[`${lang}.story_comp_w3`]).toBe('عبارت کی سمجھ');
    }
  });
});

describe('round 28 rows and headline', () => {
  const oldOne = one('a', [oral('ur.story_comp_w3', 3, 6)]);
  const newOne = one('b', [tap('ur.story_mcq_w3', 5, 6, 4, { asked: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] })]);

  it('old spoken comprehension and new MCQ are two rows (n 1 each), never merged', () => {
    const old = summariseTask([oldOne, newOne], specOf('ur.story_comp_w3') as never);
    const mcq = summariseTask([oldOne, newOne], specOf('ur.story_mcq_w3') as never);
    expect(old.n).toBe(1);
    expect(mcq.n).toBe(1);
    expect(old.meanShare).toBeCloseTo(0.5);
    expect(mcq.meanShare).toBeCloseTo(5 / 6);
    expect(mcq.benchmarkShare).toBe(1);
  });

  it('the headline pools whichever comprehension task each child has: 1 of 2 at 80%+', () => {
    expect(headline([oldOne, newOne]).readingWithComprehension.ur).toBeCloseTo(0.5);
  });

  it('an unrated MCQ (too few heard) is not counted', () => {
    const unrated = one('c', [tap('ur.story_mcq_w3', 3, 3, 4, { unrated: true, presented: 3 })]);
    expect(headline([oldOne, newOne, unrated]).readingWithComprehension.ur).toBeCloseTo(0.5);
    expect(summariseTask([unrated], specOf('ur.story_mcq_w3') as never).n).toBe(0);
  });

  it('the MCQ share divides by score.of, else asked.length, else 6', () => {
    const spec = specOf('ur.story_mcq_w3') as never;
    expect(comprehensionShare(tap('ur.story_mcq_w3', 3, 4, 4, { asked: ['q1', 'q2', 'q3', 'q4'] }), spec)).toBeCloseTo(0.75);
    expect(comprehensionShare(tap('ur.story_mcq_w3', 3, 6, 4), spec)).toBeCloseTo(0.5);
    expect(comprehensionShare({ ...tap('ur.story_mcq_w3', 3, 6, 4, { asked: ['q1', 'q2', 'q3', 'q4'] }), score: { correct: 3, of: 5 } }, spec)).toBeCloseTo(0.6);
  });

  it('the picker row with 8 of 10 reads meanShare 0.8; an unrated picker is left out', () => {
    const spec = specOf('en.letter_pick10') as never;
    const s = summariseTask([one('d', [tap('en.letter_pick10', 8, 10, 5)]), one('e', [tap('en.letter_pick10', 2, 4, 5, { unrated: true, presented: 4 })])], spec);
    expect(s.n).toBe(1);
    expect(s.meanShare).toBeCloseTo(0.8);
    expect(s.distribution).toHaveLength(11);
  });
});

describe('round 28: today\'s spoken comprehension is read as before', () => {
  it('an oral row carrying asked[] still divides by its score.of, else the spec max (never asked.length)', () => {
    const spec = specOf('ur.story_comp_w3') as never;
    const row = { ...oral('ur.story_comp_w3', 2, 4), score: { correct: 2 }, asked: ['q1', 'q2'] };
    expect(comprehensionShare(row, spec)).toBeCloseTo(0.5);
  });
});
