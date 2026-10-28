/**
 * lessonLabel — a bracketed gloss that only repeats part of the lesson's name says nothing new (bd-1r3k2h).
 *
 * Mock run 20261026-2335-par, T62: an English teacher's Urdu quiz on "Connect & Create: Lemonade Stand
 * Profit Calculation" was captioned
 *   "Mathematics lesson on *Connect & Create: Lemonade Stand Profit Calculation* (Profit Calculation)"
 * — the bracket is the model's short English topic, a sub-phrase of the name the class heard. The spec
 * (training.feature T62): the caption names the lesson once, with a bracket only when the bracket says
 * something new. sameTopic() only caught an EQUAL name (modulo &/and, punctuation, plurals).
 *
 * Red-first: fails on the branch — the sub-phrase gloss is shown.
 */
const L = require('../../bot/shared/services/quiz/transcript-quiz-language');

const label = (digest) => L.lessonLabel({ digest, quizLanguage: 'ur', teacherLanguage: 'en' });

test('a gloss that is a sub-phrase of the taught name is dropped', () => {
  const s = label({ topic: 'Profit Calculation', topic_as_taught: 'Connect & Create: Lemonade Stand Profit Calculation', subject: 'maths' });
  expect(s).toMatch(/Connect & Create: Lemonade Stand Profit Calculation/);
  expect(s).not.toMatch(/\(/);
});

test('a plural sub-phrase is a sub-phrase too', () => {
  const s = label({ topic: 'Fractions', topic_as_taught: 'Comparing & ordering unlike fraction', subject: 'maths' });
  expect(s).not.toMatch(/\(/);
});

test('a translation still gets its bracket — it adds information', () => {
  const s = label({ topic: 'Singular and plural', topic_as_taught: 'واحد اور جمع', subject: 'urdu' });
  expect(s).toMatch(/\(.*Singular and plural.*\)/);
});

test('a genuinely different English name still gets its bracket', () => {
  const s = label({ topic: 'Place value', topic_as_taught: 'Tens and ones', subject: 'maths' });
  expect(s).toMatch(/\(.*Place value.*\)/);
});
