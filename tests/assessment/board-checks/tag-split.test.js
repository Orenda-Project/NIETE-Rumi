const { splitReport } = require('../../../bot/shared/services/assessment/board-checks/tag-split');

const leaf = (blooms, marks, ref = 'r') => ({ item: { marks, tag: { blooms } }, ref, slotRow: null });
const target = (levels, extra = {}) => ({ levels, tolerance_pp: 5, status: 'set', ...extra });

describe('tag-split', () => {
  test('60/20/20 against 30/50/20 is a soft note per off level', () => {
    const r = splitReport([leaf('K', 6), leaf('U', 2), leaf('A', 2)], target({ K: 30, U: 50, A: 20 }));
    expect(r.split.levels).toEqual({ K: 60, U: 20, A: 20 });
    expect(r.split.target).toEqual({ K: 30, U: 50, A: 20 });
    expect(r.split.tolerance_pp).toBe(5);
    expect(r.issues.map((i) => i.code)).toEqual(['SPLIT', 'SPLIT']);
    expect(r.issues.every((i) => i.hard === false && i.check === 'tag-complete')).toBe(true);
  });
  test('inside the tolerance there is no note', () => {
    const r = splitReport([leaf('K', 3), leaf('U', 5), leaf('A', 2)], target({ K: 30, U: 50, A: 20 }));
    expect(r.issues).toEqual([]);
  });
  test('design_pending and default targets report only', () => {
    ['design_pending', 'default'].forEach((status) => {
      const r = splitReport([leaf('K', 6), leaf('U', 4)], target({ K: 30, U: 70 }, { status }));
      expect(r.issues).toEqual([]);
      expect(r.split.levels.K).toBe(60);
    });
  });
  test('marks weight the share; slot marks_each fills a missing marks; zero marks gives no split', () => {
    const l = { item: { tag: { blooms: 'U' } }, ref: 'x', slotRow: { marks_each: 4 } };
    expect(splitReport([l, leaf('K', 4)], target({ K: 50, U: 50 })).issues).toEqual([]);
    expect(splitReport([leaf('K', 0)], target({ K: 100 })).split).toBeNull();
  });
  test('no target gives nothing', () => {
    expect(splitReport([leaf('K', 1)], null)).toEqual({ issues: [], split: null });
  });
});
