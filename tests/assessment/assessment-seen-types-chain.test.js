/**
 * bd-e5n2jf — the teacher's per-type Seen counts (`seenTypes`) reach the generator on every path:
 * request service → queued job → orchestrator → generateExam (grades 1-5) and the grades 6-12
 * free generator. A job without seenTypes carries no new key at all, so old jobs are unchanged.
 */
const SEEN_TYPES = [
  { id: 'MCQs', count: 3, category: 'objective' },
  { id: 'True/False', count: 2, category: 'objective' },
];

describe('seenTypes survives the chain', () => {
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
    contentSource: 'seen', questionCount: 5, questionTypes: [] };

  test('the request service puts seenTypes on the job payload', async () => {
    const Req = loadRequestService();
    await Req.createAndQueue({ ...REQUEST, seenTypes: SEEN_TYPES });
    expect(mockQueueJob.mock.calls[0][2].seenTypes).toEqual(SEEN_TYPES);
  });

  test('a request without seenTypes adds no key to the job', async () => {
    const Req = loadRequestService();
    await Req.createAndQueue(REQUEST);
    expect('seenTypes' in mockQueueJob.mock.calls[0][2]).toBe(false);
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
      contentSource: 'seen', questionCount: 5, questionTypes: [], ...job }).catch(() => {});
    return handed;
  };

  test('the orchestrator hands seenTypes to generateExam', async () => {
    const handed = await runOrchestrator({ seenTypes: SEEN_TYPES });
    expect(handed).toHaveLength(1);
    expect(handed[0].seenTypes).toEqual(SEEN_TYPES);
  });

  test('an old job hands generateExam no seenTypes key', async () => {
    const handed = await runOrchestrator({});
    expect(handed).toHaveLength(1);
    expect('seenTypes' in handed[0]).toBe(false);
  });
});

describe('grades 6-12: the free generator asks for and keeps her Seen counts', () => {
  const mockCreate = jest.fn();
  const load = () => {
    jest.resetModules();
    mockCreate.mockReset();
    ['config/supabase', 'services/assessment/book-content.service', 'services/assessment/assessment-generation.service']
      .forEach((m) => jest.dontMock(`../../bot/shared/${m}`));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: () => ({ chat: { completions: { create: mockCreate } } }),
      modelInForce: (job, site) => site,
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    return require('../../bot/shared/services/assessment/free-secondary.service');
  };
  const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];
  const mcq = (i) => ({ question: `Which one dissolves in water? (${i})`, options: OPTS.slice(), answer: 'd) Salt', marks: 1, lines: 0 });
  const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

  test('the prompt names the Seen count per type and the paper is cut to it', async () => {
    const Svc = load();
    // The model keys MCQs by name, not by the id `mcq`: the trim must still count them as MCQs.
    mockCreate.mockResolvedValue(reply({ seen: { objective: { 'Multiple Choice Questions': [1, 2, 3, 4].map(mcq) } } }));
    const out = await Svc.generateExam({
      grade: 7, subject: 'general_science', pageContent: '=== Page 2 ===\nA fictional page about matter.',
      pageReference: '2-4', contentSource: 'seen', questionCount: 2, questionTypes: [], includeAnswerKey: true,
      seenTypes: [{ id: 'mcq', label: 'Multiple Choice Questions', count: 2, category: 'objective' }],
    });
    const user = mockCreate.mock.calls[0][0].messages[1].content;
    expect(user).toMatch(/Seen Objective questions — 2 Multiple Choice Questions/);
    expect(out.examJson.seen.objective['Multiple Choice Questions']).toHaveLength(2);
    expect(out.plan.seenTypes).toHaveLength(1);
  });
});
