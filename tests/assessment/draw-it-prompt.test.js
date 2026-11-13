/**
 * Mind Map, Flow Chart and Graphs & Geometric Problems are drawn by the child, from text.
 *
 * These three stay on offer (the two types that need a printed picture do not, see
 * picture-types-hidden.test.js), but the model still writes them as if a figure were printed:
 * "complete the mind map below", "fill in the empty boxes of the flow chart". The paper has no
 * figure, so the child is left looking for one. One bullet now tells the model to give the topic
 * or the data as text and let the child draw on the answer sheet.
 *
 * bd-ipoxhx.10: Mind Map and Flow Chart are now DRAWN on the paper (paper-diagram.js), so the
 * draw-it line covers Graphs & Geometric Problems alone; those two get a "diagram" line instead.
 *
 * It is added ONLY when one of them is asked for. Every other prompt stays byte-identical,
 * which the user-prompt goldens (golden.test.js) hold for unseen, seen, both and a marks budget.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const DRAW_IT = '• For Graphs & Geometric Problems: give the topic or the data as text; '
  + 'the child draws it on the answer sheet; never refer to boxes, branches, arrows or a figure printed on the paper.';
const DIAGRAM = '"diagram"';
const NO_PICTURE = '• The paper carries no pictures.';

const BASE = {
  grade: 5, subject: 'science', pageContent: '=== Page 5 ===\nThe water cycle', pageReference: '5-9',
  contentSource: 'unseen', questionCount: 6,
};
const types = (...ids) => ids.map((id, i) => ({ id, count: i === 0 ? 4 : 2, category: i === 0 ? 'objective' : 'subjective' }));
const count = (text, part) => text.split(part).length - 1;

beforeEach(() => mockCreate.mockReset());

describe('buildUserPrompt', () => {
  test.each([
    ['maths', 'Graphs & Geometric Problems'],
  ])('%s with %s carries the draw-it line once, right after the no-picture line', (subject, id) => {
    const prompt = Gen.buildUserPrompt({ ...BASE, subject, questionTypes: types('MCQs', id) });
    expect(count(prompt, DRAW_IT)).toBe(1);
    const lines = prompt.split('\n');
    const at = lines.findIndex((l) => l.startsWith(NO_PICTURE));
    expect(lines[at + 1]).toBe(DRAW_IT);
  });

  test.each(['Mind Map', 'Flow Chart'])('%s asks for a drawn diagram, not the draw-it line', (id) => {
    const prompt = Gen.buildUserPrompt({ ...BASE, questionTypes: types('MCQs', id) });
    expect(prompt).not.toContain('draws it on the answer sheet');
    expect(prompt).toContain(DIAGRAM);
  });

  test('graphs with a mind map: one draw-it line and one diagram line', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, subject: 'maths', questionTypes: types('MCQs', 'Graphs & Geometric Problems', 'Mind Map') });
    expect(count(prompt, DRAW_IT)).toBe(1);
    expect(prompt).toContain('• For Mind Map: add');
  });

  test('a paper that asks for none of them does not carry it', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, questionTypes: types('MCQs', 'Brief Answers') });
    expect(prompt).not.toContain('draws it on the answer sheet');
  });

  test('a seen-only paper does not carry it: its types are the book\'s, not a request', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, contentSource: 'seen', questionTypes: types('MCQs', 'Mind Map') });
    expect(prompt).not.toContain('draws it on the answer sheet');
  });

  test('a mix (both) that asks for one in its unseen half carries it', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, subject: 'maths', contentSource: 'both', seenCount: 2, questionTypes: types('MCQs', 'Graphs & Geometric Problems') });
    expect(count(prompt, DRAW_IT)).toBe(1);
  });
});

describe('generateExam', () => {
  test('sends the diagram line to the model when Mind Map is asked for', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ unseen: { subjective: { 'Mind Map': [{ question: 'Make a mind map of the sources of energy.', marks: 4 }] } } }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    await Gen.generateExam({ ...BASE, questionTypes: types('MCQs', 'Mind Map') });
    const userMessage = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    expect(userMessage).toContain('• For Mind Map: add');
  });

  test('does not send it when none of the three is asked for', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    await Gen.generateExam({ ...BASE, questionTypes: types('MCQs', 'Brief Answers') });
    const userMessage = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    expect(userMessage).not.toContain('draws it on the answer sheet');
  });
});
