/**
 * bd-0cdug — AN AUTHOR_TIMEOUT MUST NOT THROW AWAY A LESSON THAT ALREADY RENDERED CLEAN.
 *
 * bd-vjk68 established the rule for LENGTH: *a lesson is never lost for being long*. This is the
 * same rule applied to TIME, and it is here because the same waste was measured. On 2026-09-05
 * three Urdu cells hit `AUTHOR_TIMEOUT` at 840 s — and two of them were still holding renderable
 * documents when the clock ran out. d05's round-3 render logged `lp612 render ok`, 11 pages. The
 * teacher got an apology for a lesson that existed.
 *
 * The ladder already keeps a best-so-far: `notWorse`/`notWorseVisual` replace the held document
 * only when a candidate is not worse, so at every instant it holds the best thing it has seen.
 * Nothing published it, so `withTimeout` — which races the ladder but cannot cancel it — rejected
 * with the document still inside the closure, unreachable.
 *
 * WHAT THIS PINS:
 *
 *   1. `authorLessonPlan` publishes each accepted candidate through `onCandidate`, at round 0 and
 *      on every round it keeps a new one.
 *   2. It says whether that candidate is DELIVERABLE, and the bar is the delivery bar, not the
 *      ladder's: schema valid, and nothing blocking except page count. `OVERFLOW` clips content
 *      off the bottom of a page and `TRUNCATION` drops pages out of the file — a teacher must
 *      never be sent either, however long she has waited.
 *   3. On `AUTHOR_TIMEOUT` the worker renders and delivers that candidate instead of apologising.
 *   4. It is a DISTINCT persisted state — `over_time` on the row and `lp612.deliver.over_time`
 *      with the rounds and the elapsed time — done exactly as `over_cap` was, because "we shipped
 *      one late" and "we shipped one long" are different questions and both have to be countable.
 *   5. With nothing deliverable in hand, it still fails. A half-authored document is not a lesson.
 *   6. The Urdu overlay pass is SKIPPED on this path. She has already waited past the timeout;
 *      spending another ~150 s to translate is the wrong trade, and the honest English caption
 *      already exists for exactly this.
 */

