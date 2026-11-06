/**
 * bd-5jmnfj.38.31 (a8) — the level plan reaches the writer, and the a8 checks reach the targeted
 * rewrite: level-split (the split from the tags), stated-type (a stem naming what its scheme marks), and
 * the review's level-off, self-answer and scheme-conflict. Fictional fixture data only.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Svc = require('../../bot/shared/services/assessment/free-secondary.service');
const Rewrite = require('../../bot/shared/services/assessment/free-secondary-rewrite');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
const SCHEME = { mark_bands: [{ marks: '2', descriptor: 'full' }, { marks: '1', descriptor: 'partial' }, { marks: '0', descriptor: 'none' }], accept: 'equal wording', reject: 'a bare yes' };
const mcq = (q, key, blooms) => ({ question: q, options: ['a) Sand', 'b) Water', 'c) Wood', `d) ${key}`], answer: `d) ${key}`, marks: 1, lines: 0, blooms });
const ARGS = {
  grade: 7, subject: 'general_science', pageContent: '=== Page 2 ===\nA fictional page about matter.',
  pageReference: '2-4', contentSource: 'unseen', questionCount: 20, includeAnswerKey: true,
  questionTypes: [
    { id: 'mcq', count: 7, category: 'objective', name: 'Multiple Choice Questions' },
    { id: 'srq', count: 7, category: 'subjective', name: 'Short Answers' },
    { id: 'erq', count: 6, category: 'subjective', name: 'Extended Answers' },
  ],
};

beforeEach(() => mockCreate.mockReset());

describe('the writer gets the level plan', () => {
  it('prints a level for every item and part in the system prompt', async () => {
    mockCreate.mockResolvedValue(reply({ items: [] }));
    await Svc.generateExam(ARGS).catch(() => {});
    const system = mockCreate.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/The level plan for this paper/);
    expect(system).toMatch(/MCQ 1: (Remember|Understand|Apply|Analyze)/);
    expect(system).toMatch(/Create/);
  });
});

describe('the a8 checks go to the targeted rewrite', () => {
  it('takes level-split, level-off, self-answer, scheme-conflict and stated-type', () => {
    const checks = ['level-split', 'level-off', 'self-answer', 'scheme-conflict', 'stated-type'];
    expect(Rewrite.targets(checks.map((check) => ({ n: 1, check, text: check }))).map((i) => i.check)).toEqual(checks);
  });

  it('tells the rewriter to write at the level asked and never award what the stem prints', () => {
    const paper = { unseen: { objective: { M: [mcq('Which one dissolves?', 'Salt', 'Remember')] } } };
    const text = Rewrite.prompt(paper, [{ n: 1, check: 'level-split', text: 'write it at Apply' }]);
    expect(text).toMatch(/really demands the level the problem names/);
    expect(text).toMatch(/never awards marks for something the stem already prints/);
  });

  it('sends a written item whose stem names the type its scheme marks to the rewrite, and the a7-style level split', async () => {
    const grammar = { question: 'Find the adjective in this sentence: "The tall boy ran."', answer: 'tall', marks: 2, lines: 2, blooms: 'Apply',
      marking_points: [{ point: 'the word', marks: 1 }, { point: 'its type', marks: 1 }], ...SCHEME };
    const first = { unseen: { objective: { 'Multiple Choice Questions': [mcq('Which one dissolves?', 'Salt', 'Apply'), mcq('Which one floats?', 'Cork', 'Apply')] },
      subjective: { 'Short Answers': [grammar] } } };
    mockCreate.mockResolvedValue(reply({ items: [] }));
    mockCreate.mockResolvedValueOnce(reply(first));
    await Svc.generateExam(ARGS);
    const asks = mockCreate.mock.calls.map((c) => c[0].messages[c[0].messages.length - 1].content);
    const rewrite = asks.find((t) => /^Rewrite ONLY the items below/m.test(t));
    expect(rewrite).toBeDefined();
    expect(rewrite).toMatch(/the stem already names the type/);
    expect(rewrite).toMatch(/write it at/);
  });
});
