/**
 * bd-zle0u, STEP 2, THE WORKER HALF — it delivers Urdu, and it never delivers nothing.
 *
 * Split from `overlay-pass.test.js` on purpose, not for tidiness. Both halves need a
 * `structured-logger` module mock and only one factory per module path can win in a file, so the
 * service half's `logEvent: jest.fn()` silently swallowed every event this half asserts on. The
 * tests went green on the delivery and red on the telemetry, which is the most misleading shape a
 * suite can take: it would have passed a change that delivered correctly and reported nothing.
 *
 * WHAT IS PINNED HERE, and why each is a bug that has already happened in this lane:
 *
 *   • the pass runs ONLY for an English-medium book asked for in Urdu;
 *   • a landed pass delivers the OVERLAID document — the row says `overlay_dropped: false` and
 *     carries the overlaid page count, not the English one;
 *   • **every failure delivers step 1's English PDF.** A failed call, a clock that ran out, a
 *     renderer that refuses the overlaid document. Twice this week a fix for "she gets the wrong
 *     language" shipped as "she gets nothing", and both times that was worse than the bug;
 *   • the pass is MEASURED on both paths (`lp612.overlay.pass`) — a denominator that only exists
 *     when things go wrong is not a denominator;
 *   • a failure after an ATTEMPT is a `dropped`, never a `deferred`. Step 1 made that distinction
 *     and it only stays true if this half honours it.
 */

// ── 2 · the worker: it delivers Urdu, and never delivers nothing ────────────

