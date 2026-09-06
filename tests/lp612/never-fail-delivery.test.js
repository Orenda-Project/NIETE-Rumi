/**
 * A LESSON IS NEVER LOST FOR A DEFECT THAT ONLY MAKES IT UGLIER — bd-oak77.14.
 *
 * The third and last of the never-lose rules, after LENGTH (bd-vjk68, `over_cap`) and TIME
 * (bd-0cdug, `over_time`). This one is about DAMAGE, and it was written by production.
 *
 * 2026-09-06, the FIRST Urdu tap on prod. `grade_12_chemistry.c14.p227-230`, row
 * `c41e8fd2-f401-42bc-a177-0897f36a1678`. Tapped 14:30:47Z, failed 14:35:59Z. The final render's
 * `problems[]`, verbatim from `niete-logs`:
 *
 *   FIGURE TOO SMALL: diagram "molecule" … 13.25px in a 729px column (floor 13.5px) …
 *   PAGE COUNT: teach needs 10 pages; the cap is 7.
 *   PAGE COUNT: support needs 7 pages; the cap is 6.
 *
 * A MIXED set, so `pageOnly` could not fire, so a finished 17-page PDF already on disk was
 * replaced with "I could not finish that lesson plan this time." The teacher re-typed "Lesson
 * plan" 43 seconds later and re-tapped; the SECOND run of the same segment delivered — the same
 * cell, the same code, a different roll of the authoring dice. A failure nobody can reproduce is
 * not a quality gate, it is a coin toss the teacher pays for.
 *
 * Operator, 2026-09-06: *"There should be no failures… whatever it is in the container, in the
 * template, or in the render that causes that delay, we need to aggressively find it and take it
 * down."* And 2026-09-04: *"we will stop cancelling or delaying lesson plans now because of the
 * length issue."*
 *
 * THE RULE, and it lives in ONE place (`lp612-render-policy.service.js`) so the worker, the
 * ladder's timeout recovery and the Urdu overlay fallback cannot drift apart:
 *
 *   delivered, `over_cap`         — PAGE COUNT. Unchanged.
 *   delivered, `render_degraded`  — FIGURE TOO SMALL/TALL, TYPE FLOOR, OVERFLOW, and any defect
 *                                   string the renderer may learn to emit. The lesson is whole;
 *                                   something on the page is uglier than we wanted, and she is
 *                                   TOLD which kind (rule 24(d)).
 *   FAILED                        — only when there is no document: an infra blow-up, a schema or
 *                                   overlay refusal (no PDF was ever written), or TRUNCATION
 *                                   (pages of her lesson are MISSING FROM THE FILE — the plan
 *                                   just ends). `LP612_DELIVER_TRUNCATED=true` is the operator's
 *                                   one-variable override.
 *
 * Red-first on the base branch: the whole first describe block fails there, on the exact
 * production defect set.
 */

