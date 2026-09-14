'use strict';
/**
 * bd-2yyry.7 — the pre-send sheet is one sentence on what was taught and one
 * on what the quiz checks. Until now the sheet cut the authored 2–3 sentence
 * summary at 32 words and folded the objectives' count into a stock line; the
 * author now writes both sentences itself, in the quiz language, and the
 * generate step stores them next to the summary so the sheet prefers them.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({
  completeJson: jest.fn(),
}));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const DIGEST = {
  topic_as_taught: 'Proper fractions', subject: 'maths', grade_band: '3-5', language: 'en',
  slos: [{ id: 'S1', statement: 'Identify a proper fraction', taught_level: 'recall' }],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const Q = { slo_id: 'S1', level: 'recall', question: 'Which is proper?', options: ['1/2', '3/2', '2/2'], correct_index: 0,
  explanation: 'x', selected_because: 'y', distractor_misconceptions: { 1: 'a', 2: 'b' },
  option_feedback: { correct: 'c', wrong: { 1: 'd', 2: 'e' } }, figure: null, figure_role: null };

beforeEach(() => jest.clearAllMocks());

describe('the prompt asks for the two sentences', () => {
  test('names lesson_summary_short and checks_summary, one sentence each, in the quiz language, and puts them in the JSON skeleton', () => {
    const p = Author.buildAuthorPrompt({ digest: DIGEST, excerpts: [], language: 'en', n: 8, gradeBand: '3-5' });
    expect(p).toMatch(/"lesson_summary_short"/);
    expect(p).toMatch(/"checks_summary"/);
    expect(p).toMatch(/ONE sentence/i);
    expect(p).toMatch(/\{ "lesson_summary": "",\s*"lesson_summary_short": "",\s*"checks_summary": ""/);
  });
});

describe('author() returns them as extras', () => {
  test('both sentences come back; the summary is untouched', async () => {
    completeJson.mockResolvedValue({ json: {
      lesson_summary: 'You taught proper fractions with a roti. Then you moved to quarters.',
      lesson_summary_short: 'You taught proper fractions, starting with a roti shared between two children.',
      checks_summary: 'This quiz checks whether the class can tell a proper fraction from an improper one.',
      questions: [Q],
    }, model: 'm', costUsd: 0.01, latencyMs: 10 });
    const out = await Author.author({ transcript: 't', digest: DIGEST, language: 'en', n: 8, gradeBand: '3-5' });
    expect(out.lessonSummary).toMatch(/^You taught proper fractions with a roti/);
    expect(out.extras).toEqual({
      lesson_summary_short: 'You taught proper fractions, starting with a roti shared between two children.',
      checks_summary: 'This quiz checks whether the class can tell a proper fraction from an improper one.',
    });
  });

  test('a missing or over-long extra is null, never a paragraph on the sheet', async () => {
    completeJson.mockResolvedValue({ json: {
      lesson_summary: 'x'.repeat(30),
      lesson_summary_short: Array.from({ length: 45 }, (_, i) => `w${i}`).join(' '),
      questions: [Q],
    }, model: 'm', costUsd: 0.01, latencyMs: 10 });
    const out = await Author.author({ transcript: 't', digest: DIGEST, language: 'en', n: 8, gradeBand: '3-5' });
    expect(out.extras).toEqual({ lesson_summary_short: null, checks_summary: null });
  });
});
