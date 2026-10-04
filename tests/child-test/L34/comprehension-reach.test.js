'use strict';
/**
 * L34 (bd-s1oo0.47, CONTRACT §20) — comprehension is scored out of the questions the child reached AND
 * the coach asked. Only the model HTTP boundary (the openai SDK the llm-client wraps) is mocked; the real
 * prompt, scorer, reach rule, assembler and item bank run.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } })));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { scoreQuestions } = require('../../../bot/shared/services/child-test/scoring/comprehension');
const { assembleMarks } = require('../../../bot/shared/services/child-test/scoring/assemble');
const bank = require('../../../bot/shared/services/child-test/item-bank');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 10 } });
const promptOf = (req) => { const c = req.messages[0].content; return typeof c === 'string' ? c : c[0].text; };
const words = [{ raw: 'سوال', start: 70, end: 71, speaker: 1 }, { raw: 'جواب', start: 72, end: 73, speaker: 2 }];

const form = bank.getForm(5, 'A');
const spec = form.urdu; // u5A-q1 needs line 1 (11 words), q2 line 8 (85), q3 line 13 (148)

async function score(rows) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue(reply({ questions: rows }));
  const calls = [];
  const r = await scoreQuestions({ lang: 'urdu', spec, words, window: { start: 65, end: 90 }, calls });
  return { r, prompt: promptOf(mockCreate.mock.calls[0][0]) };
}

const marksFor = (questions, story) => assembleMarks({
  block: 'urdu', form, battery: 'v2',
  parts: { story: { words_correct: story.wa, words_attempted: story.wa, seconds: 60, finished_early: !!story.early, confidence: 0.9 }, questions },
});

describe('the grader reports whether each question was asked', () => {
  test('the prompt asks for "asked" per question', async () => {
    const { prompt } = await score([]);
    expect(prompt).toMatch(/"asked":true\|false/);
    expect(prompt).toMatch(/did not ask/i);
  });

  test('rows carry asked from the reply; a reply without it reads as asked (older grader)', async () => {
    const { r } = await score([
      { id: 'u5A-q1', answer: 'والد', verdict: 'correct', confidence: 0.9, asked: true },
      { id: 'u5A-q2', answer: '', verdict: 'no_answer', confidence: 0.9, asked: false },
      { id: 'u5A-q3', answer: 'خوش', verdict: 'wrong', confidence: 0.8 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.part.map((q) => [q.id, q.asked])).toEqual([['u5A-q1', true], ['u5A-q2', false], ['u5A-q3', true]]);
  });
});

describe('ai-marks-v2 rows and the score (comp_correct / comp_asked / comp_total)', () => {
  test('slow reader (90 words): q1, q2 reached and asked; q3 asked beyond reach is kept but excluded', async () => {
    const { r } = await score([
      { id: 'u5A-q1', answer: 'والد', verdict: 'correct', confidence: 0.9, asked: true },
      { id: 'u5A-q2', answer: 'پتھر', verdict: 'correct', confidence: 0.9, asked: true },
      { id: 'u5A-q3', answer: 'سیر', verdict: 'correct', confidence: 0.9, asked: true },
    ]);
    const m = marksFor(r.part, { wa: 90 });
    expect(m.version).toBe('ai-marks-v2');
    expect(m.questions.map(({ id, verdict, reached, asked }) => ({ id, verdict, reached, asked }))).toEqual([
      { id: 'u5A-q1', verdict: 'correct', reached: true, asked: true },
      { id: 'u5A-q2', verdict: 'correct', reached: true, asked: true },
      { id: 'u5A-q3', verdict: 'correct', reached: false, asked: true },
    ]);
    expect(m.questions[2].beyond_reach).toBe(true);
    expect(m.questions[0].beyond_reach).toBeUndefined();
    expect([m.comp_correct, m.comp_asked, m.comp_total, m.comp_not_reached]).toEqual([2, 2, 3, 1]);
  });

  test('a reached question the coach did not ask is not in the score', async () => {
    const { r } = await score([
      { id: 'u5A-q1', answer: 'والد', verdict: 'correct', confidence: 0.9, asked: true },
      { id: 'u5A-q2', answer: '', verdict: 'no_answer', confidence: 0.9, asked: false },
      { id: 'u5A-q3', answer: '', verdict: 'no_answer', confidence: 0.9, asked: false },
    ]);
    const m = marksFor(r.part, { wa: 30, early: true }); // finished early: reached all
    expect(m.questions.every((q) => q.reached)).toBe(true);
    expect([m.comp_correct, m.comp_asked, m.comp_total, m.comp_not_reached]).toEqual([1, 1, 3, 0]);
  });

  test('a wrong answer to a reached question counts against the child', async () => {
    const { r } = await score([
      { id: 'u5A-q1', answer: 'امی', verdict: 'wrong', confidence: 0.9, asked: true },
      { id: 'u5A-q2', answer: '', verdict: 'no_answer', confidence: 0.9, asked: false },
      { id: 'u5A-q3', answer: '', verdict: 'no_answer', confidence: 0.9, asked: false },
    ]);
    const m = marksFor(r.part, { wa: 20 });
    expect(m.questions.map((q) => q.reached)).toEqual([true, false, false]);
    expect([m.comp_correct, m.comp_asked, m.comp_total, m.comp_not_reached]).toEqual([0, 1, 3, 2]);
    expect(m.questions.some((q) => q.beyond_reach)).toBe(false);
  });

  test('a fallback block: no question reached, nothing asked counts', () => {
    const m = assembleMarks({ block: 'urdu', form, battery: 'v2', parts: { story: { words_attempted: 0 }, fallback: { letters: { correct: 4 }, words: { correct: 2 }, confidence: 0.8 }, questions: [] } });
    expect(m.questions.every((q) => q.reached === false)).toBe(true);
    expect([m.comp_correct, m.comp_asked, m.comp_total]).toEqual([0, 0, 3]);
  });

  test('maths carries no comprehension counts', () => {
    const m = assembleMarks({ block: 'maths', form, mathsMode: 'oral', parts: { maths: {} } });
    expect(m.comp_total).toBeUndefined();
  });
});
