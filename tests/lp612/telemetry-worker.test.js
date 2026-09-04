/**
 * bd-86ivw — a failed 6-12 render has to say WHICH MODEL failed it.
 *
 * THE DEFECT, met for real on 2026-09-03: two `niete_lp612_renders` rows sat at
 * status='failed', error_code='AUTHOR_TIMEOUT', `model_used` NULL. The maths/physics pilot
 * (bd-u6za9) routes some families to a different model by env alone, so "did the pilot model time
 * out, or did sonnet?" is THE question those rows exist to answer — and they could not answer it.
 * The worker writes `model_used` only inside the success patch; `fail()` writes status, error_code,
 * error_detail and completed_at, and nothing about provenance.
 *
 * The model is not merely knowable on that path — it is already in scope. The worker resolves it
 * BEFORE the try block (`resolveAuthorModel(familyForBook(segment.book_stem))`) precisely because
 * it is the only caller that decides it, and the catch block already logs it. It was simply never
 * written to the row.
 *
 * The second half of this file is the deliver stage's semantic event. The worker's terminal log
 * lines carry the right fields already; what they lack is a stable name to count them by.
 *
 * Everything is driven through `Worker.process(...)` — the function the SQS switch calls. A test
 * of `fail()` in isolation would pass while the worker kept calling it with the old arity.
 */

const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDeliverRender = jest.fn();
const mockSendMessage = jest.fn();
const mockReadFile = jest.fn();
const mockLogEvent = jest.fn();

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
  };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: mockSendMessage }));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    // A WRITE MUST NOT CONSUME A QUEUED READ (bd-dr216). This is a strict FIFO shared by both, and
    // the worker gained one extra UPDATE — the pickup stamp that starts the authoring clock — ahead
    // of the segment read. That shifted every fixture in this file by one and turned the whole
    // suite red for a reason none of its assertions are about. Writes now settle to "the CAS
    // matched a row"; reads take the next fixture, exactly as each test intends.
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
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
const TWO_WAITERS = [
  { user_id: 'u1', phone: '923001111111' },
  { user_id: 'u2', phone: '923002222222' },
];
const mockRpc = jest.fn(() => Promise.resolve({ data: TWO_WAITERS, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const JOB = {
  renderId: 'render-1',
  segmentId: 'grade_9_physics.c01.p007-008',
  lang: 'en',
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
};

// A PHYSICS segment on purpose: `familyForBook` maps it to the 'maths' family, which is the one
// family the pilot re-routes by env. A chemistry fixture would pass this suite while the pilot's
// own rows stayed unattributable.
const SEGMENT = {
  segment_id: JOB.segmentId,
  book_stem: 'grade_9_physics',
  grade: 9,
  subject: 'Physics',
  subtopic_title: 'Measurement',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
};

function seed(render = {}, segment = SEGMENT) {
  mockDbResults.push({
    data: { id: 'render-1', status: 'authoring', waiters: TWO_WAITERS, ...render }, error: null,
  });
  mockDbResults.push({ data: segment, error: null });
}

const lastPatch = () => mockDbCalls.filter((c) => c.op === 'update').pop().payload;
const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: TWO_WAITERS, error: null }));
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 2,
    model: 'anthropic/claude-sonnet-5', family: 'maths', tier: 'standard',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
  });
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
});

// ── the row ─────────────────────────────────────────────────────────────────

describe('a FAILED render records which model failed it', () => {
  test('an AUTHOR_TIMEOUT row carries model_used, not NULL', async () => {
    const err = new Error('lp612 authoring exceeded 720000ms');
    err.code = 'AUTHOR_TIMEOUT';
    mockAuthorLessonPlan.mockRejectedValue(err);
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(lastPatch()).toMatchObject({
      status: 'failed',
      error_code: 'AUTHOR_TIMEOUT',
      model_used: 'anthropic/claude-sonnet-5',
    });
  });

  test('the PILOT model is what the row records when the family routes to it', async () => {
    // The whole reason the column matters. With the pilot env set, a Grade 9 physics timeout must
    // name the pilot model — recording sonnet here would be worse than recording nothing.
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = 'deepseek/deepseek-v4-flash';
    const err = new Error('timeout'); err.code = 'AUTHOR_TIMEOUT';
    mockAuthorLessonPlan.mockRejectedValue(err);
    seed();

    await Worker.process(JOB);

    expect(lastPatch().model_used).toBe('deepseek/deepseek-v4-flash');
  });

  test('a RENDER failure records it too — the document still had an author', async () => {
    const err = new Error('chromium died'); err.code = 'RENDER_FAILED';
    mockRenderLessonPlan.mockRejectedValue(err);
    seed();

    await Worker.process(JOB);

    expect(lastPatch()).toMatchObject({ error_code: 'RENDER_FAILED', model_used: 'anthropic/claude-sonnet-5' });
  });

  test('a segment that vanished under the job fails without inventing a model', async () => {
    // No segment means no family and no model resolution ran. Writing a guess here would put a
    // model on a row that never reached one.
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: TWO_WAITERS }, error: null });
    mockDbResults.push({ data: null, error: null });

    await Worker.process(JOB);

    const patch = lastPatch();
    expect(patch.error_code).toBe('SEGMENT_MISSING');
    expect(patch.model_used == null).toBe(true);
  });
});

// ── the events ──────────────────────────────────────────────────────────────

describe('the deliver stage emits one terminal semantic event', () => {
  test('success emits lp612.deliver.completed with the full provenance', async () => {
    seed();
    await Worker.process(JOB);

    expect(named('lp612.deliver.completed')).toHaveLength(1);
    const payload = named('lp612.deliver.completed')[0][1];
    expect(payload).toMatchObject({
      outcome: 'ready',
      renderId: 'render-1',
      segmentId: JOB.segmentId,
      lang: 'en',
      correlationId: 'corr-1',
      model: 'anthropic/claude-sonnet-5',
      family: 'maths',
      tier: 'standard',
      rounds: 2,
      lintClean: true,
      delivered: 2,
      deliveryFailures: 0,
    });
    expect(typeof payload.elapsedMs).toBe('number');
  });

  test('failure emits lp612.deliver.failed naming the model, the family and the code', async () => {
    const err = new Error('timeout'); err.code = 'AUTHOR_TIMEOUT';
    mockAuthorLessonPlan.mockRejectedValue(err);
    seed();

    await Worker.process(JOB);

    expect(named('lp612.deliver.failed')).toHaveLength(1);
    const payload = named('lp612.deliver.failed')[0][1];
    expect(payload).toMatchObject({
      outcome: 'failed',
      errorCode: 'AUTHOR_TIMEOUT',
      renderId: 'render-1',
      segmentId: JOB.segmentId,
      lang: 'en',
      model: 'anthropic/claude-sonnet-5',
      family: 'maths',
      tier: 'standard',
      correlationId: 'corr-1',
    });
    expect(typeof payload.elapsedMs).toBe('number');
  });

  test('a skipped redelivery emits neither terminal event — nothing happened', async () => {
    mockDbResults.push({ data: { id: 'render-1', status: 'ready', waiters: [] }, error: null });
    await Worker.process(JOB);
    expect(named('lp612.deliver.completed')).toHaveLength(0);
    expect(named('lp612.deliver.failed')).toHaveLength(0);
  });
});
