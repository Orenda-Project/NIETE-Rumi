'use strict';
/**
 * The digest's SLO statements reach the teacher's PDF ("what this quiz checks")
 * and the class report verbatim. A real staging PDF printed "فیکشن کی تعریف
 * بیان کر سکیں" — the transcript's transliteration copied into the goal line,
 * while every question below it said "Fraction". The same fixer that cleans
 * the questions cleans the digest.
 */
const { normaliseDigest } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');

test('transliterated English terms in SLO statements and the as-taught topic are written in English letters', () => {
  const d = normaliseDigest({
    topic: 'Proper fraction', topic_as_taught: 'پروپر فیکشن', subject: 'maths', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'فیکشن کی تعریف بیان کر سکیں', evidence_quote: 'x', taught_level: 'recall' },
           { id: 'S2', statement: 'نیومریٹر اور ڈینومینیٹر کی شناخت کر سکیں', evidence_quote: 'y', taught_level: 'recall' }],
    key_terms: [{ term: 'fraction', as_spoken: 'فیکشن' }],
  });
  expect(d.slos[0].statement).toMatch(/fraction/i);
  expect(d.slos[0].statement).not.toMatch(/فیکشن/);
  expect(d.slos[1].statement).toMatch(/numerator/i);
  expect(d.topic_as_taught).toMatch(/proper fraction/i);
  // What was SPOKEN stays as spoken — that is the record of the lesson.
  expect(d.key_terms[0].as_spoken).toBe('فیکشن');
});
