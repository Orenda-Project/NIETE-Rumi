/**
 * A lesson that says "preparing" forever.
 *
 * MEASURED ON STAGING, 2026-09-03: a deploy restarted the worker mid-authoring. The SQS message
 * was never acked and dead-lettered after 3 receives (DLQ held 4); the render row was left at
 * `status='authoring'` with no error_code, and stayed there. Nothing resets such a row — the
 * worker sweeps stale lesson-plan requests, video requests and exam sessions, but nobody gave
 * niete_lp612_renders a sweep.
 *
 * The consequence is the worst kind of failure this lane can have. `requestLesson` reads
 * `authoring` as "someone else is already paying for this one", so EVERY later tap joins a run
 * that is never coming back. The teacher is told her lesson is being written, and it never
 * arrives — no error, no retry, no way out. Silent and permanent.
 *
 * NIETE deploys on every merge to `develop`, so this needs exactly one unlucky deploy.
 *
 * Two independent recoveries are asserted here, because either alone leaves a hole:
 *   TAP  — a tap on a stale run restarts it instead of joining it. Fixes the teacher in front of
 *          us, and needs no scheduler.
 *   SWEEP— a reaper transitions stale rows to `failed` even if nobody taps, so the row is not
 *          still lying about its state when the NEXT teacher arrives.
 *
 * And per rule 24(d), a stranded run gets its OWN user-facing sentence. One shared fallback
 * across distinct states is how a whole fix cycle gets aimed at the wrong layer.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockQueueJob = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage, sendDocumentByLink: mockSendDocumentByLink,
}));
const queueModule = { __isQueueSingleton: true, queueJob(...a) { return mockQueueJob(...a); } };
jest.mock('../../bot/shared/services/queue', () => queueModule);
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: mockGetPresignedUrl, buildR2PublicUrl: (k) => `https://r2/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: mockSegmentById }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    lt: (c, v) => { state.filters.push(['lt:' + c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const { isStrandedAuthoring } = Serving;

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008', book_stem: 'grade_9_chemistry', grade: 9,
  subject: 'Chemistry', subtopic_title: 'Branches', menu_title: 'Branches',
  printed_page_start: 7, printed_page_end: 8, is_religious: false,
};
const REQ = { userId: 'u1', phone: '923001234567', lang: 'en', correlationId: 'c1' };

const agoMs = (ms) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0; mockDbResults.length = 0;
  mockSendMessage.mockReset(); mockSendDocumentByLink.mockReset(); mockQueueJob.mockReset();
  mockSegmentById.mockResolvedValue(SEGMENT);
  process.env.LP_612_TEMPLATE_VERSION = 'v9.1';
  process.env.LP612_AUTHOR_TIMEOUT_MS = '720000';   // 12 min
});

// ── the discriminator ───────────────────────────────────────────────────────

describe('telling a live run from a corpse', () => {
  test('a run inside its timeout is LIVE', () => {
    expect(isStrandedAuthoring({ status: 'authoring', started_at: agoMs(60 * 1000) })).toBe(false);
  });

  test('a run past the timeout plus grace is STRANDED', () => {
    expect(isStrandedAuthoring({ status: 'authoring', started_at: agoMs(30 * 60 * 1000) })).toBe(true);
  });

  test('the grace period means we do not shoot a run that is merely slow', () => {
    // The worker's own hard stop is 12 min. A row at 12m30s may still be finishing its upload,
    // and killing it would author the same lesson twice at ~$0.60 a go.
    expect(isStrandedAuthoring({ status: 'authoring', started_at: agoMs(12.5 * 60 * 1000) })).toBe(false);
  });

  test('only `authoring` rows can be stranded', () => {
    expect(isStrandedAuthoring({ status: 'ready', started_at: agoMs(60 * 60 * 1000) })).toBe(false);
    expect(isStrandedAuthoring({ status: 'failed', started_at: agoMs(60 * 60 * 1000) })).toBe(false);
  });

  test('a row with no started_at is not assumed dead', () => {
    expect(isStrandedAuthoring({ status: 'authoring', started_at: null })).toBe(false);
  });
});

// ── recovery 1: the tap ─────────────────────────────────────────────────────

describe('a tap on a stranded run restarts it instead of joining it', () => {
  test('it re-enqueues rather than adding a waiter to a dead run', async () => {
    mockDbResults.push({
      data: {
        id: 'r1', status: 'authoring', r2_key: null, waiters: [{ user_id: 'someone-else' }],
        error_code: null, started_at: agoMs(30 * 60 * 1000), one_screen: null,
      },
      error: null,
    });
    mockDbResults.push({ data: null, error: null });   // the reset

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('retry');
    expect(mockQueueJob).toHaveBeenCalledTimes(1);
  });

  test('she is told the run restarted — NOT the generic "already being written"', async () => {
    // Rule 24(d): one shared sentence across distinct states misdirects every field report.
    // "It is already being written" on a corpse is the sentence that made this invisible.
    mockDbResults.push({
      data: {
        id: 'r1', status: 'authoring', r2_key: null, waiters: [],
        error_code: null, started_at: agoMs(30 * 60 * 1000), one_screen: null,
      },
      error: null,
    });
    mockDbResults.push({ data: null, error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const sent = mockSendMessage.mock.calls.map((c) => c[1]).join(' ');
    expect(sent).not.toMatch(/already being written/i);
    expect(sent).toMatch(/again/i);
  });

  test('a LIVE run is still joined, and nothing is re-enqueued', async () => {
    // The whole point of the unique constraint is that two teachers do not pay twice.
    mockDbResults.push({
      data: {
        id: 'r1', status: 'authoring', r2_key: null, waiters: [],
        error_code: null, started_at: agoMs(60 * 1000), one_screen: null,
      },
      error: null,
    });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockQueueJob).not.toHaveBeenCalled();
  });
});

// ── recovery 2: the sweep ───────────────────────────────────────────────────

describe('the reaper, for when nobody taps', () => {
  test('it transitions stranded rows to failed with a NAMED code', async () => {
    mockDbResults.push({
      data: [{ id: 'r1', segment_id: 's1', started_at: agoMs(30 * 60 * 1000) }],
      error: null,
    });
    mockDbResults.push({ data: null, error: null });

    const n = await Serving.reapStrandedRenders();

    expect(n).toBe(1);
    const patch = mockDbCalls.find((c) => c.op === 'update');
    expect(patch.payload.status).toBe('failed');
    // A distinct code, so "how often does a deploy strand a lesson?" is answerable by query
    // rather than by reading logs that have rolled off.
    expect(patch.payload.error_code).toBe('AUTHOR_STRANDED');
  });

  test('it reaps nothing when there is nothing stale', async () => {
    mockDbResults.push({ data: [], error: null });
    expect(await Serving.reapStrandedRenders()).toBe(0);
  });

  test('a read failure returns 0 rather than throwing into the sweep loop', async () => {
    mockDbResults.push({ data: null, error: { message: 'boom' } });
    expect(await Serving.reapStrandedRenders()).toBe(0);
  });
});
