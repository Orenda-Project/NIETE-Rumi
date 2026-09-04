/**
 * bd-dr216 / bd-7yxsu — the WORKER's half of the lifecycle.
 *
 * The reaper can only measure staleness from pickup if something records pickup, and nothing did:
 * `niete_lp612_renders.started_at` is written by the INSERT's own `DEFAULT NOW()` at enqueue time,
 * and the worker wrote nothing at all until the job reached a terminal status minutes later. So the
 * table had one clock where it needed two.
 *
 * And when a run recovered — the row reaped to `failed` while the worker was still legitimately
 * running, then finishing normally — the success patch wrote `status: 'ready'` over it and left
 * `error_code` exactly where the reaper had put it. `grade_11_physics.c01.p014-018` was live proof:
 * status=ready, error_code=AUTHOR_STRANDED, a healthy delivered lesson reading as errored in every
 * query anyone ran. Every failure count quoted on 2026-09-04 is inflated by this.
 *
 * Driven through `Worker.process(...)` — the function the SQS switch actually calls — so the
 * assertions execute the changed lines on the real path rather than a helper beside it.
 */

const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDeliverRender = jest.fn();
const mockSendMessage = jest.fn();
const mockReadFile = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({
  authorLessonPlan: mockAuthorLessonPlan,
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: mockRenderLessonPlan,
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: mockUploadBuffer }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
  return {
    deliverRender: mockDeliverRender,
    r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
    assertKeyInPrefix: real.assertKeyInPrefix,
    SEND_TOTAL_BUDGET_MS: real.SEND_TOTAL_BUDGET_MS,
  };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: mockSendMessage }));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
/**
 * READS are queued; WRITES always settle empty.
 *
 * Deliberately NOT one FIFO queue for both. A strict FIFO couples every assertion in this file to
 * the exact number of UPDATEs the worker happens to make, so adding the pickup stamp would shift
 * the segment read off the end and every test would go red for a reason that has nothing to do
 * with what it asserts — which is precisely how a red-first test proves nothing.
 */
const mockDbReads = [];
/** What an UPDATE ... RETURNING settles to. Default: the CAS matched a row (it won). */
let mockUpdateResult = { data: { id: 'render-1' }, error: null };
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    if (state.op === 'update') return Promise.resolve(mockUpdateResult);
    return Promise.resolve(mockDbReads.length ? mockDbReads.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
const WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const JOB = {
  renderId: 'render-1',
  segmentId: 'grade_11_physics.c01.p014-018',
  lang: 'en',
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
};

const SEGMENT = {
  segment_id: JOB.segmentId, book_stem: 'grade_11_physics', grade: 11, subject: 'Physics',
  subtopic_title: 'Vectors', printed_page_start: 14, printed_page_end: 18, is_religious: false,
  language: 'en',
};

/** The two READS the job makes: its own row, then the segment. Writes are separate (see above). */
function seed(render = {}, segment = SEGMENT) {
  mockDbReads.push({
    data: { id: 'render-1', status: 'authoring', waiters: WAITERS, ...render }, error: null,
  });
  mockDbReads.push({ data: segment, error: null });
}

const updates = () => mockDbCalls.filter((c) => c.op === 'update');
const lastPatch = () => updates().pop().payload;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbReads.length = 0;
  mockUpdateResult = { data: { id: 'render-1' }, error: null };
  mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockDeliverRender.mockResolvedValue(undefined);
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x', one_screen: 'a summary' }, lintClean: true, fails: [], rounds: 2,
    model: 'anthropic/claude-sonnet-5', family: 'maths', tier: 'standard',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [], overlayApplied: [],
  });
});

// ── bd-dr216: the pickup clock ──────────────────────────────────────────────

describe('the worker records when it PICKED THE JOB UP', () => {
  test('it stamps picked_up_at before doing any authoring work', async () => {
    seed();

    await Worker.process(JOB);

    const stamp = updates().find((c) => c.payload.picked_up_at);
    expect(stamp).toBeTruthy();
    expect(typeof stamp.payload.picked_up_at).toBe('string');
    // Now, not the enqueue time — this is the whole point of the second clock.
    expect(Date.now() - Date.parse(stamp.payload.picked_up_at)).toBeLessThan(5000);
  });

  test('the stamp is a COMPARE-AND-SWAP on `authoring`, so two deliveries of one message cannot both claim it', async () => {
    // SQS is at-least-once. The old idempotency check was a separate read, so two workers could
    // both read `authoring` and both author the same lesson. Claiming and checking in one guarded
    // statement is what makes the check mean anything.
    seed();

    await Worker.process(JOB);

    const stamp = updates().find((c) => c.payload.picked_up_at);
    expect(Object.fromEntries(stamp.filters).status).toBe('authoring');
  });

  test('a redelivery of a job that already finished neither stamps nor authors', async () => {
    mockDbReads.push({ data: { id: 'render-1', status: 'ready', waiters: [] }, error: null });

    const out = await Worker.process(JOB);

    expect(out.status).toBe('skipped');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    expect(updates().some((c) => c.payload.picked_up_at)).toBe(false);
  });
});

// ── bd-7yxsu: status and error_code can never disagree ──────────────────────

describe('bd-7yxsu — a recovered row CLEARS its error code', () => {
  test('the success patch nulls error_code and error_detail', async () => {
    // The live row: reaped to failed/AUTHOR_STRANDED while the worker was still running, then
    // finished normally. `ready` with an error code on it is a row that lies to every query.
    seed({ status: 'authoring', error_code: 'AUTHOR_STRANDED' });

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    const patch = lastPatch();
    expect(patch.status).toBe('ready');
    expect(patch.error_code).toBeNull();
    expect(patch.error_detail).toBeNull();
  });

  test('the clearing is EXPLICIT — omitting the column is what left it set', async () => {
    // An UPDATE that does not name error_code leaves whatever is in the column. `undefined` in the
    // patch object and `null` in the patch object are the same thing to a reader of this test and
    // opposite things to Postgres, so assert the key is present and null rather than falsy.
    seed();
    await Worker.process(JOB);
    const ready = updates().map((c) => c.payload).filter((p) => p.status === 'ready');
    expect(ready).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(ready[0], 'error_code')).toBe(true);
    expect(ready[0].error_code).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(ready[0], 'error_detail')).toBe(true);
  });
});
