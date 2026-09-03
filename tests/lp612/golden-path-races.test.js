/**
 * The serving path under CONCURRENCY — the races that survive an atomic append.
 *
 * V1.3.2 made the waiter APPEND atomic, and the stranded-render reaper made a corpse recoverable.
 * Neither closes the four holes below, each of which ends the same way for the teacher: she is
 * told her lesson is being written, and nothing ever arrives.
 *
 *  1. THE INSERT-RACE LOSER IGNORES THE ANSWER. `joinWaiters` returns
 *     joined|duplicate|not_authoring|missing for a reason, and the in-flight path honours it. The
 *     23505 path threw it away: if the winner's row moved to ready/failed between the failed
 *     insert and the append, NO waiter was appended, and she was still told "already being
 *     written" and reported as joined. There is nothing left to deliver her lesson.
 *
 *  2. A READ FAILURE LOOKED LIKE AN ABSENT ROW. `findRender` returned null for both, so a
 *     transient error on the main lookup fell through to an INSERT for a row that exists, and on
 *     the 23505 path it turned the one thing we know for certain — a unique violation is PROOF the
 *     winner's row is there — into "it failed", with no waiter appended.
 *
 *  3. THE RETRY/RESET WAS NOT A COMPARE-AND-SWAP. Two taps on one failed or stranded row both
 *     matched `.eq('id', …)`, both wrote status='authoring', and both enqueued: two authoring runs
 *     for one lesson, about $1.50 and several minutes each — precisely what the unique constraint
 *     exists to prevent. The reset also wrote `waiters: [me]` wholesale, evicting anyone already
 *     waiting on a stranded run.
 *
 *  4. THE FIFO DEDUP ID DID NOT NAME THE LESSON. The id was `${groupId}-${jobType}-${Date.now()}`
 *     and lp612 passes groupId = segmentId alone, so the en job and the ur job for one segment
 *     shared every component but the millisecond. A same-millisecond collision drops an entirely
 *     DIFFERENT lesson's job, silently, for the whole 5-minute dedup window.
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
jest.mock('../../bot/shared/services/queue', () => ({
  __isQueueSingleton: true, queueJob: (...a) => mockQueueJob(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: mockGetPresignedUrl, buildR2PublicUrl: (k) => `https://r2/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: mockSegmentById }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbResults = [];
const mockDbCalls = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [], selected: null };
  const settle = () => {
    mockDbCalls.push({ ...state, filters: [...state.filters] });
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: (c) => { state.selected = c || null; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    lt: (c, v) => { state.filters.push([`lt:${c}`, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
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

const render = (over = {}) => ({
  id: 'r1', status: 'authoring', r2_key: null, waiters: [], error_code: null,
  started_at: new Date().toISOString(), one_screen: null, overlay_dropped: false, ...over,
});

const ABSENT = { data: null, error: null };
const READ_ERROR = { data: null, error: { message: 'connection reset by peer' } };
const UNIQUE_VIOLATION = { data: null, error: { code: '23505', message: 'duplicate key value' } };

const updates = () => mockDbCalls.filter((c) => c.op === 'update');
const inserts = () => mockDbCalls.filter((c) => c.op === 'insert');
const joinCalls = () => mockRpc.mock.calls.filter((c) => c[0] === 'lp612_join_waiters');

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

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 2 — the insert-race loser must honour the RPC's answer
// ───────────────────────────────────────────────────────────────────────────

describe('losing the insert race: the append answer is READ, not discarded', () => {
  test('a winner that finished mid-append SERVES her instead of reporting a phantom join', async () => {
    // She lost the 23505 race, and by the time her append ran the winner had already delivered
    // and cleared `waiters`. Parking her on that list means waiting for ever for a job that is
    // over — and the lesson she is owed is sitting in R2 right now.
    mockRpc.mockResolvedValue({ data: 'not_authoring', error: null });
    mockDbResults.push(ABSENT);                                                  // no row yet
    mockDbResults.push(UNIQUE_VIOLATION);                                        // lost the insert
    mockDbResults.push({ data: render(), error: null });                         // winner, authoring
    mockDbResults.push({                                                         // re-decide: ready
      data: render({ status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf' }), error: null,
    });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  test('a winner row that vanished under her is re-decided, not reported as joined', async () => {
    mockRpc.mockResolvedValue({ data: 'missing', error: null });
    mockDbResults.push(ABSENT);
    mockDbResults.push(UNIQUE_VIOLATION);
    mockDbResults.push({ data: render(), error: null });
    mockDbResults.push(ABSENT);                                                  // re-decide: gone
    mockDbResults.push({ data: { id: 'r2' }, error: null });                     // fresh claim

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('queued');
    expect(mockQueueJob).toHaveBeenCalledTimes(1);
  });

  test('a transient RPC error is retried rather than dropping her silently', async () => {
    // 'error' means we do not know whether she is on the list. She was told "already being
    // written" regardless, and if the append never landed nothing will ever deliver to her.
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } })
      .mockResolvedValueOnce({ data: 'joined', error: null });
    mockDbResults.push(ABSENT);
    mockDbResults.push(UNIQUE_VIOLATION);
    mockDbResults.push({ data: render(), error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(joinCalls().length).toBe(2);
  });

  test('the in-flight path and the race-loser path give the SAME answer to the same signal', async () => {
    // One behaviour, one implementation. These drifted apart precisely because they were two
    // copies of "join and tell her".
    const run = async () => {
      mockDbResults.length = 0; mockDbCalls.length = 0;
      mockRpc.mockReset().mockResolvedValue({ data: 'not_authoring', error: null });
      mockSendDocumentByLink.mockReset();
    };

    await run();
    mockDbResults.push({ data: render(), error: null });                         // in-flight path
    mockDbResults.push({ data: render({ status: 'ready', r2_key: 'k' }), error: null });
    const viaInflight = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    await run();
    mockDbResults.push(ABSENT);                                                  // race-loser path
    mockDbResults.push(UNIQUE_VIOLATION);
    mockDbResults.push({ data: render(), error: null });
    mockDbResults.push({ data: render({ status: 'ready', r2_key: 'k' }), error: null });
    const viaRace = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(viaRace.outcome).toBe(viaInflight.outcome);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 3 — "no row" and "the read failed" are different answers
// ───────────────────────────────────────────────────────────────────────────

describe('a failed read is not an absent row', () => {
  test('a transient error on the main lookup does not claim a row that may already exist', async () => {
    mockDbResults.push(READ_ERROR);

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(inserts()).toEqual([]);
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(out.outcome).toBe('error');
    expect(mockSendMessage).toHaveBeenCalled();
  });

  test('a 23505 is PROOF the winner exists, so a failed re-read is retried, not given up on', async () => {
    mockDbResults.push(ABSENT);
    mockDbResults.push(UNIQUE_VIOLATION);
    mockDbResults.push(READ_ERROR);                                              // re-read blips
    mockDbResults.push({ data: render(), error: null });                         // retry finds it

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(joinCalls().length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 4 — the retry/reset must be a compare-and-swap
// ───────────────────────────────────────────────────────────────────────────

describe('restarting a failed or stranded render: exactly ONE tap may win', () => {
  const failedRow = () => render({ status: 'failed', error_code: 'AUTHOR_LLM_FAILED' });

  test('the reset is guarded on the state it read, not on the id alone', async () => {
    mockDbResults.push({ data: failedRow(), error: null });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });                   // CAS won

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const reset = updates().find((c) => c.payload && c.payload.status === 'authoring');
    expect(reset).toBeTruthy();
    // Without a guard on the status it read, two taps both match and both enqueue.
    expect(reset.filters).toContainEqual(['status', 'failed']);
  });

  test('the tap that LOSES the swap joins as a waiter and does NOT enqueue a second run', async () => {
    // Two authoring jobs for one lesson is ~$1.50 and several minutes thrown away, and the
    // second reset used to evict the first tapper from the waiter list on its way past.
    mockDbResults.push({ data: failedRow(), error: null });
    mockDbResults.push({ data: [], error: null });                               // CAS matched 0 rows

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(joinCalls().length).toBe(1);
    expect(out.outcome).toBe('joined');
  });

  test('a stranded row is swapped on started_at too — its status does not change across the reset', async () => {
    const strandedAt = new Date(Date.now() - (720000 + 4 * 60 * 1000)).toISOString();
    mockDbResults.push({ data: render({ status: 'authoring', started_at: strandedAt }), error: null });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const reset = updates().find((c) => c.payload && c.payload.status === 'authoring');
    // `status` alone cannot arbitrate here: it is 'authoring' before AND after the reset, so both
    // taps would match. started_at is the only thing that moves.
    expect(reset.filters).toContainEqual(['started_at', strandedAt]);
  });

  test('the reset PRESERVES anyone already waiting instead of overwriting the list', async () => {
    // A stranded run can have real teachers parked on it. `waiters: [me]` deleted them, and they
    // had already been told the lesson was on its way.
    const strandedAt = new Date(Date.now() - (720000 + 4 * 60 * 1000)).toISOString();
    mockDbResults.push({
      data: render({ started_at: strandedAt, waiters: [{ phone: '923009999999' }] }), error: null,
    });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const reset = updates().find((c) => c.payload && c.payload.status === 'authoring');
    expect(reset.payload).not.toHaveProperty('waiters');
    // …and the tapper still ends up on the list, through the atomic append.
    expect(joinCalls().length).toBe(1);
    expect(out.outcome).toBe('retry');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 5 — the FIFO dedup id must name the lesson
// ───────────────────────────────────────────────────────────────────────────

describe('the authoring job carries a dedup id that identifies THIS lesson', () => {
  const enqueueOpts = () => mockQueueJob.mock.calls[0][3] || {};

  const queueOne = async (lang, renderId) => {
    mockDbResults.push(ABSENT);
    mockDbResults.push({ data: { id: renderId }, error: null });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ, lang });
  };

  test('an explicit deduplicationId is passed rather than left to the shared default', async () => {
    await queueOne('en', 'render-en');
    expect(enqueueOpts().deduplicationId).toBeTruthy();
  });

  test('it contains the language and the render id — the two things groupId omits', async () => {
    await queueOne('ur', 'render-ur');
    const id = enqueueOpts().deduplicationId;
    expect(id).toContain('render-ur');
    expect(id).toContain('ur');
  });

  test('the en and the ur job for ONE segment can never collide', async () => {
    await queueOne('en', 'render-en');
    const enId = enqueueOpts().deduplicationId;

    mockQueueJob.mockReset();
    mockDbResults.length = 0; mockDbCalls.length = 0;
    await queueOne('ur', 'render-ur');
    const urId = enqueueOpts().deduplicationId;

    // Same segment, same jobType, same millisecond: under the old
    // `${groupId}-${jobType}-${Date.now()}` these two are the SAME string, and SQS drops the
    // second for five minutes — a different lesson, silently discarded.
    expect(enId).not.toBe(urId);
  });

  test('a RETRY of the same render is still enqueued — the id is not a permanent key', async () => {
    // The reset reuses the row, so renderId + lang alone would dedup the retry away inside the
    // 5-minute window and the teacher would wait for a job that was never queued.
    mockDbResults.push({ data: render({ status: 'failed' }), error: null });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    const first = mockQueueJob.mock.calls[0][3].deduplicationId;

    await new Promise((r) => setTimeout(r, 2));
    mockQueueJob.mockReset();
    mockDbResults.length = 0; mockDbCalls.length = 0;
    mockDbResults.push({ data: render({ status: 'failed' }), error: null });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    const second = mockQueueJob.mock.calls[0][3].deduplicationId;

    expect(second).not.toBe(first);
  });

  test('it stays inside SQS\'s 128-character cap', async () => {
    await queueOne('en', 'a'.repeat(200));
    expect(enqueueOpts().deduplicationId.length).toBeLessThanOrEqual(128);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The two INVESTIGATE questions, answered by assertion rather than by opinion
// ───────────────────────────────────────────────────────────────────────────

describe('the two languages of one segment are independent lessons', () => {
  test('a ready UR render is served while the EN render of the same segment is still authoring', async () => {
    // The cache lookup is keyed on (segment_id, lang, template_version), so an in-flight EN run
    // cannot hold up an UR cache hit. Asserted rather than assumed: the FIFO MessageGroupId IS
    // shared between the two, and it would be easy to conclude the DB layer shares it too.
    mockDbResults.push({
      data: render({ id: 'r-ur', status: 'ready', r2_key: 'lp612/v9.1/ur/x.pdf' }), error: null,
    });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ, lang: 'ur' });

    expect(out.outcome).toBe('cache_hit');
    const lookup = mockDbCalls[0];
    expect(lookup.filters).toContainEqual(['lang', 'ur']);
    expect(lookup.filters).toContainEqual(['segment_id', SEGMENT.segment_id]);
  });
});
