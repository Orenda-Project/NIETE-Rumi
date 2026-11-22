/**
 * AG row 21 — the book questions she ticked (`seenPicked`) reach the writer on every path: request service →
 * queued job → orchestrator → generateExam (grades 1-5) and the grades 6-12 free generator, and the prompt names
 * them word for word. A job without seenPicked carries no new key and its prompt is unchanged.
 */
const PICKS = [
  { chapter: 3, ref: 'Exercise 3.1 · Q1', text: 'What do plants need to grow?', type: 'Brief Answers' },
  { chapter: 3, ref: 'Exercise 3.1 · Q4', text: 'Plants can walk. True or false?', type: 'True/False' },
];
const SEEN_TYPES = [
  { id: 'Brief Answers', count: 1, category: 'subjective' },
  { id: 'True/False', count: 1, category: 'objective' },
];

describe('seenPicked survives the chain', () => {
  const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
  const loadRequestService = () => {
    jest.resetModules();
    mockQueueJob.mockClear();
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) }) }),
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
    return require('../../bot/shared/services/assessment/assessment-request.service');
  };
  const REQUEST = { userId: 'u1', grade: 4, subject: 'science', textbookId: 't', chapterNumber: 3,
    contentSource: 'seen', questionCount: 2, questionTypes: [], seenTypes: SEEN_TYPES };

  test('the request service puts seenPicked on the job payload', async () => {
    const Req = loadRequestService();
    await Req.createAndQueue({ ...REQUEST, seenPicked: PICKS });
    expect(mockQueueJob.mock.calls[0][2].seenPicked).toEqual(PICKS);
  });

  test('a request without seenPicked adds no key to the job', async () => {
    const Req = loadRequestService();
    await Req.createAndQueue(REQUEST);
    expect('seenPicked' in mockQueueJob.mock.calls[0][2]).toBe(false);
  });

  const runOrchestrator = async (job) => {
    jest.resetModules();
    const handed = [];
    const chain = () => {
      const q = Promise.resolve({ data: { id: 'paper-1' }, error: null });
      q.select = () => q; q.single = () => q; q.eq = () => q; q.insert = () => q; q.update = () => q;
      return q;
    };
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
      loadChapterContent: async () => ({ content: 'x', pageReference: '1-2' }),
      loadPageRangeContent: async () => ({ content: 'x', pageReference: '1-2' }),
    }));
    jest.doMock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
      generateExam: async (args) => { handed.push(args); throw new Error('stop-here'); },
    }));
    const Orch = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
    await Orch.buildPaper({ userId: 'u1', requestId: 'r1', grade: 4, subject: 'science', chapterNumber: 3,
      contentSource: 'seen', questionCount: 2, questionTypes: [], seenTypes: SEEN_TYPES, ...job }).catch(() => {});
    return handed;
  };

  test('the orchestrator hands seenPicked to generateExam', async () => {
    const handed = await runOrchestrator({ seenPicked: PICKS });
    expect(handed[0].seenPicked).toEqual(PICKS);
  });

  test('an old job hands generateExam no seenPicked key', async () => {
    const handed = await runOrchestrator({});
    expect('seenPicked' in handed[0]).toBe(false);
  });
});

describe('the prompt', () => {
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
  const ARGS = { grade: 4, subject: 'science', pageContent: 'p', pageReference: '30-31', contentSource: 'seen',
    questionCount: 2, questionTypes: [], seenTypes: SEEN_TYPES };

  test('names her ticked questions word for word instead of asking the writer to choose', () => {
    const user = Gen.buildUserPrompt({ ...ARGS, seenPicked: PICKS });
    expect(user).toContain('What do plants need to grow?');
    expect(user).toContain('Plants can walk. True or false?');
    expect(user).toMatch(/word for word/);
    expect(user).not.toMatch(/turn other exercise content/);
  });

  test('without seenPicked the prompt is exactly today\'s', () => {
    expect(Gen.buildUserPrompt({ ...ARGS, seenPicked: null })).toBe(Gen.buildUserPrompt(ARGS));
  });
});

describe('grades 6-12: the free generator writes her picks into its prompt', () => {
  const mockCreate = jest.fn();
  test('the user prompt lists the picked question', async () => {
    jest.resetModules();
    ['config/supabase', 'services/assessment/book-content.service', 'services/assessment/assessment-generation.service']
      .forEach((m) => jest.dontMock(`../../bot/shared/${m}`));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: () => ({ chat: { completions: { create: mockCreate } } }),
      modelInForce: (job, site) => site,
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const Svc = require('../../bot/shared/services/assessment/free-secondary.service');
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ seen: { subjective: { short_answer: [
      { question: 'Define matter.', answer: 'Anything with mass.', marks: 2, lines: 2 }] } } }) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    await Svc.generateExam({
      grade: 7, subject: 'general_science', pageContent: '=== Page 2 ===\nDefine matter.', pageReference: '2',
      contentSource: 'seen', questionCount: 1, questionTypes: [], includeAnswerKey: true,
      seenTypes: [{ id: 'short_answer', count: 1, category: 'subjective' }],
      seenPicked: [{ chapter: 1, ref: 'Q1', text: 'Define matter.', type: 'short_answer' }],
    }).catch(() => {});
    expect(mockCreate.mock.calls[0][0].messages[1].content).toMatch(/Seen short_answer — 1:\n\s+- Define matter\./);
  });
});
