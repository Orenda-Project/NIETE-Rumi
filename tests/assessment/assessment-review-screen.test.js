/**
 * The REVIEW screen — where she unticks questions.
 *
 * She reaches this screen holding a finished paper, so the token that opens it
 * names a PAPER, not a half-built request. That is the difference from every
 * other screen in this Flow and it is where the risks are:
 *
 *   · the token is a bearer credential, so the paper must be checked against the
 *     user, not just fetched by id;
 *   · her ticks have to survive a page turn, because Meta renders at most 20
 *     options and real papers run to 64 questions;
 *   · unticking everything is a thing she can do, and must not produce a blank
 *     paper or a silent "all".
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockRerender = jest.fn();
const mockListQuestions = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/assessment-revision.service', () => ({
  rerender: (...a) => mockRerender(...a),
  listQuestions: (...a) => mockListQuestions(...a),
}));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const { handleAssessmentGenInit: init, handleAssessmentGenDataExchange: exchange } = Endpoint;

const ITEMS = Array.from({ length: 28 }, (_, i) => ({
  id: `seen.objective.MCQs.${i}`,
  number: i + 1,
  marks: 1,
  type: 'MCQs',
  text: `Question number ${i + 1}`,
  selected: true,
}));

const REVIEW_TOKEN = 'user-1:assessment-review:paper-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue(true);
  mockListQuestions.mockResolvedValue({ items: ITEMS, paper: { id: 'paper-1' } });
  mockRerender.mockResolvedValue({ status: 'ready', questionCount: 3, marks: 3 });
});

describe('opening the review', () => {
  test('a review token lands on REVIEW, not on CLASS', async () => {
    const res = await init('user-1', REVIEW_TOKEN);
    expect(res.screen).toBe('REVIEW');
  });

  test('a normal token still starts a new paper', async () => {
    // `textbooks` is read as .select().eq('curriculum').eq('grade') in one place
    // and .select().eq('curriculum') in another, so the mock has to be thenable
    // at BOTH depths — otherwise this passes for the wrong reason.
    const rows = { data: [{ grade: 4, subject: 'science' }], error: null };
    const node = () => {
      const n = { eq: () => node(), then: (r) => Promise.resolve(rows).then(r) };
      return n;
    };
    mockSupabase.from.mockImplementation(() => ({ select: () => node() }));
    const res = await init('user-1', 'user-1:assessment-gen:123');
    expect(res.screen).toBe('CLASS');
  });

  test('shows only one screenful, because Meta renders at most 20', async () => {
    const res = await init('user-1', REVIEW_TOKEN);
    expect(res.data.questions.length).toBeLessThanOrEqual(20);
    expect(res.data.has_next).toBe(true);
    expect(res.data.has_prev).toBe(false);
  });

  test('every question starts ticked — she is removing, not choosing from scratch', async () => {
    const res = await init('user-1', REVIEW_TOKEN);
    expect(res.data.selected).toEqual(res.data.questions.map((q) => q.id));
  });

  test('says where she is in the paper', async () => {
    const res = await init('user-1', REVIEW_TOKEN);
    expect(res.data.progress).toContain('28');
  });

  test("a paper that is not hers does not open", async () => {
    mockListQuestions.mockResolvedValue({ code: 'NOT_FOUND' });
    const res = await init('user-2', REVIEW_TOKEN);
    expect(res.screen).toBe('REVIEW');
    expect(res.data.has_error).toBe(true);
    expect(res.data.questions).toEqual([]);
  });
});

describe('paging keeps her ticks', () => {
  test('turning the page remembers what she unticked on the page she left', async () => {
    await init('user-1', REVIEW_TOKEN);
    // She unticks Q1 and Q2, then pages forward.
    const kept = ITEMS.slice(0, 20).map((q) => q.id).filter(
      (id) => !['seen.objective.MCQs.0', 'seen.objective.MCQs.1'].includes(id));
    const res = await exchange('user-1', 'REVIEW',
      { keep: kept, page: '0', action: 'next' }, REVIEW_TOKEN);

    expect(res.screen).toBe('REVIEW');
    expect(res.data.progress).toContain('21');
    const saved = JSON.parse(JSON.stringify(mockRedis.set.mock.calls.at(-1)[1]));
    expect(saved.selected).not.toContain('seen.objective.MCQs.0');
    expect(saved.selected).toContain('seen.objective.MCQs.2');
  });

  test('paging back does not resurrect what she unticked', async () => {
    await init('user-1', REVIEW_TOKEN);
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 1,
      selected: ITEMS.map((q) => q.id).filter((id) => id !== 'seen.objective.MCQs.0'),
    });
    const res = await exchange('user-1', 'REVIEW',
      { keep: ITEMS.slice(20).map((q) => q.id), page: '1', action: 'prev' }, REVIEW_TOKEN);
    expect(res.data.selected).not.toContain('seen.objective.MCQs.0');
    expect(res.data.progress).toContain('1');
  });

  test('a tick on a LATER page is not wiped by submitting from an earlier one', async () => {
    // The bug this pins: treating `keep` as the whole answer rather than as the
    // answer for the page she is on would silently drop every question she never
    // scrolled to.
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0,
      selected: ITEMS.map((q) => q.id),
    });
    await exchange('user-1', 'REVIEW',
      { keep: ITEMS.slice(0, 20).map((q) => q.id), page: '0', action: 'done' }, REVIEW_TOKEN);
    const sent = mockRerender.mock.calls[0][0].selectedIds;
    expect(sent).toHaveLength(28);
  });
});

describe('submitting', () => {
  test('sends only what is still ticked, and ends on SUBMITTED', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ITEMS.map((q) => q.id),
    });
    const keep = ITEMS.slice(0, 20).map((q) => q.id).slice(0, 3);
    const res = await exchange('user-1', 'REVIEW',
      { keep, page: '0', action: 'done' }, REVIEW_TOKEN);

    expect(res.screen).toBe('SUBMITTED');
    const sent = mockRerender.mock.calls[0][0];
    expect(sent.paperId).toBe('paper-1');
    expect(sent.userId).toBe('user-1');
    // 3 kept on page 1, plus the 8 on page 2 she never touched.
    expect(sent.selectedIds).toHaveLength(3 + 8);
  });

  test('unticking everything is refused ON THE SCREEN, not sent as a blank paper', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: [],
    });
    const res = await exchange('user-1', 'REVIEW',
      { keep: [], page: '0', action: 'done' }, REVIEW_TOKEN);

    expect(res.screen).toBe('REVIEW');
    expect(res.data.has_error).toBe(true);
    expect(mockRerender).not.toHaveBeenCalled();
  });

  test('a re-render failure is told to her, not swallowed into a success screen', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ITEMS.map((q) => q.id),
    });
    mockRerender.mockResolvedValue({ status: 'failed', code: 'RENDER_FAILED' });
    const res = await exchange('user-1', 'REVIEW',
      { keep: ITEMS.slice(0, 20).map((q) => q.id), page: '0', action: 'done' }, REVIEW_TOKEN);

    // The terminal screen is shared between success and failure, so all three
    // lines must be data — a half-bound screen once showed a success heading
    // above a failure message.
    expect(res.screen).toBe('SUBMITTED');
    expect(res.data.heading).not.toMatch(/ready|making/i);
  });
});