describe('the worker delivers a damaged-but-whole lesson instead of failing it', () => {
  const mockAuthorLessonPlan = jest.fn();
  const mockOverlayLessonPlan = jest.fn();
  const mockRenderLessonPlan = jest.fn();
  const mockUploadBuffer = jest.fn();
  const mockDeliverRender = jest.fn();
  const mockReadFile = jest.fn();
  const mockLogEvent = jest.fn();
  const mockSendMessage = jest.fn();

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
  jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: (...a) => mockSendMessage(...a) }));
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
  const WAITERS = [{ user_id: 'u1', phone: '923126218379' }];
  const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
  jest.mock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => mockBuilder(t)),
    rpc: (...a) => mockRpc(...a),
  }));

  const Worker = require('../../bot/workers/lp612-author.worker');
  const { deliveryVerdict } = require('../../bot/shared/services/lp612-render-policy.service');

  // The production job, as it was.
  const JOB = {
    renderId: 'c41e8fd2-f401-42bc-a177-0897f36a1678',
    segmentId: 'grade_12_chemistry.c14.p227-230',
    lang: 'ur',
    templateVersion: 'v9.1',
    correlationId: 'corr-1788705048852-7x6lczb3d',
  };
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_12_chemistry', grade: 12, subject: 'Chemistry',
    subtopic_title: 'AI in drug discovery', printed_page_start: 227, printed_page_end: 230,
    language: 'en', is_religious: false,
  };

  /** The three defect strings from the prod run, verbatim. */
  const FIGURE = 'FIGURE TOO SMALL: diagram "molecule" (Not printed in the book — supplied to sh) '
    + 'renders its smallest label at 13.25px in a 729px column (floor 13.5px). It needs 743px of '
    + 'width — give it a full-width row, or simplify it.';
  const TEACH = 'PAGE COUNT: teach needs 10 pages; the cap is 7. Cut it, or move content to the other part.';
  const SUPPORT = 'PAGE COUNT: support needs 7 pages; the cap is 6. Cut it, or move content to the other part.';
  const OVERFLOW = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';
  const TRUNC = 'TRUNCATION: the PDF has 6 page(s) but the layout built 17 — 11 page(s) of the lesson are MISSING from the file.';

  const defectError = (problems) => Object.assign(new Error('render produced defects'), {
    code: 'RENDER_FAILED',
    infra: false,
    problems,
    warnings: [],
    htmlPath: '/tmp/x.html',
    pdfPath: '/tmp/x.pdf',
    pageCount: 17,
    pagesByPart: { teach: 10, support: 7 },
    overlayApplied: [],
  });

  function seed() {
    mockDbResults.push({ data: { id: JOB.renderId, status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: SEGMENT, error: null });
  }
  const lastUpdate = () => mockDbCalls.filter((c) => c.op === 'update').pop();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    delete process.env.LP612_DELIVER_TRUNCATED;
    process.env.LP612_OVERLAY_PASS_OFF = 'true';   // the overlay pass has its own suite
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: false, fails: [], warns: [], rounds: 3,
      model: 'anthropic/claude-sonnet-5',
    });
  });
  afterEach(() => { delete process.env.LP612_OVERLAY_PASS_OFF; });

  test('THE PRODUCTION SET — figure + two page counts — is DELIVERED, not failed', async () => {
    mockRenderLessonPlan.mockRejectedValue(defectError([FIGURE, TEACH, SUPPORT]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
  });

  test('the row carries BOTH flags, and they mean different things', async () => {
    // `over_cap` = long. `render_degraded` = damaged. The prod document was both, and one column
    // cannot answer both questions.
    mockRenderLessonPlan.mockRejectedValue(defectError([FIGURE, TEACH, SUPPORT]));
    seed();

    await Worker.process(JOB);

    expect(lastUpdate().payload).toMatchObject({
      status: 'ready',
      over_cap: true,
      render_degraded: true,
      error_code: null,      // bd-7yxsu: a delivered lesson never reads as errored
      page_count: 17,
    });
  });

  test('it emits lp612.deliver.degraded with the CLASSES and the defect strings', async () => {
    mockRenderLessonPlan.mockRejectedValue(defectError([FIGURE, TEACH, SUPPORT]));
    seed();

    await Worker.process(JOB);

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.deliver.degraded');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({
      renderId: JOB.renderId,
      segmentId: JOB.segmentId,
      lang: 'ur',
      classes: ['figure'],
    });
    // the strings themselves, so the weekly read does not need the render event too
    expect(ev[1].problems).toContain(FIGURE);
  });

  test('a lesson with NO defects records render_degraded FALSE — never left ambiguous', async () => {
    // Same reasoning as `over_cap` (bd-vjk68) and `over_time` (bd-0cdug): a column an UPDATE does
    // not name keeps its old value, so a retry after a degraded attempt would inherit `true`.
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 11, warnings: [],
      pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
    });
    seed();

    await Worker.process(JOB);

    expect(lastUpdate().payload.render_degraded).toBe(false);
    expect(mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.deliver.degraded')).toBeUndefined();
  });

  test('an OVERFLOW is delivered too — a crowded page is not a lost lesson', async () => {
    mockRenderLessonPlan.mockRejectedValue(defectError([OVERFLOW]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(lastUpdate().payload).toMatchObject({ render_degraded: true, over_cap: false });
  });

  test('TRUNCATION still fails — pages of her lesson are missing from the file', async () => {
    // The one class where a retry genuinely beats what we have. The PDF ENDS mid-lesson.
    mockRenderLessonPlan.mockRejectedValue(defectError([TEACH, TRUNC]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('failed');
    expect(mockDeliverRender).not.toHaveBeenCalled();
  });

  test('LP612_DELIVER_TRUNCATED=true is the operator\'s one-variable override', async () => {
    process.env.LP612_DELIVER_TRUNCATED = 'true';
    mockRenderLessonPlan.mockRejectedValue(defectError([TRUNC]));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(lastUpdate().payload.render_degraded).toBe(true);
  });

  test('an Urdu OVERLAY that draws TOO TALL now ships IN URDU, degraded, instead of falling back to English', async () => {
    // bd-o4dsl, and this is the quiet win of the policy. The overlay pass renders the OVERLAID
    // document; an Urdu label wraps taller than its English original, so `FIGURE TOO TALL` fired
    // and the whole Urdu render was discarded — the teacher got the English PDF with the honest
    // caption. Under the new verdict that render is DELIVERABLE, so she gets the Urdu lesson with
    // one tall diagram and a line saying a page looks tight. A tall figure is a worse page; an
    // English document is a worse LESSON.
    delete process.env.LP612_OVERLAY_PASS_OFF;
    mockOverlayLessonPlan.mockResolvedValue({
      overlay: { '/sections/0/blocks/0/text': 'اردو' },
      coverage: 1,
      usage: { total_tokens: 1, completion_tokens: 1, calls: 1 },
    });
    // first call = the English final render (clean); second = the overlaid one (too tall)
    mockRenderLessonPlan
      .mockResolvedValueOnce({
        pdfPath: '/tmp/en.pdf', htmlPath: '/tmp/en.html', pageCount: 11, warnings: [],
        pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
      })
      .mockRejectedValueOnce(Object.assign(new Error('render produced defects'), {
        code: 'RENDER_FAILED',
        infra: false,
        problems: ['FIGURE TOO TALL: diagram "grid" needs 1309px of height to stay readable, '
          + 'which is more than one page (1109px). Split it or simplify it.'],
        warnings: [],
        htmlPath: '/tmp/ur.html',
        pdfPath: '/tmp/ur.pdf',
        pageCount: 12,
        pagesByPart: { teach: 7, support: 5 },
        overlayApplied: ['/sections/0/blocks/0/text'],
      }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    const row = lastUpdate().payload;
    expect(row).toMatchObject({ status: 'ready', render_degraded: true });
    // SHE HAS URDU. `overlay_dropped` false is the whole point — the fallback did not fire.
    expect(row.overlay_dropped).toBe(false);
    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.overlay.pass');
    expect(ev[1]).toMatchObject({ outcome: 'applied', pointers: 1 });
  });

  test('an infra render failure still fails — there is no PDF to deliver', async () => {
    mockRenderLessonPlan.mockRejectedValue(Object.assign(new Error('browser gone'), {
      code: 'RENDER_FAILED', infra: true, problems: ['browser gone'],
    }));
    seed();

    expect((await Worker.process(JOB)).status).toBe('failed');
  });

  test('a defect throw with no pdfPath still fails — the belt to the braces', async () => {
    const e = defectError([FIGURE]);
    delete e.pdfPath;
    mockRenderLessonPlan.mockRejectedValue(e);
    seed();

    expect((await Worker.process(JOB)).status).toBe('failed');
  });
});

describe('the delivery verdict is one predicate, and it is exported', () => {
  const { deliveryVerdict, classifyProblems } = require('../../bot/shared/services/lp612-render-policy.service');
  const has = (p) => deliveryVerdict(p, { hasPdf: true, infra: false });

  test('page counts alone are over_cap, not degraded — a long lesson is not a damaged one', () => {
    const v = has(['PAGE COUNT: teach needs 10 pages; the cap is 7.']);
    expect(v).toMatchObject({ deliverable: true, overCap: true, degraded: false, classes: [] });
  });

  test('an UNKNOWN defect string degrades rather than fails', () => {
    // Adding a finding to the renderer must never silently start failing lessons.
    const v = has(['SOMETHING NEW: a finding this policy has never seen']);
    expect(v).toMatchObject({ deliverable: true, degraded: true, classes: ['other'] });
  });

  test('no PDF is never deliverable, whatever the list says', () => {
    expect(deliveryVerdict([], { hasPdf: false }).deliverable).toBe(false);
    expect(deliveryVerdict(['PAGE COUNT: x'], { infra: true }).deliverable).toBe(false);
  });

  test('every renderer prefix in the codebase is classified — an unmatched one is a silent policy hole', () => {
    const fs = require('fs');
    const path = require('path');
    const R = fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'render_lp.js'), 'utf8');
    const T = fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lib', 'template.js'), 'utf8');
    // Every literal the renderer pushes into `problems` starts with one of these.
    const prefixes = new Set();
    for (const src of [R, T]) {
      for (const m of src.matchAll(/`([A-Z][A-Z ]{3,}?)(?::| on )/g)) prefixes.add(m[1].trim());
    }
    expect(prefixes.size).toBeGreaterThan(3);
    for (const p of prefixes) {
      // Two shapes exist in the renderer: `CODE: message` and `OVERFLOW on <page>: message`.
      // At least one of them must be recognised, or the prefix has no home in the policy.
      const colon = classifyProblems([`${p}: probe`]).other.length === 0;
      const onPage = classifyProblems([`${p} on p1: probe`]).other.length === 0;
      expect({ prefix: p, classified: colon || onPage }).toEqual({ prefix: p, classified: true });
    }
  });
});
