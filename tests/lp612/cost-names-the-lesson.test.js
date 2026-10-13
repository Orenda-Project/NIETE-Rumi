'use strict';
/**
 * bd-b0qwk.6 — the model spend of writing a 6-12 lesson names the lesson it was spent on.
 *
 * A 6-12 lesson is written once and then served to every teacher who asks for it, so what it cost
 * to write belongs to the lesson, not to whoever happened to ask first. Its cost records named
 * neither: lp.author, the largest single spender in this deployment, carried only a correlationId,
 * so its spend could not be joined to the lesson or spread over the teachers it reaches.
 *
 * The author job now names its render and segment on the job's context, and the cost recorder
 * copies them onto every cost record the job makes. Logging only: nothing sent to the model
 * changes, and nothing outside the job is touched.
 *
 * Driven the way a teacher drives it: `Serving.requestLesson`, then the queued job through
 * `Worker.process` inside a job context, exactly as the SQS worker runs it. The author service,
 * the model client and its spend wrapper, the cost recorder and the structured logger are all the
 * shipped code. What is doubled is the network (the model SDK, R2, PostgREST, SQS, Meta) plus the
 * out-of-process renderer: the same doubles as overlay-chrome-reuse.e2e.test.js, except that the
 * model is doubled at the SDK rather than at the model client, so the spend wrapper really runs.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: (...args) => mockCreate(...args) } } };
});

const mockUploads = [];
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (buf, key, type) => { mockUploads.push({ key, type, buf }); return 'ok'; }),
  downloadFromR2: jest.fn(),
}));

const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueJob: jest.fn(async (groupId, jobType, payload) => { mockQueued.push(payload); return { ok: true }; }),
}));

jest.mock('../../bot/shared/config/supabase', () => require('./helpers/lp612-db-double').db);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendDocument: jest.fn(async () => ({ ok: true })),
}));

const mockRendered = { pdfPath: null, pageCount: 4 };
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: jest.fn(async ({ lpDoc }) => ({
    pdfPath: mockRendered.pdfPath,
    htmlPath: mockRendered.pdfPath,
    pageCount: mockRendered.pageCount,
    warnings: [],
    pagesByPart: { teach: 2, support: 2 },
    overlayApplied: Object.keys((lpDoc && lpDoc.ur_overlay) || {}),
  })),
}));

const { reset } = require('./helpers/lp612-db-double');
const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const H = require('./helpers/overlay-chrome-e2e');
const Serving = require('../../bot/shared/services/lp612-serving.service');
const Worker = require('../../bot/workers/lp612-author.worker');
const { getClient } = require('../../bot/shared/services/llm-client');
const { recordModelCost } = require('../../bot/shared/utils/model-cost');

const sl = () => require('../../bot/shared/utils/structured-logger');
const sunk = () => sl().logger.info.mock.calls.map(([o]) => o).filter((o) => o && typeof o === 'object');
const costEvents = () => sunk().filter((o) => o.event === 'api.cost.incurred');
const lessonOf = (e) => ({ renderId: e.renderId, segmentId: e.segmentId });

const tree = H.installFixtureTree();
const TEACHER = '2a76b32c-4389-420b-b03f-7aadfba58b31';
const TAP = {
  segmentId: H.SEG_ID, userId: 'teacher-1', phone: '923001234567',
  lang: 'ur', uiLang: 'ur', correlationId: 'tap-1', surface: 'whatsapp',
};

/** The tap queues one job; the worker then runs it inside its own job context, as processJob does. */
async function tapAndQueue() {
  await Serving.requestLesson(TAP);
  expect(mockQueued).toHaveLength(1);
  return mockQueued[0];
}
const runTheJob = (job, attrs = {}) => sl().runWithCorrelation('corr-job-1', () => Worker.process(job), attrs);

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.length = 0;
  mockQueued.length = 0;
  reset([H.SEGMENT]);
  mockRendered.pdfPath = tree.pdfPath;
  H.installLlm(mockCreate);
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  process.env.LP_612_TEMPLATE_VERSION = 'v9.6';
  // Nothing cached: the lesson has never been written, so the job writes it.
  downloadFromR2.mockImplementation(async (key) => {
    throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
  });
});

afterEach(() => {
  delete process.env.LP_612_TEMPLATE_VERSION;
});

