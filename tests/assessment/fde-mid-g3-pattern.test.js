/** The Grade 3 FDE pattern module (bd-5jmnfj.33.1): wiring, frozen, no profile, generate counts. */
const P = require('../../bot/shared/services/assessment/patterns/fde-g3-2026');

const KEYS = ['maths', 'english', 'urdu', 'general_knowledge'];

test('id, grade, subjects in the designed order', () => {
  expect(P.id).toBe('fde_g3_2026');
  expect(P.grade).toBe(3);
  expect(Object.keys(P.subjects)).toEqual(KEYS);
});

test('deep-frozen, no profile key, every subject g5_rules false, 50 marks', () => {
  expect(Object.isFrozen(P)).toBe(true);
  expect(Object.isFrozen(P.subjects.maths.sections[0].slots[0])).toBe(true);
  expect(P).not.toHaveProperty('profile');
  KEYS.forEach((k) => {
    expect(P.subjects[k].g5_rules).toBe(false);
    expect(P.subjects[k].total_marks).toBe(50);
  });
});

test('each subject generates at most 60 items (counts printed)', () => {
  const counts = Object.fromEntries(KEYS.map((k) => [k, P.subjects[k].sections.flatMap((s) => s.slots).reduce((n, s) => n + s.generate, 0)]));
  console.log('G3 generate counts', JSON.stringify(counts));
  KEYS.forEach((k) => expect(counts[k]).toBeLessThanOrEqual(60));
  expect(counts).toEqual({ maths: 22, english: 34, urdu: 36, general_knowledge: 30 });
});
