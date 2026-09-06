'use strict';
/**
 * Second live run of round 4 (Electric Circuit, Urdu, staging JMX4WU):
 *  1. `selected_because` and every distractor misconception came back in
 *     ENGLISH on an all-Urdu document — the prompt named the quiz language
 *     for the questions and the summary, not for these two teacher-facing
 *     fields, and no rule checked them;
 *  2. the transliteration fixer rewrote "الیکٹرک سرکٹ" to "electric circuit"
 *     and that lowercase phrase became the hero title of the PDF, the offer
 *     and the /quiz row.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { normaliseDigest } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');

const DIGEST = { topic: 'Electric circuit', subject: 'science', slos: [{ id: 'S1', statement: 'x', taught_level: 'understand' }], key_terms: [], examples_used: [], misconceptions_surfaced: [] };
function q(over = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: 'کرنٹ کے بہاؤ کے پورے راستے کو کیا کہتے ہیں؟',
    options: ['electric current', 'electric circuit', 'electric path'], correct_index: 1,
    explanation: 'استانی نے electric circuit کو کرنٹ کا مکمل راستہ بتایا۔',
    selected_because: 'جب استانی نے electric circuit کی تعریف بتائی',
    distractor_misconceptions: { 0: 'راستے اور بہاؤ کو ایک سمجھنا', 2: 'عام لفظ کو سائنسی اصطلاح سمجھنا' },
    ...over,
  };
}
const ctx = { language: 'ur', subject: 'science', digest: DIGEST, nExpected: 1, lessonSummary: 'x' };

describe('1 · an Urdu quiz keeps its teacher-facing fields in Urdu', () => {
  test('Urdu selected_because and misconceptions pass', () => {
    const v = validate([q()], ctx);
    expect(v.errors.filter((e) => /URDU_TEACHER_FIELDS/.test(e))).toEqual([]);
  });
  test('an English selected_because on an Urdu quiz is rejected, naming the field', () => {
    const v = validate([q({ selected_because: "The teacher defined 'electric circuit' as the complete path of current." })], ctx);
    expect(v.errors.some((e) => /q0: URDU_TEACHER_FIELDS.*selected_because/.test(e))).toBe(true);
  });
  test('an English misconception on an Urdu quiz is rejected', () => {
    const v = validate([q({ distractor_misconceptions: { 0: 'confuses the path with the flow itself', 2: 'عام لفظ' } })], ctx);
    expect(v.errors.some((e) => /q0: URDU_TEACHER_FIELDS.*distractor_misconceptions/.test(e))).toBe(true);
  });
  test('an English quiz is not touched by the rule', () => {
    const v = validate([q({ question: 'What is the complete path of current called?', explanation: 'Because.', selected_because: 'when she defined the circuit', distractor_misconceptions: { 0: 'confuses path and flow', 2: 'general term' } })], { ...ctx, language: 'en' });
    expect(v.errors.filter((e) => /URDU_TEACHER_FIELDS/.test(e))).toEqual([]);
  });
  test('the prompt says both fields follow the quiz language', () => {
    const p = buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'ur', n: 8 });
    expect(p).toMatch(/selected_because[^\n]*quiz language|quiz language[^\n]*selected_because/i);
    expect(p).toMatch(/distractor_misconceptions[^\n]*(quiz language|same language)/i);
  });
});

describe('2 · a Latin as-taught topic is title-cased', () => {
  test('"electric circuit" → "Electric Circuit"; mixed-script and already-cased labels untouched', () => {
    expect(normaliseDigest({ topic: 'Electric circuit', topic_as_taught: 'الیکٹرک سرکٹ', slos: [] }).topic_as_taught).toBe('Electric Circuit');
    expect(normaliseDigest({ topic: 'Proper Fraction', topic_as_taught: 'Proper Fraction', slos: [] }).topic_as_taught).toBe('Proper Fraction');
    expect(normaliseDigest({ topic: 'x', topic_as_taught: 'circle، ریڈیس اور diameter', slos: [] }).topic_as_taught).toBe('circle، radius اور diameter');
  });
});
