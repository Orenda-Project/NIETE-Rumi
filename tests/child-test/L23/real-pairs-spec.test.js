'use strict';
/**
 * Child test L23 (bd-s1oo0.40) — AI vs the enumerators on every May 2026 study recording.
 *
 * The May battery was one instrument for all grades; the go-live bank has only Grades 3 and 5. The
 * real-pairs driver therefore scores Grades 1, 2 and 4 against the Grade 3 Form A spec (the May
 * passage verbatim) and Grade 5 against its own form, swaps in the May items the bank lacks (English
 * made-up words, level-1 quick sums), and can split the children into shards. Pure functions.
 */
const { realSpec, bankGrade, shardOf, MAY_PW_ENG } = require('../../../scripts/child-test/eval-real-pairs');

const bank = {
  version: 'test-bank',
  grades: {
    3: { forms: { A: { urdu: { story: { id: 'u3A-story' }, first_sounds: [{ id: 'x' }], nonwords: [{ id: 'y' }] }, english: { story: { id: 'e3A-story' }, nonwords: [{ id: 'e3A-nw1' }] }, maths: { numbers: [{ id: 'm3A-n1' }], quick_sums: [{ id: 'm3A-qs1' }], written: [{ id: 'w' }], word_problem: { id: 'wp' } } } } },
    5: { forms: { A: { urdu: { story: { id: 'u5A-story' } }, english: { story: { id: 'e5A-story' } }, maths: { numbers: [], quick_sums: [] } } } },
  },
};
const key = (grade, qs = ['1+4 = 5', '10 - 6 = 4']) => ({ grade, form: 'A', blocks: { urdu: {}, english: {}, maths: { maths: { quick_sums: { items: qs } } } } });

describe('L23 real-pairs spec', () => {
  test('Grades 1, 2, 3 and 4 read the Grade 3 form (the May passage); Grade 5 its own', () => {
    expect([1, 2, 3, 4, 5].map(bankGrade)).toEqual([3, 3, 3, 3, 5]);
    expect(realSpec(bank, key(1), 'urdu').story.id).toBe('u3A-story');
    expect(realSpec(bank, key(4), 'english').story.id).toBe('e3A-story');
    expect(realSpec(bank, key(5), 'urdu').story.id).toBe('u5A-story');
  });

  test('Urdu has no first sounds or made-up words (not in May); English uses the May made-up words', () => {
    const u = realSpec(bank, key(2), 'urdu');
    expect(u.first_sounds).toEqual([]);
    expect(u.nonwords).toEqual([]);
    const e = realSpec(bank, key(2), 'english');
    expect(e.nonwords.map((n) => n.id)).toEqual(MAY_PW_ENG.map((_, i) => `may-pw_eng-${i + 1}`));
    expect(e.nonwords[0]).toEqual({ id: 'may-pw_eng-1', text: 'maz', sounds: ['m', 'a', 'z'] });
  });

  test('maths: the May level-1 quick sums with their answers; no written sums or word problem from audio', () => {
    const m = realSpec(bank, key(1), 'maths');
    expect(m.quick_sums).toEqual([
      { id: 'may-blfl1-1', prompt: '1 + 4', answer: 5 },
      { id: 'may-blfl1-2', prompt: '10 - 6', answer: 4 },
    ]);
    expect(m.written).toEqual([]);
    expect(m.word_problem).toBeNull();
  });

  test('the bank is not mutated', () => {
    realSpec(bank, key(1), 'urdu');
    expect(bank.grades[3].forms.A.urdu.first_sounds).toEqual([{ id: 'x' }]);
  });

  test('shards split the children without overlap or loss', () => {
    const kids = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const parts = [0, 1, 2].map((i) => shardOf(kids, [i, 3]));
    expect(parts.flat().sort()).toEqual([...kids].sort());
    expect(new Set(parts.flat()).size).toBe(10);
    expect(shardOf(kids, null)).toEqual(kids);
  });
});
