import { describe, it, expect } from 'vitest';
import { fmtFloor, guessFloor, rungK, tapFloors, TAP_CARE_ABOVE } from './guessFloor';
import { tapBeforeSoundOf } from './realCohort';
import { cohortTapOf, headline, specOf, summariseTask, tapOf } from './cohortStats';
import type { DashStudent } from './exampleCohort';
import type { SaTaskResult } from '../../types/childTestSa';

// Round 28: the guessing floor (the share of children who reach a rung by guessing alone, binomial P(X ≥ k)) and the
// tap-before-sound rate beside every tapped score. Text only: no score, band or level changes.

describe('guessFloor: binomial P(X ≥ k)', () => {
  it('MCQ, 4 options (p = 0.25): 3.8% reach 4 of 6', () => {
    expect(guessFloor(0.25, 6, 4)).toBeCloseTo(0.0376, 4);
    expect(fmtFloor(guessFloor(0.25, 6, 4))).toBe('3.8%');
  });
  it('picker, 5 cards (p = 0.2): 0.6% reach 6 of 10', () => {
    expect(guessFloor(0.2, 10, 6)).toBeCloseTo(0.00637, 5);
    expect(fmtFloor(guessFloor(0.2, 10, 6))).toBe('0.6%');
  });
  it('picker, 5 cards (p = 0.2): 8 of 10 is 0.0078% (the binomial; the brief\'s "0.07%" is a factor of ten off)', () => {
    expect(guessFloor(0.2, 10, 8)).toBeCloseTo(0.0000779, 7);
    expect(fmtFloor(guessFloor(0.2, 10, 8))).toBe('0.008%');
  });
  it('edges: k ≤ 0 is everyone, k > n is no one', () => {
    expect(guessFloor(0.25, 6, 0)).toBeCloseTo(1);
    expect(guessFloor(0.25, 6, 7)).toBe(0);
  });
});

describe('tapFloors: the rungs of the two tapped tasks only', () => {
  it('the MCQ: one rung, 4 of 6, p from its options', () => {
    expect(tapFloors('ur.story_mcq_w3', 4)).toEqual([{ k: 4, n: 6, share: guessFloor(0.25, 6, 4) }]);
  });
  it('the picker: 8 of 10 then 6 of 10, p from its cards (5 when unknown)', () => {
    expect(tapFloors('en.letter_pick10', null)).toEqual([
      { k: 8, n: 10, share: guessFloor(0.2, 10, 8) },
      { k: 6, n: 10, share: guessFloor(0.2, 10, 6) },
    ]);
  });
  it('every other task has none', () => {
    for (const id of ['ur.letter_sounds5', 'ur.story_comp_w3', 'ur.letter_names5', 'ma.number_id8']) expect(tapFloors(id, 4)).toBeNull();
  });
});

function one(id: string, tasks: SaTaskResult[]): DashStudent {
  return {
    id, sector: 'Nilore', schoolId: 's', schoolName: 'S', grade: 3, gender: null,
    results: { session: { id, grade: 3, form: 'A', block: 'rdf_auto', status: 'completed', startedAt: '2026-10-23T04:00:00Z', endedAt: '2026-10-23T04:08:00Z', lang: 'ur' }, tasks },
  };
}
const pick = (correct: number, extra: Partial<SaTaskResult> = {}): SaTaskResult => ({
  taskId: 'ur.letter_pick10', mode: 'tap', attempted: 10, correct, optionsN: 5, chanceCorrected: null, itemsPerMin: null,
  stopReason: 'complete', recording: 'none', score: null, ...extra,
});

describe('tapBeforeSoundOf: the cohort sum for one task', () => {
  it('sums n and of over the students that carry it', () => {
    const cohort = [one('a', [pick(8, { tapBeforeSound: { n: 1, of: 10 } })]), one('b', [pick(6, { tapBeforeSound: { n: 3, of: 10 } })]), one('c', [pick(7)])];
    expect(tapBeforeSoundOf(cohort, 'ur.letter_pick10')).toEqual({ n: 4, of: 20 });
    expect(TAP_CARE_ABOVE).toBe(0.1);
  });
  it('none carry it: null', () => {
    expect(tapBeforeSoundOf([one('c', [pick(7)])], 'ur.letter_pick10')).toBeNull();
  });
  it('the cohort stats of a tapped task are the same with and without the new field (text only)', () => {
    const bare = [one('a', [pick(8)]), one('b', [pick(6)])];
    const withIt = [one('a', [pick(8, { tapBeforeSound: { n: 1, of: 10 } })]), one('b', [pick(6, { tapBeforeSound: { n: 3, of: 10 } })])];
    const spec = specOf('ur.letter_pick10') as never;
    expect(summariseTask(withIt, spec)).toEqual(summariseTask(bare, spec));
    expect(headline(withIt)).toEqual(headline(bare));
  });
});

