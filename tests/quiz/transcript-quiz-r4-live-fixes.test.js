'use strict';
/**
 * Three things the first round-4 live run on a real science lesson showed
 * ("Structure of an Atom", staging quiz H7JXLK, 2026-09-06):
 *  1. the digest writes every SLO statement in the LESSON's language, so an
 *     English quiz on an Urdu-taught lesson printed Urdu learning goals on an
 *     English document (PLAN_R4 D1 says one language per document);
 *  2. "THIS LESSON IS DRAWABLE … write at least ONE picture question" is
 *     advisory — the model wrote eight text questions for an atom lesson and
 *     nothing sent it back;
 *  3. "Which atom did the teacher ask YOUR GROUP to draw?" — a question about
 *     classroom logistics that no child outside that group can answer.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));

const { normaliseDigest, buildDigestPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { sloStatement } = require('../../bot/shared/services/quiz/transcript-quiz-language');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { figureRequiredError } = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

describe('1 · SLO statements carry both scripts and the document picks its own', () => {
  test('the digest prompt asks for statement_en and statement_ur on every SLO', () => {
    const p = buildDigestPrompt({ transcript: 'x', transcriptLanguage: 'ur', hints: {} });
    expect(p).toMatch(/statement_en/);
    expect(p).toMatch(/statement_ur/);
  });
  test('normaliseDigest keeps both, falling back to statement when one is missing', () => {
    const d = normaliseDigest({ topic: 'Atom', slos: [
      { id: 'S1', statement: 'atom کی تعریف', statement_en: 'define an atom', statement_ur: 'atom کی تعریف', taught_level: 'recall' },
      { id: 'S2', statement: 'define matter', taught_level: 'recall' },
    ] });
    expect(d.slos[0].statement_en).toBe('define an atom');
    expect(d.slos[0].statement_ur).toBe('atom کی تعریف');
    expect(d.slos[1].statement_en).toBe('define matter');
    expect(d.slos[1].statement_ur).toBe('define matter');
  });
  test('sloStatement(slo, language) picks the script of the document', () => {
    const s = { statement: 'atom کی تعریف', statement_en: 'define an atom', statement_ur: 'atom کی تعریف' };
    expect(sloStatement(s, 'en')).toBe('define an atom');
    expect(sloStatement(s, 'ur')).toBe('atom کی تعریف');
    expect(sloStatement({ statement: 'only one' }, 'en')).toBe('only one');
  });
});

describe('2 · a drawable lesson with zero pictures is sent back once', () => {
  const noFig = [{ question: 'q', options: ['a', 'b', 'c'], correct_index: 0 }];
  const withFig = [{ ...noFig[0], figure: { type: 'atom', element: 'C' }, figure_role: 'read_off' }];
  test('science with no figure on a non-final attempt → an error the author is told about', () => {
    const e = figureRequiredError({ questions: noFig, subject: 'science', attempt: 1, maxAttempts: 2 });
    expect(e).toMatch(/FIGURE_REQUIRED/);
  });
  test('the last attempt is never failed for a missing picture', () => {
    expect(figureRequiredError({ questions: noFig, subject: 'science', attempt: 2, maxAttempts: 2 })).toBeNull();
  });
  test('a figure present, or a non-drawable subject, passes', () => {
    expect(figureRequiredError({ questions: withFig, subject: 'science', attempt: 1, maxAttempts: 2 })).toBeNull();
    expect(figureRequiredError({ questions: noFig, subject: 'urdu', attempt: 1, maxAttempts: 2 })).toBeNull();
    expect(figureRequiredError({ questions: noFig, subject: 'english', attempt: 1, maxAttempts: 2 })).toBeNull();
  });
});

describe('3 · the author is told not to ask classroom logistics', () => {
  test('the prompt forbids "which group / who was asked" questions', () => {
    const p = buildAuthorPrompt({ digest: { topic: 'Atom', subject: 'science', slos: [], key_terms: [], examples_used: [], misconceptions_surfaced: [] }, transcript: 'x', language: 'en', n: 8 });
    expect(p).toMatch(/logistics/i);
    expect(p).toMatch(/your group/i);
  });
});
