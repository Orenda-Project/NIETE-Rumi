/**
 * The job that writes a lesson nobody has asked for before.
 *
 * Author, render, store, deliver — and the failure paths are the point. This
 * job is minutes long, it is the teacher's first impression of the feature, and
 * SQS delivers at least once, so three things are asserted hard:
 *
 *  - EVERY waiter is delivered to, not just the one who triggered the job;
 *  - a failure reaches her as a sentence and marks the row failed, so the next
 *    tap retries instead of joining a run that is never coming back;
 *  - a redelivered job does not author the same lesson twice.
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
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  deliverRender: mockDeliverRender,
  r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
}));
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
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Worker = require('../../bot/workers/lp612-author.worker');

const JOB = {
  renderId: 'render-1',
  segmentId: 'grade_9_chemistry.c01.p007-008',
  lang: 'en',
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
};

const SEGMENT = {
  segment_id: JOB.segmentId,
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
};

const TWO_WAITERS = [
  { user_id: 'u1', phone: '923001111111' },
  { user_id: 'u2', phone: '923002222222' },
];

/** render row lookup, then segment lookup */
function seed(render = {}, segment = SEGMENT) {
  mockDbResults.push({
    data: { id: 'render-1', status: 'authoring', waiters: TWO_WAITERS, ...render },
    error: null,
  });
  mockDbResults.push({ data: segment, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('lp612/v9.1/en/seg.pdf');
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1,
    model: 'anthropic/claude-sonnet-5',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
  });
});

describe('the happy path', () => {
  test('authors, renders, stores, then delivers to EVERY waiter', async () => {
    seed();
    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockRenderLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockUploadBuffer).toHaveBeenCalledTimes(1);
    expect(mockDeliverRender).toHaveBeenCalledTimes(2);
    expect(mockDeliverRender.mock.calls.map((c) => c[0].phone))
      .toEqual(['923001111111', '923002222222']);
  });

  test('the model is passed in, never hardcoded — the operator flips it by env alone', async () => {
    process.env.LP_AUTHOR_MODEL = 'deepseek/deepseek-v4-flash';
    seed();
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan.mock.calls[0][0].model).toBe('deepseek/deepseek-v4-flash');
    delete process.env.LP_AUTHOR_MODEL;
  });

  test('the render row records provenance and clears the waiter list', async () => {
    seed();
    await Worker.process(JOB);
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload).toMatchObject({
      status: 'ready',
      // The key the SERVING path will look under, derived deterministically —
      // not whatever the upload call happened to return. The two must agree or
      // a lesson is stored somewhere the cache lookup will never find it.
      r2_key: 'lp612/v9.1/en/grade_9_chemistry.c01.p007-008.pdf',
      page_count: 9,
      lint_clean: true,
      rounds_used: 1,
      model_used: 'anthropic/claude-sonnet-5',
      waiters: [],
    });
    expect(done.payload.completed_at).toBeTruthy();
  });

  test('the PDF is stored under the version-first cache key', async () => {
    seed();
    await Worker.process(JOB);
    expect(mockUploadBuffer.mock.calls[0][1])
      .toBe('lp612/v9.1/en/grade_9_chemistry.c01.p007-008.pdf');
    expect(mockUploadBuffer.mock.calls[0][2]).toBe('application/pdf');
  });

  test('a lesson that would not lint clean is still served, and the row says so', async () => {
    // The ladder is best-effort. Withholding a lesson a teacher is waiting for
    // because a gate warns is a worse outcome than sending it and recording it.
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: false, fails: ['PACING_SUM'], warns: [], rounds: 3,
      model: 'anthropic/claude-sonnet-5',
    });
    seed();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(2);
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload.lint_clean).toBe(false);
    expect(done.payload.lint_fails).toEqual(['PACING_SUM']);
  });
});

describe('failure is told, not swallowed', () => {
  test('an authoring failure marks the row failed and messages every waiter', async () => {
    const err = new Error('openrouter 502');
    err.code = 'AUTHOR_LLM_FAILED';
    mockAuthorLessonPlan.mockRejectedValue(err);
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload).toMatchObject({ status: 'failed', error_code: 'AUTHOR_LLM_FAILED' });
  });

  test('a render failure is a failure too — a doc nobody can read is not a success', async () => {
    const err = new Error('chromium died');
    err.code = 'RENDER_FAILED';
    mockRenderLessonPlan.mockRejectedValue(err);
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload.error_code).toBe('RENDER_FAILED');
  });

  test('an unlabelled throw still books a code — never a null error on a failed row', async () => {
    mockAuthorLessonPlan.mockRejectedValue(new Error('something odd'));
    seed();
    await Worker.process(JOB);
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload.error_code).toBe('UNKNOWN');
    expect(done.payload.error_detail).toMatch(/something odd/);
  });

  test('one waiter failing to receive does not stop the others', async () => {
    mockDeliverRender
      .mockRejectedValueOnce(new Error('Meta 400'))
      .mockResolvedValueOnce(undefined);
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(2);
    expect(out.delivered).toBe(1);
    expect(out.deliveryFailures).toBe(1);
  });
});