describe('an AUTHOR_TIMEOUT delivers the best document already in hand', () => {
  const mockAuthorLessonPlan = jest.fn();
  const mockOverlayLessonPlan = jest.fn();
  const mockRenderLessonPlan = jest.fn();
  const mockUploadBuffer = jest.fn();
  const mockDeliverRender = jest.fn();
  const mockReadFile = jest.fn();
  const mockLogEvent = jest.fn();

  jest.mock('../../bot/shared/services/lp612-author.service', () => ({
    authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
    overlayLessonPlan: (...a) => mockOverlayLessonPlan(...a),
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
    segmentId: 'grade_10_chemistry.c04.p054-055',
    lang: 'en',
    templateVersion: 'v9.1',
    correlationId: 'corr-1',
  };
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_10_chemistry', grade: 10, subject: 'Chemistry',
    subtopic_title: 'Chromium plating', printed_page_start: 54, printed_page_end: 55,
    language: 'en', is_religious: false,
  };
  const BEST = { lesson_id: 'best-so-far' };

  const goodRender = () => ({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 11, warnings: [],
    pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
  });

  /**
   * A ladder that publishes a candidate and then never returns — the shape of the real thing,
   * which `withTimeout` races but cannot cancel.
   */
  const laddersForever = (candidate) => (args) => {
    if (args.onCandidate) args.onCandidate(candidate);
    return new Promise(() => {});
  };

  function seed() {
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: SEGMENT, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockRenderLessonPlan.mockResolvedValue(goodRender());
    process.env.LP612_AUTHOR_TIMEOUT_MS = '150';
  });
  afterEach(() => { delete process.env.LP612_AUTHOR_TIMEOUT_MS; });

  const patchOf = (status) => mockDbCalls
    .filter((c) => c.op === 'update' && c.payload && c.payload.status === status).pop();
  const eventNames = () => mockLogEvent.mock.calls.map((c) => c[0]);

  const deliverableCandidate = {
    lpDoc: BEST, rounds: 3, deliverable: true, fails: [], lintClean: true,
    model: 'anthropic/claude-sonnet-5', family: 'sci', tier: 'standard',
  };

  it('DELIVERS the best-so-far instead of apologising', async () => {
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
  });

  it('and it renders the candidate the ladder was holding, not the empty document', async () => {
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    seed();

    await Worker.process(JOB);

    const drawn = mockRenderLessonPlan.mock.calls.map((c) => c[0].lpDoc);
    expect(drawn).toContainEqual(BEST);
  });

  it('the row SAYS SO — over_time true, status and error_code agreeing', async () => {
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    seed();

    await Worker.process(JOB);

    expect(patchOf('ready').payload).toMatchObject({
      status: 'ready',
      over_time: true,
      error_code: null,      // bd-7yxsu: a delivered lesson never reads as errored
      rounds_used: 3,
      page_count: 11,
    });
  });

  it('emits lp612.deliver.over_time with the rounds and the clock it blew', async () => {
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    seed();

    await Worker.process(JOB);

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.deliver.over_time');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({ segmentId: JOB.segmentId, rounds: 3, timeoutMs: 150 });
    expect(typeof ev[1].elapsedMs).toBe('number');
  });

  it('a lesson that finished in time records over_time FALSE — never left ambiguous', async () => {
    delete process.env.LP612_AUTHOR_TIMEOUT_MS;
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1,
      model: 'anthropic/claude-sonnet-5',
    });
    seed();

    await Worker.process(JOB);

    expect(patchOf('ready').payload.over_time).toBe(false);
  });

  it('a candidate that is NOT deliverable still fails — a clipped page is not a lesson', async () => {
    // OVERFLOW means content is cut off the bottom of a page. However long she has waited, that
    // is a broken document and she must not be sent it.
    mockAuthorLessonPlan.mockImplementation(laddersForever({
      ...deliverableCandidate,
      deliverable: false,
      fails: ['OVERFLOW on s2: content is 40px taller than the page.'],
    }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('AUTHOR_TIMEOUT');
    expect(mockDeliverRender).not.toHaveBeenCalled();
  });

  it('with NOTHING in hand it fails, exactly as before', async () => {
    mockAuthorLessonPlan.mockImplementation(() => new Promise(() => {}));   // never publishes
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('AUTHOR_TIMEOUT');
  });

  it('a NON-timeout failure is untouched — a recovery must not swallow a real error', async () => {
    mockAuthorLessonPlan.mockImplementation((args) => {
      if (args.onCandidate) args.onCandidate(deliverableCandidate);
      return Promise.reject(Object.assign(new Error('page truth missing'), { code: 'PAGE_TRUTH_MISSING' }));
    });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('PAGE_TRUTH_MISSING');
  });

  it('if the recovery render itself fails, the lesson fails as AUTHOR_TIMEOUT — not as a new code', async () => {
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    mockRenderLessonPlan.mockRejectedValue(Object.assign(new Error('browser gone'), {
      code: 'RENDER_FAILED', infra: true, problems: ['browser gone'],
    }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('AUTHOR_TIMEOUT');
  });

  it('the Urdu overlay pass is SKIPPED on a recovery — she has waited long enough', async () => {
    // Another ~150s to translate, after she has already waited past the timeout, is the wrong
    // trade. She gets the English lesson with the honest caption that already exists for it.
    mockAuthorLessonPlan.mockImplementation(laddersForever(deliverableCandidate));
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: SEGMENT, error: null });

    const out = await Worker.process({ ...JOB, lang: 'ur' });

    expect(out.status).toBe('ready');
    expect(mockOverlayLessonPlan).not.toHaveBeenCalled();
    expect(patchOf('ready').payload).toMatchObject({ over_time: true, overlay_dropped: true });
    expect(eventNames()).toContain('lp612.overlay.deferred');
  });
});
