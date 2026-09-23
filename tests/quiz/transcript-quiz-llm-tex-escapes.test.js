'use strict';
/**
 * A quiz reply that carries TeX keeps its backslashes (bd-mg9c7.159.19).
 *
 * The author now writes maths as `$\frac{2}{9}$`. In the JSON it returns, that
 * backslash has to be doubled — and a model in JSON mode does not always double
 * it, because `"$\frac{2}{9}$"` is VALID JSON: `\f` is the form-feed escape. It
 * parses without a murmur into a form feed followed by "rac{2}{9}", and the
 * fraction is gone. `\times` goes the same way through `\t`. The 6-12 LP lane
 * lost three revision passes to exactly this before it repaired backslashes
 * BEFORE parsing; the quiz passes now use that same repair.
 *
 * Mocked at the boundary only: the LLM client. completeJson and its JSON
 * extraction run for real.
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClientForModel: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getClientForModel } = require('../../bot/shared/services/llm-client');
const { completeJson, extractJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');

function replying(content) {
  const create = jest.fn().mockResolvedValue({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0.001 } });
  getClientForModel.mockReturnValue({ client: { chat: { completions: { create } } }, model: 'm' });
  return create;
}

// What the model sends on the wire — ONE backslash before each command.
const SINGLE = String.raw`{"questions":[{"question":"Which is largest: $\frac{2}{9}$ or $\frac{2}{3}$?","options":["$\frac{2}{9}$","$3 \times 4$","$\sqrt{16}$"],"explanation":"line one\nline two"}]}`;

test('a single-escaped \\frac, \\times and \\sqrt come back as TeX, not as a form feed, a tab and a parse error', async () => {
  replying(SINGLE);
  const { json } = await completeJson({ prompt: 'p', label: 'transcript_quiz.author' });
  const q = json.questions[0];
  expect(q.question).toBe('Which is largest: $\\frac{2}{9}$ or $\\frac{2}{3}$?');
  expect(q.options).toEqual(['$\\frac{2}{9}$', '$3 \\times 4$', '$\\sqrt{16}$']);
  expect(q.question).not.toMatch(/[\f\t\b]/);
  // a real newline escape is still a newline
  expect(q.explanation).toBe('line one\nline two');
});

test('a properly doubled reply parses exactly as it always did', () => {
  const doubled = JSON.stringify({ questions: [{ question: 'Is $\\frac{1}{2} > \\frac{1}{3}$?', options: ['yes', 'no', 'same'] }] });
  expect(extractJson(doubled)).toEqual(JSON.parse(doubled));
});

test('a reply with no maths in it is untouched by the repair', () => {
  const plain = '{"lesson_summary":"You taught nouns.\\nThen verbs.","questions":[]}';
  expect(extractJson(plain)).toEqual(JSON.parse(plain));
});
