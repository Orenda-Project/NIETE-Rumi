/**
 * bd-oak77.11 LAYER B — a process that dies mid-run costs ONE ROUND, not the whole lesson.
 *
 * Layer A (the drain) saves the lesson on a planned deploy. It cannot save it from an OOM, a host
 * eviction, or a SIGKILL that outruns the draining window. So the ladder's best-so-far document is
 * persisted on the render row after every accepted round, and the next pickup — whoever it is,
 * whenever it happens — continues from it instead of paying for round 0 again.
 *
 * These drive the REAL worker. Only the network boundary is doubled (Supabase, R2, WhatsApp, the
 * author and render services). The checkpoint's SHAPE is asserted from the actual UPDATE payload the
 * worker issues, and the resume is asserted from the actual argument handed to authorLessonPlan.
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
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [], columns: null };
  const settle = () => {
    mockDbCalls.push({ ...state });
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: (cols) => { if (cols && !state.op) state.columns = cols; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
const TWO_WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
const mockRpc = jest.fn(() => Promise.resolve({ data: TWO_WAITERS, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const JOB = {
  renderId: 'render-1',
  segmentId: 'grade_9_chemistry.c01.p007-008',
  lang: 'en',
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
};
const SEGMENT = {
  segment_id: JOB.segmentId, book_stem: 'grade_9_chemistry', grade: 9, subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry', printed_page_start: 7, printed_page_end: 8,
  is_religious: false,
};

function seed(render = {}, segment = SEGMENT) {
  mockDbResults.push({
    data: { id: 'render-1', status: 'authoring', waiters: TWO_WAITERS, ...render },
    error: null,
  });
  mockDbResults.push({ data: segment, error: null });
}
const updates = () => mockDbCalls.filter((c) => c.op === 'update').map((c) => c.payload);
const checkpointWrites = () => updates().filter((p) => Object.prototype.hasOwnProperty.call(p, 'checkpoint'));

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  delete process.env.LP612_CHECKPOINT_OFF;
  mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: TWO_WAITERS, error: null }));
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('lp612/v9.1/en/seg.pdf');
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'final' }, lintClean: true, fails: [], warns: [], rounds: 2,
    model: 'anthropic/claude-sonnet-5',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
  });
});
afterEach(() => { delete process.env.LP612_CHECKPOINT_OFF; });

describe('the checkpoint is WRITTEN as the ladder goes', () => {
  test('every candidate the ladder publishes lands on the row, with the round it came from', async () => {
    mockAuthorLessonPlan.mockImplementation(async ({ onCandidate }) => {
      onCandidate({ lpDoc: { lesson_id: 'r0' }, rounds: 0, deliverable: false, fails: ['page_cap'], lintClean: false, model: 'm', family: 'sci', tier: 'standard' });
      await new Promise((r) => setImmediate(r));
      onCandidate({ lpDoc: { lesson_id: 'r1' }, rounds: 1, deliverable: true, fails: [], lintClean: true, model: 'm', family: 'sci', tier: 'standard' });
      await new Promise((r) => setImmediate(r));
      return { lpDoc: { lesson_id: 'r1' }, lintClean: true, fails: [], warns: [], rounds: 1, model: 'm' };
    });
    seed();
    await Worker.process(JOB);

    const cps = checkpointWrites().map((p) => p.checkpoint).filter(Boolean);
    expect(cps.length).toBeGreaterThanOrEqual(1);
    const last = cps[cps.length - 1];
    expect(last.v).toBe(1);
    expect(last.round).toBe(1);
    expect(last.lp_doc).toEqual({ lesson_id: 'r1' });
    expect(last.deliverable).toBe(true);
    expect(last.blocking).toEqual([]);
    expect(last.lang).toBe('en');
    expect(last.template_version).toBe('v9.1');
    expect(typeof last.at).toBe('string');
  });

  test('LP612_CHECKPOINT_OFF=true writes nothing — the kill switch is one Railway variable', async () => {
    process.env.LP612_CHECKPOINT_OFF = 'true';
    mockAuthorLessonPlan.mockImplementation(async ({ onCandidate }) => {
      onCandidate({ lpDoc: { lesson_id: 'r0' }, rounds: 0, deliverable: true, fails: [], lintClean: true });
      await new Promise((r) => setImmediate(r));
      return { lpDoc: { lesson_id: 'r0' }, lintClean: true, fails: [], warns: [], rounds: 0, model: 'm' };
    });
    seed();
    await Worker.process(JOB);
    expect(checkpointWrites().filter((p) => p.checkpoint !== null)).toHaveLength(0);
  });

  test('a checkpoint write that fails cannot kill the lesson', async () => {
    mockAuthorLessonPlan.mockImplementation(async ({ onCandidate }) => {
      onCandidate({ lpDoc: { lesson_id: 'r0' }, rounds: 0, deliverable: true, fails: [], lintClean: true });
      await new Promise((r) => setImmediate(r));
      return { lpDoc: { lesson_id: 'r0' }, lintClean: true, fails: [], warns: [], rounds: 0, model: 'm' };
    });
    seed();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
  });

  test('the terminal write CLEARS it, so no row carries a stale document', async () => {
    seed();
    await Worker.process(JOB);
    const terminal = updates().filter((p) => p.status === 'ready').pop();
    expect(terminal).toBeDefined();
    expect(terminal.checkpoint).toBeNull();
  });

  test('a FAILED run clears it too', async () => {
    mockAuthorLessonPlan.mockRejectedValue(Object.assign(new Error('nope'), { code: 'AUTHOR_LLM_FAILED' }));
    seed();
    await Worker.process(JOB);
    const terminal = updates().filter((p) => p.status === 'failed').pop();
    expect(terminal).toBeDefined();
    expect(terminal.checkpoint).toBeNull();
  });
});

describe('the checkpoint is READ on the next pickup', () => {
  test('a matching checkpoint is handed to the ladder as resumeFrom', async () => {
    seed({
      checkpoint: {
        v: 1, round: 2, lp_doc: { lesson_id: 'saved' }, blocking: ['page_cap'], deliverable: true,
        lint_clean: false, lang: 'en', template_version: 'v9.1', at: new Date().toISOString(),
      },
    });
    await Worker.process(JOB);
    const arg = mockAuthorLessonPlan.mock.calls[0][0];
    expect(arg.resumeFrom).toBeDefined();
    expect(arg.resumeFrom.lpDoc).toEqual({ lesson_id: 'saved' });
    expect(arg.resumeFrom.rounds).toBe(2);
  });

  test('a checkpoint from another LANGUAGE is ignored — that document is not this lesson', async () => {
    seed({
      checkpoint: {
        v: 1, round: 2, lp_doc: { lesson_id: 'urdu' }, blocking: [], deliverable: true,
        lang: 'ur', template_version: 'v9.1', at: new Date().toISOString(),
      },
    });
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan.mock.calls[0][0].resumeFrom).toBeUndefined();
  });

  test('a checkpoint from another TEMPLATE VERSION is ignored', async () => {
    seed({
      checkpoint: {
        v: 1, round: 2, lp_doc: { lesson_id: 'v9.0' }, blocking: [], deliverable: true,
        lang: 'en', template_version: 'v9.0', at: new Date().toISOString(),
      },
    });
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan.mock.calls[0][0].resumeFrom).toBeUndefined();
  });

  test('an unrecognised checkpoint VERSION is ignored rather than trusted', async () => {
    seed({
      checkpoint: {
        v: 99, round: 2, lp_doc: { lesson_id: 'future' }, lang: 'en', template_version: 'v9.1',
        at: new Date().toISOString(),
      },
    });
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan.mock.calls[0][0].resumeFrom).toBeUndefined();
  });

  test('LP612_CHECKPOINT_OFF=true also stops the RESUME, not only the write', async () => {
    process.env.LP612_CHECKPOINT_OFF = 'true';
    seed({
      checkpoint: {
        v: 1, round: 2, lp_doc: { lesson_id: 'saved' }, blocking: [], deliverable: true,
        lang: 'en', template_version: 'v9.1', at: new Date().toISOString(),
      },
    });
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan.mock.calls[0][0].resumeFrom).toBeUndefined();
  });
});

describe('the column may not exist yet (NIETE deploys do not run migrations)', () => {
  test('a missing checkpoint column degrades to today: the lesson is still authored and delivered', async () => {
    // First read fails the way PostgREST fails an unknown column; the worker must retry without it.
    mockDbResults.push({ data: null, error: { code: '42703', message: 'column niete_lp612_renders.checkpoint does not exist' } });
    seed();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockAuthorLessonPlan.mock.calls[0][0].resumeFrom).toBeUndefined();
  });
});
