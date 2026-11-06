/** board/fbise-shapes.js: the compact slot/section/variant helpers the four FBISE entry modules share. */
const S = require('../../../bot/shared/services/assessment/patterns/board/fbise-shapes');
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');

test('variant() turns tuples into a builder variant with shared B/C time derived from total - A', () => {
  const v = S.variant({
    id: '50pct', total: 60, time: 180, ta: 80, label: '50% MCQs & 50% Descriptive',
    secs: [
      ['A', 'omr', [['Q1-40', 'mcq', 40, 40, 2], ['Q41-60', 'scenario', 20, 20, 2, false, [5, 4]]]],
      ['B', 'e_sheet', [['Q1-6', 'srq', 6, 6, 12, true]]],
      ['C', 'e_sheet', [['Q7-8', 'erq', 2, 2, 24, true]]],
    ],
  });
  expect(v).toMatchObject({ variant_id: '50pct', total_marks: 60, total_time_min: 180, shared_time_min: 100, shared_sections: ['B', 'C'] });
  expect(v.sections[0].time_min).toBe(80);
  expect(v.sections[1].time_min).toBeNull();
  const slot = v.sections[1].slots[0];
  expect(slot).toMatchObject({ marks_each: 3, prompt_rule: 'internal_or' });
  expect(v.sections[0].slots[1].stimulus).toEqual({ count: 5, mcqs_per_stimulus: 4, kinds: ['passage'] });
  expect(C.makeVariant(v).mcq_share_x100).toBe(3333);
});

test('splitOf() sums to 100 and defaults to K/U/A 30/50/20', () => {
  expect(S.splitOf().levels).toEqual({ K: 30, U: 50, A: 20 });
  expect(S.splitOf({ K: 20, U: 50, A: 30 }, 'derived').status).toBe('derived');
});
