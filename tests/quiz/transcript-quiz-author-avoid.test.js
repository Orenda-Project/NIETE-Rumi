'use strict';
/**
 * bd-v0toag.10 — the day-3 retest asks the author for NEW questions on the same SLOs. The
 * author prompt gains a "do not reuse these" block only when an avoid list is given; without
 * one the prompt is byte-identical to before.
 */
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ ...jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-llm'), completeJson: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const DIGEST = { subject: 'maths', grade_band: '1-2', slos: [{ id: 'S1', statement: 'add', taught_level: 'apply' }], examples_used: [] };
const args = { digest: DIGEST, excerpts: 'x', language: 'en', n: 8, gradeBand: '1-2', lessonPlan: 'plan' };

test('no avoid list (absent, null or empty) → the prompt is unchanged', () => {
  const before = Author.buildAuthorPrompt(args);
  expect(Author.buildAuthorPrompt({ ...args, avoidQuestions: null })).toBe(before);
  expect(Author.buildAuthorPrompt({ ...args, avoidQuestions: [] })).toBe(before);
  expect(before).not.toMatch(/DO NOT REUSE/);
});

test('an avoid list → a block listing each question, asking for new ones on the same SLOs', () => {
  const p = Author.buildAuthorPrompt({ ...args, avoidQuestions: ['What is 2 + 3?', 'Which is bigger, 12 or 21?'] });
  expect(p).toMatch(/DO NOT REUSE/);
  expect(p).toContain('- What is 2 + 3?');
  expect(p).toContain('- Which is bigger, 12 or 21?');
  expect(p).toMatch(/same SLOs/i);
});

test('author() passes the avoid list into the prompt', async () => {
  completeJson.mockResolvedValue({ json: { questions: [] }, model: 'm', costUsd: 0, latencyMs: 1 });
  await Author.author({ digest: DIGEST, transcript: null, language: 'en', lessonPlan: 'plan', avoidQuestions: ['Old one?'] });
  expect(completeJson.mock.calls[0][0].prompt).toContain('- Old one?');
});

describe('avoidBlock caps the list', () => {
  const { avoidBlock, MAX_AVOID, MAX_CHARS } = require('../../bot/shared/services/quiz/quiz-avoid-block');
  test('at most 15 questions, each at most 200 chars, blanks dropped', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Q${i} ${'x'.repeat(300)}`);
    const lines = avoidBlock([...many, '', null]).split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(MAX_AVOID);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(MAX_CHARS + 2));
  });
  test('not an array → empty', () => expect(avoidBlock('nope')).toBe(''));
});
