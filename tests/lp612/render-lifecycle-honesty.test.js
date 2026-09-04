/**
 * bd-dr216 / bd-w36m5 / bd-7yxsu — a render row must never lie about its own state.
 *
 * Three faults, one problem: `status` and `error_code` on `niete_lp612_renders` could each be
 * wrong, and could contradict each other.
 *
 * 1. bd-dr216 — THE REAPER CONDEMNED LESSONS NOBODY HAD ATTEMPTED. `started_at` is stamped by the
 *    INSERT's own `DEFAULT NOW()` (and re-stamped by the retry CAS), so it records when the job was
 *    ENQUEUED. `reapStrandedRenders` measured staleness from it. A job still WAITING in the SQS
 *    queue was therefore marked AUTHOR_STRANDED at ~17 min (LP612_AUTHOR_TIMEOUT_MS + 3 min grace)
 *    before any worker had touched it. Confirmed live 2026-09-04 07:42 on 2 of 16 coach taps, with
 *    measured p90 enqueue->done of 1023s sitting right on that boundary: under the current
 *    one-replica capacity fault (bd-nxkme) queueing alone crosses a threshold that was never meant
 *    to measure queueing.
 *
 * 2. bd-w36m5 — IT ALSO CONDEMNED ROWS A WORKER WAS LEGITIMATELY STILL AUTHORING. The SQS message
 *    is validly in flight the whole time: 900s of visibility, re-extended every 60s by the
 *    heartbeat PR #590 added (bd-awqt3), up to a ceiling of 2x the job's own hard timeout. The old
 *    17-minute window fired deep inside that envelope, so the row flipped `failed` and then back to
 *    `ready` when the worker finished (observed the same day: failed 20->15 while ready climbed).
 *    A reap window that is shorter than the window in which the owner is provably alive is not a
 *    corpse detector.
 *
 * 3. bd-7yxsu — A RECOVERED ROW KEPT ITS error_code. The worker's success patch never cleared it,
 *    so a healthy delivered lesson read as errored in every query anyone ran.
 *
 * The fix is one idea: SEPARATE THE TWO CLOCKS. `started_at` is when she asked; `picked_up_at` is
 * when a worker actually took the job. Queue wait is measured on the first and is not a failure;
 * run duration is measured on the second and its threshold is DERIVED from the SQS envelope rather
 * than guessed.
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
  const state = { table, op: null, payload: null, filters: [], selected: '' };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: (cols) => { if (cols) state.selected = String(cols); return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    lt: (c, v) => { state.filters.push([`lt:${c}`, v]); return b; },
    is: (c, v) => { state.filters.push([`is:${c}`, v]); return b; },
    not: (c, op, v) => { state.filters.push([`not:${c}:${op}`, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    limit: (n) => { state.filters.push(['limit', n]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
const mockRpc = jest.fn(() => Promise.resolve({ data: 'joined', error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const { isStrandedAuthoring, reapStrandedRenders } = Serving;
const Flags = require('../../bot/shared/config/lp612-flags');

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008', book_stem: 'grade_9_chemistry', grade: 9,
  subject: 'Chemistry', subtopic_title: 'Branches', menu_title: 'Branches',
  printed_page_start: 7, printed_page_end: 8, is_religious: false,
};
const REQ = { userId: 'u1', phone: '923001234567', lang: 'en', correlationId: 'c1' };

const MIN = 60 * 1000;
const agoMs = (ms) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0; mockDbResults.length = 0;
  mockSendMessage.mockReset(); mockSendDocumentByLink.mockReset(); mockQueueJob.mockReset();
  mockSegmentById.mockResolvedValue(SEGMENT);
  process.env.LP_612_TEMPLATE_VERSION = 'v9.1';
  // The value staging actually runs. 14 min hard stop => the OLD reap boundary was 17 min.
  process.env.LP612_AUTHOR_TIMEOUT_MS = '840000';
  delete process.env.LP612_QUEUE_ABANDON_MS;
});

// ── the reap window is DERIVED from the SQS envelope, not guessed ───────────

describe('the reap window is reconciled with SQS visibility and the PR #590 heartbeat', () => {
  test('the heartbeat ceiling has ONE definition, shared by the worker and the reaper', () => {
    // The sqs-worker computed `authorTimeoutMs() * 2` inline while the reaper carried its own,
    // unrelated number. Two independent constants describing one envelope is how they drift; the
    // reaper cannot be safe if it does not know when the heartbeat stops.
    expect(typeof Flags.heartbeatCeilingMs).toBe('function');
    expect(Flags.heartbeatCeilingMs()).toBe(840000 * 2);
  });

  test('nothing may be reaped before the message could even have become visible again', () => {
    // Pickup + ceiling (heartbeat stops extending) + one full 900s visibility window (the last
    // extension it made) is the earliest moment SQS itself could hand this job to another worker.
    // Reaping before that writes `failed` over a row whose owner is provably still alive.
    const floor = Flags.heartbeatCeilingMs() + 900 * 1000;
    expect(Serving.reapAfterPickupMs()).toBeGreaterThan(floor);
  });
});

// ── bd-dr216: a queued job is not a failure ─────────────────────────────────

describe('bd-dr216 — a job nobody has picked up is QUEUED, not stranded', () => {
  test('30 minutes in the queue with no worker pickup is NOT stranded', () => {
    // The exact live case: 2 of 16 coach taps on 2026-09-04, condemned at 17 min while still
    // waiting for one of ~4 authoring slots.
    expect(isStrandedAuthoring({
      status: 'authoring', started_at: agoMs(30 * MIN), picked_up_at: null,
    })).toBe(false);
  });

  test('the SWEEP does not condemn it either', async () => {
    mockDbResults.push({
      data: [{
        id: 'r1', segment_id: 's1', started_at: agoMs(30 * MIN), picked_up_at: null,
        updated_at: agoMs(30 * MIN),
      }],
      error: null,
    });

    const n = await reapStrandedRenders();

    expect(n).toBe(0);
    expect(mockDbCalls.find((c) => c.op === 'update')).toBeUndefined();
  });

  test('a row still queued is never described with the corpse code', async () => {
    // Rule 24(d): one shared code across distinct states is how every count downstream lies.
    mockDbResults.push({
      data: [{
        id: 'r1', segment_id: 's1', started_at: agoMs(45 * MIN), picked_up_at: null,
        updated_at: agoMs(45 * MIN),
      }],
      error: null,
    });
    await reapStrandedRenders();
    const patches = mockDbCalls.filter((c) => c.op === 'update');
    expect(patches.some((p) => p.payload.error_code === 'AUTHOR_STRANDED')).toBe(false);
  });

  test('a row whose enqueue never happened is eventually cleared, under its OWN code', async () => {
    // The one genuine never-picked-up orphan: the row was inserted and the enqueue then threw, so
    // no SQS message exists and no worker will ever come. It still must not be called STRANDED.
    mockDbResults.push({
      data: [{
        id: 'r1', segment_id: 's1', started_at: agoMs(10 * 60 * MIN), picked_up_at: null,
        updated_at: agoMs(10 * 60 * MIN),
      }],
      error: null,
    });
    mockDbResults.push({ data: null, error: null });

    const n = await reapStrandedRenders();

    expect(n).toBe(1);
    const patch = mockDbCalls.find((c) => c.op === 'update');
    expect(patch.payload.status).toBe('failed');
    expect(patch.payload.error_code).toBe('QUEUE_ABANDONED');
  });
});

// ── bd-w36m5: a live worker is not a corpse ─────────────────────────────────

describe('bd-w36m5 — a worker legitimately still authoring is not condemned', () => {
  test('20 minutes after pickup is INSIDE the SQS envelope and still live', () => {
    // The old boundary was 17 min from enqueue. At 20 min from PICKUP the heartbeat is still
    // extending visibility (ceiling is 28 min here) and the worker is still running.
    expect(isStrandedAuthoring({
      status: 'authoring', started_at: agoMs(35 * MIN), picked_up_at: agoMs(20 * MIN),
    })).toBe(false);
  });

  test('past the ceiling AND the last visibility window AND the grace, it is stranded', () => {
    const past = Serving.reapAfterPickupMs() + MIN;
    expect(isStrandedAuthoring({
      status: 'authoring', started_at: agoMs(past + 5 * MIN), picked_up_at: agoMs(past),
    })).toBe(true);
  });

  test('the sweep reaps a genuinely ownerless run with the corpse code', async () => {
    const past = Serving.reapAfterPickupMs() + MIN;
    mockDbResults.push({
      data: [{
        id: 'r1', segment_id: 's1', started_at: agoMs(past + 5 * MIN), picked_up_at: agoMs(past),
        updated_at: agoMs(past),
      }],
      error: null,
    });
    mockDbResults.push({ data: null, error: null });

    expect(await reapStrandedRenders()).toBe(1);
    expect(mockDbCalls.find((c) => c.op === 'update').payload.error_code).toBe('AUTHOR_STRANDED');
  });

  test('the sweep\'s write is a COMPARE-AND-SWAP, not a blind overwrite', async () => {
    // It used to be `.in('id', ids)` with no guard at all: a row that reached `ready` between the
    // SELECT and the UPDATE was written back to `failed`, destroying a delivered lesson's state.
    const past = Serving.reapAfterPickupMs() + MIN;
    mockDbResults.push({
      data: [{
        id: 'r1', segment_id: 's1', started_at: agoMs(past + 5 * MIN), picked_up_at: agoMs(past),
        updated_at: agoMs(past),
      }],
      error: null,
    });
    mockDbResults.push({ data: null, error: null });

    await reapStrandedRenders();

    const patch = mockDbCalls.find((c) => c.op === 'update');
    const filters = Object.fromEntries(patch.filters);
    expect(filters.status).toBe('authoring');
    // And anything touched since we read it — a retry CAS, a waiter join, the worker's own
    // terminal patch — is excluded rather than clobbered.
    expect(filters['lt:updated_at']).toBeTruthy();
  });
});

// ── the tap path uses the same predicate ────────────────────────────────────

describe('the tap path and the sweep cannot disagree', () => {
  test('a tap on a QUEUED run joins it — it does not pay for a second one', async () => {
    // The expensive half of bd-dr216: a falsely-failed row makes the next tap reset and enqueue
    // AGAIN, so the false reap manufactures duplicate authoring (~$0.60 and a slot each) in exactly
    // the capacity-starved conditions that caused the long queue in the first place.
    mockDbResults.push({
      data: {
        id: 'r1', status: 'authoring', r2_key: null, waiters: [], error_code: null,
        started_at: agoMs(30 * MIN), picked_up_at: null, one_screen: null,
      },
      error: null,
    });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockQueueJob).not.toHaveBeenCalled();
  });

  test('the lookup actually SELECTS picked_up_at — a column it does not read cannot decide anything', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'new' }, error: null });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    const read = mockDbCalls.find((c) => c.table === 'niete_lp612_renders' && !c.op);
    expect(read.selected).toMatch(/picked_up_at/);
  });

  test('a retry CAS clears picked_up_at — the new run has not been picked up yet', async () => {
    mockDbResults.push({
      data: {
        id: 'r1', status: 'failed', r2_key: null, waiters: [], error_code: 'AUTHOR_TIMEOUT',
        started_at: agoMs(30 * MIN), picked_up_at: agoMs(25 * MIN), one_screen: null,
      },
      error: null,
    });
    mockDbResults.push({ data: [{ id: 'r1' }], error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const swap = mockDbCalls.find((c) => c.op === 'update');
    expect(swap.payload.picked_up_at).toBeNull();
  });
});

// ── the orphan is closed at its source ──────────────────────────────────────

describe('an enqueue that fails must not leave an eternal `authoring` row', () => {
  test('a queue failure is written to the row, not inferred from a clock six hours later', async () => {
    mockDbResults.push({ data: null, error: null });               // no existing render
    mockDbResults.push({ data: { id: 'new-1' }, error: null });    // the claim
    mockDbResults.push({ data: null, error: null });               // the failure patch
    mockQueueJob.mockRejectedValue(new Error('SQS unavailable'));

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('error');
    const patch = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(patch.payload.status).toBe('failed');
    expect(patch.payload.error_code).toBe('ENQUEUE_FAILED');
  });
});