describe('the worker runs the pass after acceptance, and falls back to English — never to silence', () => {
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
    segmentId: 'grade_8_mathematics.c01.p006-009',
    lang: 'ur',
    templateVersion: 'v9.1',
    correlationId: 'corr-1',
  };
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_8_mathematics', grade: 8, subject: 'Mathematics',
    subtopic_title: 'Rational & irrational numbers', printed_page_start: 6, printed_page_end: 9,
    language: 'en', is_religious: false,
  };
  const OVERLAY = { '/one_screen': 'خلاصہ', '/materials/0': 'تختۂ سیاہ' };

  const englishRender = () => ({
    pdfPath: '/tmp/en.pdf', htmlPath: '/tmp/en.html', pageCount: 11, warnings: [],
    pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
  });
  const urduRender = () => ({
    pdfPath: '/tmp/ur.pdf', htmlPath: '/tmp/ur.html', pageCount: 12, warnings: [],
    pagesByPart: { teach: 7, support: 5 }, overlayApplied: Object.keys(OVERLAY),
  });

  function seed(seg = SEGMENT) {
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: seg, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1,
      model: 'anthropic/claude-sonnet-5',
    });
    mockOverlayLessonPlan.mockResolvedValue({
      overlay: OVERLAY, usage: { calls: 1, completion_tokens: 7000, total_tokens: 15000 },
    });
    // The ladder's gate renders, then the final English render, then the overlaid render.
    mockRenderLessonPlan.mockResolvedValue(englishRender());
  });

  const readyPatch = () => mockDbCalls.filter((c) => c.op === 'update' && c.payload && c.payload.status === 'ready').pop();
  const eventNames = () => mockLogEvent.mock.calls.map((c) => c[0]);

  it('runs the pass for an EN-medium book asked for in Urdu', async () => {
    seed();
    await Worker.process(JOB);
    expect(mockOverlayLessonPlan).toHaveBeenCalledTimes(1);
  });

  it('does NOT run it for an Urdu-medium book — nothing to toggle', async () => {
    seed({ ...SEGMENT, language: 'ur' });
    await Worker.process(JOB);
    expect(mockOverlayLessonPlan).not.toHaveBeenCalled();
  });

  it('does NOT run it for an English delivery', async () => {
    seed();
    await Worker.process({ ...JOB, lang: 'en' });
    expect(mockOverlayLessonPlan).not.toHaveBeenCalled();
  });

  it('delivers the OVERLAID document — overlay_dropped false, lp612.overlay.applied', async () => {
    mockRenderLessonPlan
      .mockResolvedValueOnce(englishRender())   // the final English render
      .mockResolvedValueOnce(urduRender());     // the overlaid render
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(readyPatch().payload).toMatchObject({ overlay_dropped: false, page_count: 12 });
    expect(eventNames()).toContain('lp612.overlay.applied');
  });

  it('the overlay pass is MEASURED — its own event with the call time and the pointer count', async () => {
    mockRenderLessonPlan
      .mockResolvedValueOnce(englishRender())
      .mockResolvedValueOnce(urduRender());
    seed();

    await Worker.process(JOB);

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.overlay.pass');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({ segmentId: JOB.segmentId, outcome: 'applied', pointers: 2 });
    expect(typeof ev[1].elapsedMs).toBe('number');
  });

  it('A FAILED PASS DELIVERS THE ENGLISH DOCUMENT — never nothing', async () => {
    mockOverlayLessonPlan.mockRejectedValue(new Error('coverage 0.11 below the 0.5 floor'));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
    expect(readyPatch().payload).toMatchObject({ overlay_dropped: true, page_count: 11 });
    expect(eventNames()).toContain('lp612.overlay.dropped');
  });

  it('AN OVERLAID DOCUMENT THE RENDERER REFUSES ALSO DELIVERS THE ENGLISH ONE', async () => {
    // This is the exact shape that turned "she gets an English lesson" into "she gets no lesson"
    // the first time an overlay was ever produced here.
    mockRenderLessonPlan
      .mockResolvedValueOnce(englishRender())
      .mockRejectedValueOnce(Object.assign(new Error('ur_overlay errors'), {
        code: 'OVERLAY_INVALID', infra: false, problems: ['ur_overlay: pointer does not resolve: /x'],
      }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(readyPatch().payload).toMatchObject({ overlay_dropped: true, page_count: 11 });
  });

  it('the failed pass is a DROP, not a deferral — it was attempted', async () => {
    mockOverlayLessonPlan.mockRejectedValue(new Error('nope'));
    seed();
    await Worker.process(JOB);
    expect(eventNames()).toContain('lp612.overlay.dropped');
    expect(eventNames()).not.toContain('lp612.overlay.deferred');
  });

  it('the pass runs OUTSIDE the author timeout — an AUTHOR_TIMEOUT never comes from it', async () => {
    // `withTimeout(..., authorTimeoutMs(), 'AUTHOR_TIMEOUT')` wraps authoring and the English
    // render only. A pass inside it would inherit a clock that is already nearly spent, which is
    // the precise failure this whole bead exists to remove.
    process.env.LP612_AUTHOR_TIMEOUT_MS = '400';
    mockOverlayLessonPlan.mockImplementation(() => new Promise((r) => setTimeout(
      () => r({ overlay: OVERLAY, usage: { calls: 1 } }), 900,
    )));
    mockRenderLessonPlan
      .mockResolvedValueOnce(englishRender())
      .mockResolvedValueOnce(urduRender());
    seed();

    const out = await Worker.process(JOB);
    delete process.env.LP612_AUTHOR_TIMEOUT_MS;

    expect(out.status).toBe('ready');
    expect(readyPatch().payload.overlay_dropped).toBe(false);
  });

  it('and it has a bound of its OWN — an overlay call that never returns still delivers English', async () => {
    process.env.LP612_OVERLAY_TIMEOUT_MS = '150';
    mockOverlayLessonPlan.mockImplementation(() => new Promise(() => {}));   // never settles
    seed();

    const out = await Worker.process(JOB);
    delete process.env.LP612_OVERLAY_TIMEOUT_MS;

    expect(out.status).toBe('ready');
    expect(readyPatch().payload).toMatchObject({ overlay_dropped: true });
  });
});
