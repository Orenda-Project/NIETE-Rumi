'use strict';
/**
 * Production, 2026-09-07 19:40 PKT, quiz 1920ae53 (Urdu, grade 4, "Types of
 * Fractions"). URDU_TEACHER_FIELDS fired on three or four questions in every one
 * of the three attempts, the teacher-fields repair could not clear it, the
 * salvage then refused ("dropping 3 would leave 5, under the floor of 6"), and
 * the teacher got nothing.
 *
 * What it rejected was correct Urdu:
 *   "Mixed Fraction کو Improper Fraction سمجھنا"
 *
 * The rule counts LETTERS and demands 30% of them be Arabic. That string is 8
 * Arabic letters of 37 = 22%, so it fails — a rule whose own message says
 * "English technical terms in Latin letters are fine", and whose own source
 * comment says "the bar is some Urdu, not no Latin". A letter ratio cannot tell
 * an Urdu sentence about English technical terms from an English sentence: in a
 * fractions or photosynthesis lesson the terms are long and English, so a short
 * correct Urdu note is mostly made of them.
 *
 * The fix is two-part, and both halves are asserted here:
 *   1. count WORDS, not letters — "some Urdu" is about how much of the phrase is
 *      Urdu, not how many of its letters are;
 *   2. make the fault SOFT. These fields are printed on the teacher's PDF; the
 *      child never sees them. A teacher-facing note being a little short of Urdu
 *      is not a reason to send a whole class no quiz.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const DIGEST = {
  topic: 'Types of Fractions', subject: 'maths',
  slos: [{ id: 'S1', statement: 'Identify proper and improper fractions', taught_level: 'recall' }],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const ctx = { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 1, lessonSummary: 'x' };

function q(over = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: 'جس کسر میں شمار مخرج سے چھوٹا ہو اسے کیا کہتے ہیں؟',
    options: ['Proper Fraction', 'Improper Fraction', 'Mixed Fraction'], correct_index: 0,
    explanation: 'استاد نے بتایا کہ Proper Fraction میں شمار مخرج سے چھوٹا ہوتا ہے۔',
    selected_because: 'کلاس میں Proper Fraction کی تعریف بتائی گئی',
    distractor_misconceptions: { 1: 'شمار اور مخرج کو الٹ سمجھنا', 2: 'ہر کسر کو مخلوط سمجھنا' },
    ...over,
  };
}
const urdu = (v) => validate([q({ distractor_misconceptions: { 1: v } })], ctx)
  .errors.filter((e) => /URDU_TEACHER_FIELDS/.test(e));

describe('1 · Urdu that is dense in English technical terms is still Urdu', () => {
  test('the exact string production rejected is accepted', () => {
    expect(urdu('Mixed Fraction کو Improper Fraction سمجھنا')).toEqual([]);
  });
  test('the other two strings from the same quiz are accepted', () => {
    expect(urdu('Numerator کو Denominator سمجھنا')).toEqual([]);
    expect(urdu('Improper Fraction کو Proper Fraction سمجھنا')).toEqual([]);
  });
  test('a term-dense science note is accepted', () => {
    expect(urdu('Photosynthesis کو Respiration سمجھنا')).toEqual([]);
  });
  test('selected_because gets the same treatment', () => {
    const v = validate([q({ selected_because: 'Improper Fraction اور Mixed Fraction کا فرق' })], ctx);
    expect(v.errors.filter((e) => /URDU_TEACHER_FIELDS/.test(e))).toEqual([]);
  });
});

describe('2 · a field with no real Urdu in it is still caught', () => {
  test('a fully English misconception is rejected', () => {
    expect(urdu('confuses the numerator with the denominator').length).toBe(1);
  });
  test('an English sentence carrying one Urdu word is rejected', () => {
    expect(urdu('the student confuses the numerator and اور the denominator here').length).toBe(1);
  });
  test('an English selected_because is rejected, naming the field', () => {
    const v = validate([q({ selected_because: 'The teacher defined a proper fraction for the class.' })], ctx);
    expect(v.errors.some((e) => /q0: URDU_TEACHER_FIELDS.*selected_because/.test(e))).toBe(true);
  });
  test('an English quiz is untouched by the rule', () => {
    const v = validate([q({
      question: 'Which fraction has a numerator smaller than its denominator?',
      explanation: 'Because that is what proper means.',
      selected_because: 'the teacher defined proper fractions',
      distractor_misconceptions: { 1: 'confuses numerator and denominator', 2: 'thinks every fraction is mixed' },
    })], { ...ctx, language: 'en' });
    expect(v.errors.filter((e) => /URDU_TEACHER_FIELDS/.test(e))).toEqual([]);
  });
});

describe('3 · and it is never a reason to send a teacher nothing', () => {
  test('the fault is soft', () => {
    expect(Gen.SOFT_FAULT.test('q2: URDU_TEACHER_FIELDS — distractor_misconceptions must be written in Urdu')).toBe(true);
  });
  test('a real breakage is still not soft', () => {
    ['q1: duplicate options', 'q4: empty stem'].forEach((e) => {
      expect(Gen.SOFT_FAULT.test(e)).toBe(false);
    });
  });
});
