/**
 * bd-5jmnfj.38.31 — the G6-12 free paper's distractor review runs on the `assessment.review` job, on a
 * model of another family than the writer's actual model (settings rows included): its default, or its
 * registered alternative when the default is the writer's family. Fictional fixture data only.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SONNET = 'anthropic/claude-sonnet-5';
const GEMINI = 'google/gemini-3.1-pro-preview';
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];
const mcq = () => ({ question: 'Which one dissolves in water?', options: OPTS.slice(), answer: 'd) Salt', marks: 1, lines: 0 });
const short = { question: 'Why does ice float?', answer: 'Ice is less dense than water.', marks: 3, lines: 4,
  marking_points: [{ point: 'less dense', marks: 2 }, { point: 'than water', marks: 1 }],
  mark_bands: [{ marks: '3', descriptor: 'full' }, { marks: '1-2', descriptor: 'partial' }, { marks: '0', descriptor: 'none' }],
  accept: 'equal wording', reject: 'a bare yes' };
const draft = () => ({ unseen: { objective: { 'Multiple Choice Questions': [mcq(), mcq(), mcq()] }, subjective: { 'Short Answers': [short] } } });
const ARGS = { grade: 7, subject: 'general_science', pageContent: '=== Page 2 ===\nA fictional page about matter.',
  pageReference: '2-4', contentSource: 'unseen', questionCount: 4, includeAnswerKey: true,
  questionTypes: [{ id: 'mcq', count: 3, category: 'objective' }, { id: 'srq', count: 1, category: 'subjective' }] };

/** The review call the service makes, with these settings rows in force. */
async function reviewCall(perJob) {
  let Svc;
  jest.isolateModules(() => {
    jest.doMock('../../bot/shared/config/model-settings', () => ({ ensureCurrent: async () => {}, configForRequest: () => ({ perJob }) }));
    Svc = require('../../bot/shared/services/assessment/free-secondary.service');
  });
  mockCreate.mockReset();
  mockCreate.mockResolvedValueOnce(reply(draft())).mockResolvedValueOnce(reply({ items: [] }));
  await Svc.generateExam(ARGS);
  return { writer: mockCreate.mock.calls[0][0], review: mockCreate.mock.calls[1][0] };
}

afterEach(() => jest.dontMock('../../bot/shared/config/model-settings'));

describe('the distractor reviewer', () => {
  it('reviews a Gemini writer on an Anthropic model, on assessment.review', async () => {
    const { writer, review } = await reviewCall({ 'assessment.generate': GEMINI });
    expect(writer.model).toBe(GEMINI);
    expect(review.job).toBe('assessment.review');
    expect(review.model.split('/')[0]).toBe('anthropic');
    expect(review.fallbackModel).toBe(GEMINI);
  });

  it('reviews a Sonnet writer on a Gemini model: the registered alternative', async () => {
    const { writer, review } = await reviewCall({ 'assessment.generate': SONNET });
    expect(writer.model).toBe(SONNET);
    expect(review.job).toBe('assessment.review');
    expect(review.model.split('/')[0]).toBe('google');
  });

  it('follows a settings row on assessment.review when it is of another family', async () => {
    const { review } = await reviewCall({ 'assessment.generate': GEMINI, 'assessment.review': 'openai/gpt-5.4' });
    expect(review.model).toBe('openai/gpt-5.4');
  });

  it('skips a settings row on assessment.review of the writer\'s own family for the alternative', async () => {
    const { review } = await reviewCall({ 'assessment.generate': SONNET, 'assessment.review': SONNET });
    expect(review.model.split('/')[0]).not.toBe('anthropic');
  });
});
