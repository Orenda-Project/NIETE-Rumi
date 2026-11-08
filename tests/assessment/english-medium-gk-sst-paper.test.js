/**
 * bd-uam6dh.2 — a paper from the English-medium General Knowledge or Social Studies book is written in
 * English, set left to right, and run on the English model, with English section headings. The Urdu-medium
 * papers are untouched: same prompt, same format prompt, same model, same direction.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const PROMPTS = { ...require('../../bot/shared/services/assessment/ict-prompts.json'),
  ...require('../../bot/shared/services/assessment/gk-sst-en-prompts.json') };
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Book = require('../../bot/shared/services/assessment/book-content.service');
const Types = require('../../bot/shared/services/assessment/question-types');

const URDU_SCRIPT = /[؀-ۿ]/;
const ONE_QUESTION = { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } };
const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const BASE = {
  grade: 1, pageContent: '=== Page 5 ===\nMy Family', pageReference: '5-8', contentSource: 'unseen',
  questionTypes: [{ id: 'MCQs', count: 3, category: 'objective' }],
};

beforeEach(() => mockCreate.mockReset());

describe.each([
  ['general_knowledge_en', 'eg.ict.genk_en.system', 'eg.ict.genk.system'],
  ['social_studies_en', 'eg.ict.sst_en.system', 'eg.ict.sst.system'],
])('%s', (subject, enKey, urKey) => {
  test('has an English prompt of its own, carrying no Urdu script', () => {
    expect(PROMPTS[enKey]).toEqual(expect.any(String));
    expect(PROMPTS[enKey]).not.toMatch(URDU_SCRIPT);
    expect(PROMPTS[enKey]).toMatch(/Choose the correct answer/);
    expect(PROMPTS[enKey]).toMatch(/in English/);
  });

  test('takes that prompt and the English exam format, never the Urdu one', () => {
    const sys = Gen.buildSystemPrompt({ subject });
    expect(sys.startsWith(PROMPTS[enKey])).toBe(true);
    expect(sys).toContain(PROMPTS['eg.format.exam']);
    expect(sys).not.toContain(PROMPTS['eg.format.urdu_exam']);
    expect(sys).not.toContain(PROMPTS[urKey]);
  });

  test('runs on the English model', async () => {
    mockCreate.mockResolvedValue(reply(ONE_QUESTION));
    await Gen.generateExam({ ...BASE, subject });
    expect(mockCreate.mock.calls[0][0].model).toBe(Gen.MODELS.eng);
  });

  test('prints left to right, under the plain subject name', () => {
    expect(Renderer.isRtl(subject)).toBe(false);
    expect(Renderer.subjectName(subject)).toBe(subject.startsWith('general') ? 'General Knowledge' : 'Social Studies');
  });

  test('reads its own book, not the Urdu one', () => {
    expect(Book.normaliseSubject(subject, BASE.grade)).toBe(subject);
  });

  test('offers the same question types as its Urdu twin', () => {
    const twin = subject.replace(/_en$/, '');
    const grade = subject.startsWith('general') ? 2 : 4;
    expect(Types.forSubject(subject, grade)).toEqual(Types.forSubject(twin, grade));
  });
});

describe('the Urdu-medium papers are unchanged', () => {
  test.each([['general_knowledge'], ['social_studies']])('%s stays Urdu, right to left', async (subject) => {
    expect(Renderer.isRtl(subject)).toBe(true);
    expect(Gen.buildSystemPrompt({ subject })).toContain(PROMPTS['eg.format.urdu_exam']);
    mockCreate.mockResolvedValue(reply(ONE_QUESTION));
    await Gen.generateExam({ ...BASE, subject });
    expect(mockCreate.mock.calls[0][0].model).toBe(Gen.MODELS.urdu);
  });
});
