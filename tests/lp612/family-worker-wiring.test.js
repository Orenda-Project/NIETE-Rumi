/**
 * bd-u6za9 — the pilot must survive the WORKER, which is the only caller in production.
 *
 * WHY THIS SUITE EXISTS, AND WHAT IT CAUGHT
 *
 * `family-author-wiring.test.js` drives `authorLessonPlan()` directly and proves the
 * family model reaches the LLM. It went green, the change shipped to staging — and
 * the first live authoring of a Grade 9 PHYSICS segment came back
 * `model_used = "anthropic/claude-sonnet-5"`. The pilot was inert in production
 * while 27 tests said it worked.
 *
 * The reason: `lp612-author.worker.js` resolves the model ITSELF
 * (`const model = resolveAuthorModel()`, no family) and passes it EXPLICITLY to
 * `authorLessonPlan({ segment, lang, model, … })`. The service's
 * `model || resolveAuthorModel(family)` therefore always took the worker's
 * family-less value, and the family branch was unreachable from the only call
 * path that runs in production.
 *
 * The service-level suite could not have caught it, because it called
 * `authorLessonPlan` the way the worker does NOT — without a model. That is the
 * repo's own TDD rule in its sharpest form: a red test must execute the
 * PRODUCTION call path, and "the caller passes this argument" is part of that path.
 *
 * So these tests drive `Worker.process()` and assert on the model that reaches
 * the author service and the render row. If the worker ever goes back to
 * resolving a family-less model, this suite fails.
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
  };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: mockSendMessage }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
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
// `rpc` is on the DB boundary because the worker claims its delivery audience
// through lp612_claim_waiters (bd-pfest). This suite is about MODEL routing, so
// the claim just returns the seeded waiter list.
const mockRpc = jest.fn(async () => ({
  data: [{ user_id: 'u1', phone: '923001111111' }],
  error: null,
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const DSFLASH = 'deepseek/deepseek-v4-flash';
const SONNET = 'anthropic/claude-sonnet-5';

function jobFor(segmentId) {
  return { renderId: 'render-1', segmentId, lang: 'en', templateVersion: 'v9.1', correlationId: 'corr-1' };
}

function segmentFor(segmentId, bookStem, subject) {
  return {
    segment_id: segmentId,
    book_stem: bookStem,
    grade: 9,
    subject,
    subtopic_title: 'A subtopic',
    printed_page_start: 8,
    printed_page_end: 9,
    is_religious: false,
  };
}

function seed(segment) {
  mockDbResults.push({
    data: { id: 'render-1', status: 'authoring', waiters: [{ user_id: 'u1', phone: '923001111111' }] },
    error: null,
  });
  mockDbResults.push({ data: segment, error: null });
}

/** The model the render row records — what an audit or a bake-off actually reads. */
function recordedModel() {
  const patch = mockDbCalls.find((c) => c.op === 'update' && c.payload && c.payload.model_used);
  return patch && patch.payload.model_used;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('lp612/v9.1/en/seg.pdf');
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
  });
  // The service echoes back whatever model it was told to use — so the assertions
  // below are about what the WORKER decided, not about the service's own defaulting.
  mockAuthorLessonPlan.mockImplementation(async ({ model }) => ({
    lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1, model,
  }));

  process.env.LP_AUTHOR_MODEL = SONNET;
  process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
});

afterEach(() => {
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
});

describe('bd-u6za9 — the worker resolves the model PER FAMILY', () => {
  test('a PHYSICS job authors on the pilot model — the exact case that came back sonnet on staging', async () => {
    const seg = segmentFor('grade_9_physics.c01.p008-009', 'grade_9_physics', 'Physics');
    seed(seg);

    await Worker.process(jobFor(seg.segment_id));

    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe(DSFLASH);
    // And it must be what the row records, since that is what an audit reads back.
    expect(recordedModel()).toBe(DSFLASH);
  });

  test('a MATHEMATICS job authors on the pilot model', async () => {
    const seg = segmentFor('grade_10_mathematics.c01.p009-010', 'grade_10_mathematics', 'Mathematics');
    seed(seg);

    await Worker.process(jobFor(seg.segment_id));

    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe(DSFLASH);
    expect(recordedModel()).toBe(DSFLASH);
  });

  test('a CHEMISTRY job stays on sonnet — the pilot is scoped to one family', async () => {
    const seg = segmentFor('grade_9_chemistry.c01.p007-008', 'grade_9_chemistry', 'Chemistry');
    seed(seg);

    await Worker.process(jobFor(seg.segment_id));

    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe(SONNET);
    expect(recordedModel()).toBe(SONNET);
  });

  test('an URDU job stays on sonnet', async () => {
    const seg = segmentFor('grade_10_urdu.c01.p006-007', 'grade_10_urdu', 'Urdu');
    seed(seg);

    await Worker.process(jobFor(seg.segment_id));

    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe(SONNET);
  });

  test('UNSETTING the pilot var puts physics back on sonnet through the worker too', async () => {
    delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
    const seg = segmentFor('grade_9_physics.c01.p008-009', 'grade_9_physics', 'Physics');
    seed(seg);

    await Worker.process(jobFor(seg.segment_id));

    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe(SONNET);
    expect(recordedModel()).toBe(SONNET);
  });
});