describe('writing a 6-12 lesson: its spend names the lesson (bd-b0qwk.6)', () => {
  test('every model call that writes the lesson records the render and segment it was spent on', async () => {
    const job = await tapAndQueue();
    const out = await runTheJob(job);

    expect(out.status).toBe('ready');
    const spent = costEvents().filter((e) => e.job === 'lp.author');
    expect(spent.length).toBeGreaterThan(0);
    for (const e of spent) {
      expect(lessonOf(e)).toEqual({ renderId: job.renderId, segmentId: job.segmentId });
      expect(e.correlationId).toBe('corr-job-1');
    }
  });

  test('the teacher and the lesson sit on the same record', async () => {
    const job = await tapAndQueue();
    await runTheJob(job, { userId: TEACHER });

    const spent = costEvents().filter((e) => e.job === 'lp.author');
    expect(spent.length).toBeGreaterThan(0);
    for (const e of spent) {
      expect(e.userId).toBe(TEACHER);
      expect(lessonOf(e)).toEqual({ renderId: job.renderId, segmentId: job.segmentId });
    }
  });

  test('the lesson goes on the cost record only, never to the model vendor', async () => {
    const job = await tapAndQueue();
    await runTheJob(job);

    expect(mockCreate.mock.calls.length).toBeGreaterThan(0);
    for (const [params] of mockCreate.mock.calls) {
      expect(params).not.toHaveProperty('renderId');
      expect(params).not.toHaveProperty('segmentId');
      expect(JSON.stringify(params)).not.toContain(job.renderId);
    }
  });

  test('spend outside the job names no lesson, even while the job is mid-call', async () => {
    const job = await tapAndQueue();

    // Hold the job inside its first model call, and spend from another context meanwhile.
    const answer = mockCreate.getMockImplementation();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let reachedModel;
    const atModel = new Promise((resolve) => { reachedModel = resolve; });
    let first = true;
    mockCreate.mockImplementation(async (params) => {
      if (first && params && params.messages && params.messages.length) {
        first = false;
        reachedModel();
        await held;
      }
      return answer(params);
    });

    const running = runTheJob(job);
    await atModel;
    await sl().runWithCorrelation('corr-other', () => getClient().chat.completions.create({
      model: 'openai/gpt-5-mini', job: 'test.other', messages: [{ role: 'user', content: 'hi' }],
    }));
    recordModelCost('openai/gpt-5-mini', { usage: {} }, Date.now(), { job: 'outside.any.context' });
    release();
    await running;

    const other = costEvents().filter((e) => e.job === 'test.other' || e.job === 'outside.any.context');
    expect(other).toHaveLength(2);
    for (const e of other) expect(lessonOf(e)).toEqual({ renderId: undefined, segmentId: undefined });
    const spent = costEvents().filter((e) => e.job === 'lp.author');
    expect(spent.length).toBeGreaterThan(0);
    for (const e of spent) expect(lessonOf(e)).toEqual({ renderId: job.renderId, segmentId: job.segmentId });
  });
});

describe('the lesson on the context: only well-formed ids, never a throw (bd-b0qwk.6)', () => {
  const spendIn = async (given) => {
    sl().logger.info.mockClear();
    await sl().runWithCorrelation('corr-x', async () => {
      expect(() => sl().setCorrelationLesson?.(given)).not.toThrow();
      recordModelCost('anthropic/claude-sonnet-5', { usage: {} }, Date.now(), { job: 'lp.author' });
    });
    return lessonOf(costEvents()[0]);
  };

  test('a render and segment are recorded; anything malformed is dropped, field by field', async () => {
    expect(await spendIn({ renderId: 'r-1', segmentId: 'grade_9_mathematics.c01.p024-025' }))
      .toEqual({ renderId: 'r-1', segmentId: 'grade_9_mathematics.c01.p024-025' });
    expect(await spendIn({ renderId: 'x'.repeat(5000), segmentId: 's-2' })).toEqual({ renderId: undefined, segmentId: 's-2' });
    for (const bad of [undefined, null, {}, { renderId: 42, segmentId: { a: 1 } }, { renderId: '', segmentId: '' }, 'r-1']) {
      expect(await spendIn(bad)).toEqual({ renderId: undefined, segmentId: undefined });
    }
  });

  test('a context opened inside the job keeps its lesson; a sibling context never gets it', async () => {
    sl().logger.info.mockClear();
    await sl().runWithCorrelation('corr-outer', async () => {
      sl().setCorrelationLesson?.({ renderId: 'r-outer', segmentId: 's-outer' });
      await sl().runWithCorrelation('corr-inner', async () => {
        recordModelCost('anthropic/claude-sonnet-5', { usage: {} }, Date.now(), { job: 'lp.author' });
      });
    });
    await sl().runWithCorrelation('corr-sibling', async () => {
      recordModelCost('anthropic/claude-sonnet-5', { usage: {} }, Date.now(), { job: 'lp.author' });
    });
    const [inner, sibling] = costEvents();
    expect(inner.correlationId).toBe('corr-inner');
    expect(lessonOf(inner)).toEqual({ renderId: 'r-outer', segmentId: 's-outer' });
    expect(sibling.correlationId).toBe('corr-sibling');
    expect(lessonOf(sibling)).toEqual({ renderId: undefined, segmentId: undefined });
  });

  test('an id the caller passes explicitly still wins over the context', async () => {
    sl().logger.info.mockClear();
    await sl().runWithCorrelation('corr-y', async () => {
      sl().setCorrelationLesson?.({ renderId: 'r-ctx', segmentId: 's-ctx' });
      recordModelCost('anthropic/claude-sonnet-5', { usage: {} }, Date.now(), { job: 'lp.author', renderId: 'r-explicit' });
    });
    expect(lessonOf(costEvents()[0])).toEqual({ renderId: 'r-explicit', segmentId: 's-ctx' });
  });

  test('the cost recorder still records when the logger is stubbed without the lesson reader', () => {
    jest.isolateModules(() => {
      const logged = [];
      jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (n, d) => logged.push([n, d]) }));
      const { recordModelCost: record } = require('../../bot/shared/utils/model-cost');
      expect(() => record('m', { usage: {} }, Date.now(), { job: 'lp.author' })).not.toThrow();
      expect(logged).toHaveLength(1);
      expect(logged[0][0]).toBe('api.cost.incurred');
      expect(logged[0][1]).not.toHaveProperty('renderId');
      jest.dontMock('../../bot/shared/utils/structured-logger');
    });
  });
});
