'use strict';
/**
 * ONE class label form wherever a parent or child sees the class (PLAN §11 A15 + A73): "Class 3 A" / «کلاس ۳ A» —
 * «کلاس», Urdu digits in Urdu, the section as stored after a space, no hyphen; no section -> "Class 3" / «کلاس ۳»;
 * no grade -> null; at most 24 code points. The reminder's title (roundsReadyForPhone) and the teacher page's
 * "Evening rounds" read it from classLabels; the /j/ preview reuses it (class-link-preview.test.js).
 */
const { classLabels } = require('../../shared/services/quiz/web-quiz-evening-round-phone');

test.each([
  ['grade_3', 'A', 'Class 3 A', 'کلاس ۳ A'],
  ['grade_3', 'B', 'Class 3 B', 'کلاس ۳ B'],
  ['grade_10', 'Rose', 'Class 10 Rose', 'کلاس ۱۰ Rose'],
  ['grade_5', null, 'Class 5', 'کلاس ۵'],
  ['grade_5', '  ', 'Class 5', 'کلاس ۵'],
  ['grade_4', ' b ', 'Class 4 b', 'کلاس ۴ b'],
])('%s + %p -> %s / %s', (grade, section, en, ur) => {
  expect(classLabels(grade, section)).toEqual({ en, ur });
});

test('no grade -> no label', () => {
  expect(classLabels(null, 'A')).toEqual({ en: null, ur: null });
  expect(classLabels('ey', 'A')).toEqual({ en: null, ur: null });
});

test('never a hyphen, never «جماعت», never over 24 code points', () => {
  const l = classLabels('grade_3', 'A very long section name indeed');
  expect([...l.en].length).toBeLessThanOrEqual(24);
  expect([...l.ur].length).toBeLessThanOrEqual(24);
  const all = ['A', 'B', null].map((s) => classLabels('grade_7', s));
  all.forEach((x) => { expect(x.en).not.toContain('-'); expect(x.ur).not.toContain('-'); expect(x.ur).not.toContain('جماعت'); });
});