// Round 28 (lead ruling): the floor is read on the items the child actually had: the picker's `presented`, the MCQ's
// 6 − lost. k is the rung as a count on that `of`: ceil(share × of), the MCQ's 0.67 read as two thirds as the ladder does.
describe('the floor on the denominator the rung uses', () => {
  it('rungK: ceil(share × of); 0.67 is two thirds (4 of 6, never 5)', () => {
    expect(rungK(0.67, 4)).toBe(3);
    expect(rungK(0.8, 9)).toBe(8);
    expect(rungK(0.6, 9)).toBe(6);
    expect(rungK(0.67, 6)).toBe(4);
    expect(rungK(0.67, 5)).toBe(4);
    expect(rungK(0.8, 10)).toBe(8);
    expect(rungK(0.6, 10)).toBe(6);
  });
  it('MCQ, 2 clips lost (of 4): 5.1% reach 3 of 4', () => {
    expect(guessFloor(0.25, 4, 3)).toBeCloseTo(0.0508, 4);
    expect(tapFloors('ur.story_mcq_w3', 4, 4)).toEqual([{ k: 3, n: 4, share: guessFloor(0.25, 4, 3) }]);
    expect(fmtFloor(tapFloors('ur.story_mcq_w3', 4, 4)![0].share)).toBe('5.1%');
  });
  it('picker, 9 presented: the 0.8 rung is 8 of 9 (7 of 9 is 0.78, below it), the 0.6 rung 6 of 9', () => {
    expect(tapFloors('en.letter_pick10', 5, 9)).toEqual([
      { k: 8, n: 9, share: guessFloor(0.2, 9, 8) },
      { k: 6, n: 9, share: guessFloor(0.2, 9, 6) },
    ]);
    expect(guessFloor(0.2, 9, 8)).toBeCloseTo(0.0000189, 7);
    expect(fmtFloor(guessFloor(0.2, 9, 8))).toBe('0.002%');
    expect(fmtFloor(guessFloor(0.2, 9, 6))).toBe('0.3%');
  });
  it('no of (or a non-positive one): the task\'s full count, as before', () => {
    expect(tapFloors('ur.story_mcq_w3', 4, null)).toEqual(tapFloors('ur.story_mcq_w3', 4));
    expect(tapFloors('ur.letter_pick10', 5, 0)).toEqual(tapFloors('ur.letter_pick10', 5));
  });
  it('tapOf is the denominator the share divides by: presented for the picker, 6 − lost for the MCQ', () => {
    const p = specOf('ur.letter_pick10') as never;
    const m = specOf('ur.story_mcq_w3') as never;
    expect(tapOf(pick(7, { presented: 9 }), p)).toBe(9);
    expect(tapOf(pick(7), p)).toBeNull();
    expect(tapOf({ ...pick(3), taskId: 'ur.story_mcq_w3', optionsN: 4, unavailable: 2 }, m)).toBe(4);
    expect(tapOf({ ...pick(3), taskId: 'ur.story_mcq_w3', optionsN: 4 }, m)).toBe(6);
    expect(tapOf({ ...pick(3), mode: 'record' }, p)).toBeNull();
  });
  it('cohortTapOf: the modal of among rated children and how many had a shorter one', () => {
    const spec = specOf('ur.letter_pick10') as never;
    const five = [10, 10, 10, 9, 9].map((of, i) => one(String(i), [pick(8, { presented: of })]));
    expect(cohortTapOf(five, spec)).toEqual({ of: 10, fewer: 2 });
    const full = [10, 10, 10, 10, 10].map((of, i) => one(String(i), [pick(8, { presented: of })]));
    expect(cohortTapOf(full, spec)).toEqual({ of: 10, fewer: 0 });
    const unrated = [...five, one('u', [pick(2, { presented: 3, unrated: true })])];
    expect(cohortTapOf(unrated, spec)).toEqual({ of: 10, fewer: 2 });
  });
});
