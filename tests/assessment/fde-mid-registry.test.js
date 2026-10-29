/**
 * The Grade 3 and Grade 4 FDE end-of-chapter patterns are registered (bd-5jmnfj.33.1): the
 * routes list them for a Grade 3 or 4 teacher, the generator accepts them, and the derived
 * views (scope, types, summary) work on a pattern with no pinned page range.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');

const MID = { fde_g3_2026: { grade: 3, subjects: ['maths', 'english', 'urdu', 'general_knowledge'] },
  fde_g4_2026: { grade: 4, subjects: ['maths', 'english', 'urdu', 'science'] } };

test('both mid patterns are listed, after the existing three', () => {
  expect(Patterns.list()).toEqual(['fde_g5_2027', 'fde_g1_2026', 'fde_g2_2026', 'fde_g3_2026', 'fde_g4_2026']);
});

describe.each(Object.entries(MID))('%s', (id, { grade, subjects }) => {
  test('eligible for its own grade and subjects only', () => {
    subjects.forEach((s) => expect(Patterns.isEligible(id, grade, s)).toBe(true));
    expect(Patterns.isEligible(id, grade, 'islamiat')).toBe(false);
    expect(Patterns.isEligible(id, grade === 3 ? 4 : 3, subjects[0])).toBe(false);
    expect(Patterns.isEligible(id, 5, subjects[0])).toBe(false);
    expect(Patterns.isEligible(id, String(grade), subjects[0])).toBe(true);
  });

  test('scope, types and summary come out for every subject with no pinned pages', () => {
    subjects.forEach((s) => {
      const scope = Patterns.scopeFor(id, s);
      expect(scope.page_ranges).toBe('');
      expect(scope.chapters).toEqual([]);
      Object.values(scope.section_ranges).forEach((r) => expect(r).toBe(''));
      const types = Patterns.expandTypes(id, s);
      expect(types.length).toBeGreaterThan(0);
      types.forEach((t) => expect(t.slot.startsWith(`g${grade}.${s}.`)).toBe(true));
      const sum = Patterns.summaryFor(id, s);
      expect(sum.totalMarks).toBe(50);
      expect(sum.generateTotal).toBeLessThanOrEqual(60);
      expect(sum.youAdd).toBeNull();
    });
  });
});

test('the Grade 1, 2 and 5 patterns stay as they were', () => {
  expect(Patterns.isEligible('fde_g5_2027', 5, 'urdu')).toBe(true);
  expect(Patterns.isEligible('fde_g1_2026', 1, 'maths')).toBe(true);
  expect(Patterns.isEligible('fde_g2_2026', 2, 'english')).toBe(true);
  expect(Patterns.isEligible('fde_g3_2026', 1, 'maths')).toBe(false);
});
