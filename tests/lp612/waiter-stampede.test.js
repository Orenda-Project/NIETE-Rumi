/**
 * The stampede that promised twenty teachers a lesson and delivered it to two.
 *
 * MEASURED ON STAGING (bd-phdqv load study, reproduced 2026-09-03): twenty concurrent taps on one
 * uncached lesson. All twenty were told *"That lesson plan is already being written — I will send
 * it here as soon as it is ready."* **Two waiters persisted. Eighteen were dropped.** The loss
 * curve is 80/90/95/90% at N = 5/10/20/40, and it is worst on the most popular lesson, which is
 * exactly the one a whole staffroom taps at once.
 *
 * The cause was a read-modify-write of a JSONB column:
 *
 *     const next = [...list, waiterEntry(req)];        // `list` read moments earlier
 *     await supabase.from(RENDERS).update({ waiters: next }).eq('id', renderId);
 *
 * Every concurrent caller read the same array, appended itself, and wrote a one-element array
 * back. Last write wins; the other nineteen vanish. Nothing errors, nothing logs, and the
 * teacher's ack has already gone out — so the failure is invisible on both sides.
 *
 * V1.2.8's own comment predicted this and mis-sized it: *"Two teachers joining a waiter list in
 * the same millisecond could have one overwrite the other's entry… Low likelihood, non-silent."*
 * It is neither low-likelihood nor non-silent. The measurement is what settled it.
 *
 * THE FIX IS ATOMICITY, NOT RETRY. `lp612_join_waiters()` appends inside ONE statement, so the
 * row lock serialises concurrent appends and each one re-reads `waiters` under that lock. There is
 * no window to lose.
 *
 * It also closes a SECOND race nobody had named: the render can finish between the read and the
 * append. The worker clears `waiters` when it delivers, so a waiter appended one millisecond later
 * was attached to a run that was already over — and that teacher waited for ever. The function
 * refuses to append unless the row is still `authoring`, and says so, so the caller serves the
 * finished lesson instead of joining a corpse.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockQueueJob = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockSegmentById = jest.fn();
const mockRpc = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage, sendDocumentByLink: mockSendDocumentByLink,
}));
jest.mock('../../bot/shared/services/queue', () => ({ __isQueueSingleton: true, queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: mockGetPresignedUrl, buildR2PublicUrl: (k) => `https://r2/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: mockSegmentById }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbResults = [];
const mockDbCalls = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b, eq: () => b, lt: () => b, in: () => b,
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const SEGMENT = {
  segment_id: 'grade_10_biology.c01.p012-012', book_stem: 'grade_10_biology', grade: 10,
  subject: 'Biology', subtopic_title: 'Digestion', menu_title: 'Digestion',
  printed_page_start: 12, printed_page_end: 12, is_religious: false,
};
const REQ = { userId: 'u1', phone: '923001234567', lang: 'en', correlationId: 'c1' };
const liveRender = (over = {}) => ({
  id: 'r1', status: 'authoring', r2_key: null, waiters: [], error_code: null,
  started_at: new Date().toISOString(), one_screen: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbResults.length = 0; mockDbCalls.length = 0;
  mockSendMessage.mockReset(); mockSendDocumentByLink.mockReset(); mockQueueJob.mockReset();
  mockRpc.mockReset().mockResolvedValue({ data: 'joined', error: null });
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockGetPresignedUrl.mockResolvedValue('https://signed/x.pdf');
  process.env.LP_612_TEMPLATE_VERSION = 'v9.1';
  process.env.LP612_AUTHOR_TIMEOUT_MS = '720000';
});

describe('joining a run in flight is ATOMIC — no read-modify-write', () => {
  test('the append goes through the database function, not a client-side array write', async () => {
    mockDbResults.push({ data: liveRender(), error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockRpc).toHaveBeenCalledWith('lp612_join_waiters', expect.objectContaining({
      p_render_id: 'r1',
    }));
    // The defect, asserted as gone: nothing may write the whole waiters array back.
    const waiterWrites = mockDbCalls.filter((c) => c.op === 'update' && c.payload && 'waiters' in c.payload);
    expect(waiterWrites).toEqual([]);
  });

  test('the entry carries the phone — delivery needs it, and it is the dedup key', async () => {
    mockDbResults.push({ data: liveRender(), error: null });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    const entry = mockRpc.mock.calls[0][1].p_entry;
    expect(entry.phone).toBe(REQ.phone);
  });

  test('tapping twice is a duplicate, not a second delivery — and she is still told', async () => {
    mockRpc.mockResolvedValue({ data: 'duplicate', error: null });
    mockDbResults.push({ data: liveRender(), error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockSendMessage).toHaveBeenCalled();
  });
});

describe('the race nobody had named: the run finishes while she is joining', () => {
  test('a render that completed mid-join SERVES her instead of parking her on a dead list', async () => {
    // The worker clears `waiters` when it delivers. A waiter appended a millisecond later is
    // attached to a run that is already over, and that teacher waits for ever.
    mockRpc.mockResolvedValue({ data: 'not_authoring', error: null });
    mockDbResults.push({ data: liveRender(), error: null });                    // first read: authoring
    mockDbResults.push({ data: liveRender({ status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf' }), error: null }); // re-read: ready

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  test('it does not loop for ever if the row keeps changing under it', async () => {
    mockRpc.mockResolvedValue({ data: 'not_authoring', error: null });
    for (let i = 0; i < 6; i++) mockDbResults.push({ data: liveRender(), error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out).toBeTruthy();
    expect(mockRpc.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('an RPC failure is not silent', () => {
  test('a database error still tells her something rather than dropping her', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockDbResults.push({ data: liveRender(), error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(mockSendMessage).toHaveBeenCalled();
    expect(out.outcome).toBeTruthy();
  });
});
