/**
 * bd-bfnsk — the answer key is no longer a choice (operator decision, 30 Sep 2026).
 *
 * It was an OptIn on the generator Flow's CONFIRM screen and a checkbox on the
 * portal, and the flag it set did two things: it told the model NOT to write
 * answers, and it told the worker not to send a key. So 148 of the last 200
 * prod papers were generated with no answers at all, and any key made for them
 * later was a column of dashes. Every paper now gets answers and a key; the
 * teacher is not asked.
 *
 * The same screen also carried "Lines for the answers", an OptIn with no
 * initial value — it SHOWED unticked while the server treated a missing value
 * as on. The screen now opens ticked, and an explicit untick is still honoured.
 *
 * Pinned here: the Flow JSON, the endpoint's two submit paths, and the one
 * place a request becomes a row + a job.
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
const mockListChapters = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: (...a) => mockListChapters(...a),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/assessment-format'),
  resolveFormat: jest.fn(async () => 'pdf'),
}));

const FLOW = require('../../docs/flows/assessment-gen-flow.json');
const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const Request = require('../../bot/shared/services/assessment/assessment-request.service');

const BOOK = { id: 'book-uuid', total_pages: 166 };
const CHAPTERS = [{ chapterNumber: 1, title: 'Hello World!', pageStart: 4, pageEnd: 14 }];
let inserted;

function wireDb() {
  inserted = null;
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'textbooks') {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: BOOK, error: null }),
      }) }) }) }) };
    }
    if (table === 'assessment_requests') {
      return {
        insert: (row) => {
          inserted = row;
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

const SESSION = {
  userId: 'u1', grade: 1, subject: 'english',
  chapterNumber: 1, chapterTitle: 'Hello World!', pageRanges: null,
  questionCount: 10, contentSource: 'unseen',
};

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
  mockListChapters.mockResolvedValue(CHAPTERS);
  mockRedis.get.mockResolvedValue({ ...SESSION });
  mockRedis.set.mockResolvedValue(true);
  mockRedis.delete.mockResolvedValue(true);
});

const confirm = () => FLOW.screens.find((s) => s.id === 'CONFIRM');
const walk = (node, visit) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') { visit(node); Object.values(node).forEach((v) => walk(v, visit)); }
};

describe('the generator Flow no longer asks about an answer key', () => {
  it('has no answer_key component anywhere in the Flow', () => {
    const names = [];
    walk(FLOW, (n) => { if (n.name) names.push(n.name); });
    expect(names).not.toContain('answer_key');
  });

  it('the CONFIRM footer no longer sends an answer_key', () => {
    let payload = null;
    walk(confirm(), (n) => { if (n.type === 'Footer') payload = n['on-click-action'].payload; });
    expect(payload).toBeTruthy();
    expect(payload).not.toHaveProperty('answer_key');
    expect(payload).toHaveProperty('answer_lines', '${form.answer_lines}');
  });

  it('opens with "Lines for the answers" ticked, and still lets her untick it', () => {
    let form = null;
    let optIn = null;
    walk(confirm(), (n) => {
      if (n.type === 'Form') form = n;
      if (n.type === 'OptIn' && n.name === 'answer_lines') optIn = n;
    });
    expect(optIn).toBeTruthy();
    expect(form['init-values']).toMatchObject({ answer_lines: true });
    // An OptIn she cannot change would be a statement, not a choice.
    expect(optIn.required).not.toBe(true);
  });
});

describe('every request is made with an answer key', () => {
  it('createAndQueue writes has_answer_key=true and queues includeAnswerKey=true even when told false', async () => {
    await Request.createAndQueue({
      userId: 'u1', surface: 'portal', grade: 1, subject: 'english', textbookId: 'b',
      chapterNumber: 1, pageRanges: '4-14', questionCount: 5,
      questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }],
      includeAnswerKey: false,
    });
    expect(inserted.has_answer_key).toBe(true);
    expect(mockQueueJob.mock.calls[0][2].includeAnswerKey).toBe(true);
  });

  it('the Flow completion path queues a key with no answer_key in the response', async () => {
    const out = await Endpoint.submitFromCompletion({
      flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf',
    });
    expect(out.status).toBe('queued');
    expect(inserted.has_answer_key).toBe(true);
    expect(mockQueueJob.mock.calls[0][2].includeAnswerKey).toBe(true);
  });

  it('a stale client still posting answer_key=false gets a key anyway', async () => {
    await Endpoint.submitFromCompletion({
      flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', answerKey: false,
    });
    expect(mockQueueJob.mock.calls[0][2].includeAnswerKey).toBe(true);
  });
});

describe('answer lines: on by default, off only when she unticks them', () => {
  it.each([
    ['missing', undefined, true],
    ['true', true, true],
    ['"true"', 'true', true],
    ['false', false, false],
    ['"false"', 'false', false],
  ])('answer_lines %s → has_answer_lines=%p', async (_label, value, want) => {
    await Endpoint.submitFromCompletion({
      flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', answerLines: value,
    });
    expect(inserted.has_answer_lines).toBe(want);
    expect(mockQueueJob.mock.calls[0][2].answerLines).toBe(want);
  });

  it('the data-exchange CONFIRM path honours the same rule', async () => {
    const { handleAssessmentGenDataExchange: exchange } = Endpoint;
    await exchange('u1', 'CONFIRM', { output_format: 'pdf' }, 'u1:assessment');
    expect(inserted.has_answer_lines).toBe(true);
    expect(inserted.has_answer_key).toBe(true);
    await exchange('u1', 'CONFIRM', { output_format: 'pdf', answer_lines: false }, 'u1:assessment');
    expect(inserted.has_answer_lines).toBe(false);
    expect(inserted.has_answer_key).toBe(true);
  });
});
