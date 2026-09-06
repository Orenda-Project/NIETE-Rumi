/**
 * bd-vjk68 — AN OVER-CAP LESSON IS DELIVERED, NOT FAILED.
 *
 * Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because of the
 * length issue"*.
 *
 * The worker's final render throws when the renderer finds ANY defect, and `PAGE COUNT` is one
 * of them — so a lesson whose only remaining fault was length became a `failed` row and a
 * sentence of apology, after having spent up to five ~60s revision rounds trying to shrink.
 * 9 of the 20 failures in the live 59-lesson window were exactly that.
 *
 * The renderer has ALREADY WRITTEN THE PDF by the time it throws (`lp612-render.service.js`
 * carries `pdfPath` and `pageCount` on the error), so "deliver it anyway" costs one file read.
 * The row records `over_cap` and the event carries the pages AND the caps, which is what lets
 * the "does the distribution refill to the new cap?" experiment run after 40 lessons.
 *
 * WHAT IS NOT RELAXED: every other render defect. OVERFLOW clips content off the bottom of a
 * page and TRUNCATION drops pages out of the file — those are broken documents, not long ones,
 * and they still fail.
 */

describe('the worker delivers an over-cap lesson instead of failing it', () => {
  const mockAuthorLessonPlan = jest.fn();
  const mockRenderLessonPlan = jest.fn();
  const mockUploadBuffer = jest.fn();
  const mockDeliverRender = jest.fn();
  const mockReadFile = jest.fn();
  const mockLogEvent = jest.fn();

  jest.mock('../../bot/shared/services/lp612-author.service', () => ({
    authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/services/lp612-render.service', () => ({
    renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUploadBuffer(...a) }));
  jest.mock('../../bot/shared/services/lp612-serving.service', () => {
    const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
    return {
      ...real,
      deliverRender: (...a) => mockDeliverRender(...a),
      r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
      assertKeyInPrefix: real.assertKeyInPrefix,
    };
  });
  jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
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
  const WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
  const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
  jest.mock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => mockBuilder(t)),
    rpc: (...a) => mockRpc(...a),
  }));

  const Worker = require('../../bot/workers/lp612-author.worker');

  const JOB = {
    renderId: 'render-1',
    segmentId: 'grade_9_biology.c01.p014-014',
    lang: 'en',
    templateVersion: 'v9.1',
    correlationId: 'corr-1',
  };
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_9_biology', grade: 9, subject: 'Biology',
    subtopic_title: 'The biological method', printed_page_start: 14, printed_page_end: 14,
    is_religious: false,
  };

  /** The error `lp612-render.service` throws when the document is over its page cap. */
  const overCapError = (problems) => Object.assign(new Error('render produced defects'), {
    code: 'RENDER_FAILED',
    infra: false,
    problems,
    warnings: [],
    htmlPath: '/tmp/x.html',
    pdfPath: '/tmp/x.pdf',
    pageCount: 11,
    pagesByPart: { teach: 7, support: 4 },
    overlayApplied: [],
  });

  const OVER = 'PAGE COUNT: teach needs 7 pages; the cap is 6. Cut it, or move content to the other part.';

  function seed() {
    mockDbResults.push({
      data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null,
    });
    mockDbResults.push({ data: SEGMENT, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: false, fails: [OVER], warns: [], rounds: 1,
      model: 'anthropic/claude-sonnet-5',
    });
  });

  test('a final render refused ONLY for page count still delivers the lesson', async () => {
    mockRenderLessonPlan.mockRejectedValue(overCapError([OVER]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
  });

  test('the delivered over-cap row SAYS SO — over_cap, with status and error_code agreeing', async () => {
    mockRenderLessonPlan.mockRejectedValue(overCapError([OVER]));
    seed();

    await Worker.process(JOB);

    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload).toMatchObject({
      status: 'ready',
      over_cap: true,
      error_code: null,          // bd-7yxsu: a delivered lesson never reads as errored
      page_count: 11,
    });
  });

  test('it emits lp612.deliver.over_cap with the pages AND the caps they were measured against', async () => {
    // Without the caps on the event the row is unreadable the moment the caps move again — and
    // moving them is exactly what this bead does. This is the event the "does the distribution
    // refill to the new cap?" experiment reads after 40 lessons.
    mockRenderLessonPlan.mockRejectedValue(overCapError([OVER]));
    seed();

    await Worker.process(JOB);

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.deliver.over_cap');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({
      teach_pages: 7, support_pages: 4, cap_teach: 6, cap_support: 4, lang: 'en',
    });
  });

  test('a render refused for a NON page-count defect still fails the lesson', async () => {
    // The policy is about LENGTH. A clipped page is a broken document and must never be sent.
    mockRenderLessonPlan.mockRejectedValue(overCapError([
      'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)',
    ]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(mockDeliverRender).not.toHaveBeenCalled();
  });

  test('a MIXED defect set — page count plus a real defect — still fails', async () => {
    mockRenderLessonPlan.mockRejectedValue(overCapError([
      OVER,
      'TRUNCATION: the PDF has 6 page(s) but the layout built 11 — 5 page(s) are MISSING.',
    ]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
  });

  test('an infra render failure is NOT an over-cap delivery', async () => {
    // A Chromium that would not launch has produced no PDF at all. Delivering "whatever length
    // it is" here would send the teacher a file that does not exist.
    mockRenderLessonPlan.mockRejectedValue(Object.assign(new Error('browser gone'), {
      code: 'RENDER_FAILED', infra: true, problems: ['browser gone'],
    }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
  });

  test('a lesson that fits records over_cap FALSE — the flag is never left ambiguous', async () => {
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
      pagesByPart: { teach: 5, support: 4 }, overlayApplied: [],
    });
    seed();

    await Worker.process(JOB);

    const done = mockDbCalls.filter((c) => c.op === 'update').pop();
    expect(done.payload.over_cap).toBe(false);
  });
});
