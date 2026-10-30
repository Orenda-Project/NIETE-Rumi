/**
 * The Grade 4 FDE end-of-chapter pattern module (bd-5jmnfj.33.1).
 */

const P = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');

const subs = Object.values(P.subjects);

test('id, grade and subject order', () => {
  expect(P.id).toBe('fde_g4_2026');
  expect(P.grade).toBe(4);
  expect(Object.keys(P.subjects)).toEqual(['maths', 'english', 'urdu', 'science']);
});

test('deep-frozen, no profile key, every subject g5_rules false', () => {
  const frozen = (n) => !n || typeof n !== 'object' || (Object.isFrozen(n) && Object.values(n).every(frozen));
  expect(frozen(P)).toBe(true);
  expect(P).not.toHaveProperty('profile');
  subs.forEach((s) => expect(s.g5_rules).toBe(false));
});

test('each subject totals 50 and generates at most 60 items', () => {
  const counts = {};
  subs.forEach((s) => {
    expect(s.total_marks).toBe(50);
    counts[s.key] = s.sections.flatMap((x) => x.slots).reduce((n, x) => n + x.generate, 0);
    expect(counts[s.key]).toBeLessThanOrEqual(60);
  });
  console.log('generate counts', JSON.stringify(counts));
  expect(counts).toEqual({ maths: 24, english: 36, urdu: 36, science: 29 });
});