describe('at-least-once delivery is survivable', () => {
  test('a redelivered job whose render is already ready does not author again', async () => {
    mockDbResults.push({
      data: { id: 'render-1', status: 'ready', r2_key: 'k', waiters: [] }, error: null,
    });
    const out = await Worker.process(JOB);
    expect(out.status).toBe('skipped');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
  });

  test('a job whose render row has vanished is skipped, not crashed on', async () => {
    mockDbResults.push({ data: null, error: null });
    const out = await Worker.process(JOB);
    expect(out.status).toBe('skipped');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
  });

  test('a segment deleted under a queued job fails cleanly', async () => {
    mockDbResults.push({
      data: { id: 'render-1', status: 'authoring', waiters: TWO_WAITERS }, error: null,
    });
    mockDbResults.push({ data: null, error: null });   // segment gone
    const out = await Worker.process(JOB);
    expect(out.status).toBe('failed');
    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload.error_code).toBe('SEGMENT_MISSING');
  });
});

describe('the long tail', () => {
  test('a run that passes the follow-up threshold gets a second message, not silence', async () => {
    jest.useFakeTimers();
    process.env.LP612_FOLLOWUP_MS = '1000';
    seed();
    let release;
    mockAuthorLessonPlan.mockReturnValue(new Promise((r) => { release = r; }));

    const running = Worker.process(JOB);
    // The job awaits several times before it parks on the author call, and the
    // follow-up itself awaits once per waiter. One microtask tick is not
    // enough to settle either — drain properly, or this asserts nothing.
    const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
    await flush();
    jest.advanceTimersByTime(1500);
    await flush();

    expect(mockSendMessage).toHaveBeenCalledTimes(2);   // one per waiter
    release({ lpDoc: {}, lintClean: true, fails: [], warns: [], rounds: 1, model: 'm' });
    jest.useRealTimers();
    await running;
    delete process.env.LP612_FOLLOWUP_MS;
  });

  test('the follow-up timer is cleared on the fast path — no stray message after delivery', async () => {
    jest.useFakeTimers();
    process.env.LP612_FOLLOWUP_MS = '1000';
    seed();
    await Worker.process(JOB);
    jest.advanceTimersByTime(5000);
    expect(mockSendMessage).not.toHaveBeenCalled();
    jest.useRealTimers();
    delete process.env.LP612_FOLLOWUP_MS;
  });
});

// ── the video pick and the one-screen body ──────────────────────────────────

/**
 * Two things the worker is the only place that can do.
 *
 * The PICK reaches the renderer from the segment ROW, never from the document —
 * the authoring model is never shown a url, so it cannot return a subtly
 * different one. It carries the religious hold with it: a held book's video is
 * held for the same reason its lesson is.
 *
 * The ONE_SCREEN body is authored on every plan and, until now, thrown away. It
 * has to be STORED, not just sent, because every teacher after the first is
 * served entirely from the cached row and would otherwise get the file with no
 * summary while the first got both.
 */
describe('the video pick and the stored body', () => {
  const PICK = { url: 'https://youtu.be/abc', video_id: 'abc', title: 'T' };
  const patches = () => mockDbCalls.filter((c) => c.op === 'update').map((c) => c.payload);

  test('the segment row video is handed to the renderer', async () => {
    seed({}, { ...SEGMENT, yt: PICK });
    await Worker.process(JOB);
    expect(mockRenderLessonPlan.mock.calls[0][0].video).toEqual(PICK);
  });

  test('a segment with no pick renders with none — not undefined-shaped furniture', async () => {
    seed();
    await Worker.process(JOB);
    expect(mockRenderLessonPlan.mock.calls[0][0].video).toBeNull();
  });

  test('a HELD segment does not get its video printed either', async () => {
    // The hold is on the content. If the lesson is not served, nothing attached
    // to it is served — and if the hold is ever lifted, both lift together,
    // because they read the same flag.
    delete process.env.LP_612_RELIGIOUS_ENABLED;
    seed({}, { ...SEGMENT, is_religious: true, yt: PICK });
    await Worker.process(JOB);
    expect(mockRenderLessonPlan.mock.calls[0][0].video).toBeNull();
  });

  test('with the religious flag ON, a held segment keeps its video', async () => {
    process.env.LP_612_RELIGIOUS_ENABLED = 'true';
    seed({}, { ...SEGMENT, is_religious: true, yt: PICK });
    await Worker.process(JOB);
    expect(mockRenderLessonPlan.mock.calls[0][0].video).toEqual(PICK);
    delete process.env.LP_612_RELIGIOUS_ENABLED;
  });

  test('the authored one_screen is written to the render row', async () => {
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x', one_screen: 'The lesson in one screen.' },
      lintClean: true, fails: [], rounds: 1, model: 'm',
    });
    seed();
    await Worker.process(JOB);
    const ready = patches().find((p) => p.status === 'ready');
    expect(ready.one_screen).toBe('The lesson in one screen.');
  });

  test('a document with no one_screen stores null rather than "undefined"', async () => {
    seed();
    await Worker.process(JOB);
    expect(patches().find((p) => p.status === 'ready').one_screen).toBeNull();
  });

  test('every waiter is delivered the body as well as the file', async () => {
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x', one_screen: 'Summary.' },
      lintClean: true, fails: [], rounds: 1, model: 'm',
    });
    seed();
    await Worker.process(JOB);
    expect(mockDeliverRender).toHaveBeenCalledTimes(2);
    for (const call of mockDeliverRender.mock.calls) {
      expect(call[0].oneScreen).toBe('Summary.');
    }
  });
});
