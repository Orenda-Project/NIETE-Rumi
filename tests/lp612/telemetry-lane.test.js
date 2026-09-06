/**
 * bd-86ivw — the 6-12 lane has to be answerable by QUERY, not by reading prose logs.
 *
 * Every stage of this lane already writes a `logToFile` line, and those lines DO reach the
 * external log backend (logger.js routes them through console.log, which structured-logger has
 * overridden into pino → the dual-output stream → the Axiom batcher). What they do not have is a
 * STABLE EVENT NAME. "LP 6-12: served from cache" is a sentence; a sentence cannot be counted,
 * grouped or alerted on, and it changes the day someone improves the wording.
 *
 * So each stage additionally emits ONE semantic event on the repo's existing taxonomy
 * (`feature.action.result`, via structured-logger's `logEvent` — the same convention
 * `vision.analysis.completed` and `student_video.feedback.button_tapped` already use). No new
 * logger, no restructuring, no dependency.
 *
 * THIS FILE DRIVES THE REAL CALL PATH, endpoint → serving, with only the boundaries doubled
 * (supabase, WhatsApp, the queue, R2, the catalog). The repo's TDD rule is explicit that a helper
 * test proves nothing when the production caller passes its own arguments — the 6-12 lane has
 * already been bitten by exactly that (the worker passed `model` explicitly, so the service's own
 * family-aware default was dead code while its unit tests were green). `serveLp612` is not
 * exported, and that is the point: the only way to prove the tap event fires is to go in through
 * `handlePakistanLpDataExchange`, which is what the Flow calls.
 */

const mockRequestLessonSpy = jest.fn();
const mockSegmentById = jest.fn();
const mockQueueJob = jest.fn();
const mockSendMessage = jest.fn();
// bd-m1xyt: deliverRender now checks this return and retries/throws on a falsy one.
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockGetPresignedUrl = jest.fn().mockResolvedValue('https://signed.example/x.pdf');
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
  buildGradeItems: jest.fn(),
  buildSubjectItems: jest.fn(),
  buildChapterItems: jest.fn(),
  buildSegmentItems: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
// The queue singleton: queueJob reads `this.queueUrl`, so the double keeps its receiver.
const queueModule = {
  __isQueueSingleton: true,
  queueJob(...args) {
    if (!this || this.__isQueueSingleton !== true) throw new TypeError('queueJob lost its receiver');
    return mockQueueJob(...args);
  },
};
jest.mock('../../bot/shared/services/queue', () => queueModule);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`, deliverOxbridgeLp: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn().mockResolvedValue(new Set()),
  downloadedLessonIds: jest.fn().mockResolvedValue(new Set()),
  deliverV8Lesson: jest.fn(),
}));

// ── supabase double ─────────────────────────────────────────────────────────
// `users` answers the endpoint's phone lookup; `niete_lp612_renders` answers serving's
// findRender/insert. Results are queued per test.
const renderResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    if (table === 'users') {
      return Promise.resolve({
        data: { phone_number: '923001234567', preferred_language: 'en' }, error: null,
      });
    }
    return Promise.resolve(renderResults.length ? renderResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: jest.fn(() => Promise.resolve({ data: 'joined', error: null })),
}));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');

const SEGMENT_ID = 'grade_9_chemistry.c01.p007-008';
const SEGMENT = {
  segment_id: SEGMENT_ID,
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'Chapter One',
  subtopic_title: 'Branches of chemistry',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
};

/** The lane is fire-and-forget by design — data_exchange returns before serving finishes. */
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  jest.clearAllMocks();
  renderResults.length = 0;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/x.pdf');
  process.env.LP_612_ENABLED = 'true';
  delete process.env.LP_612_LANG_MENU;
});

afterEach(() => {
  delete process.env.LP_612_ENABLED;
});

const tap = () => Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
  step: 'lp612_segment', segment_id: SEGMENT_ID,
});

// ── the tap ─────────────────────────────────────────────────────────────────

describe('the tap emits one semantic event', () => {
  test('lp612.tap.received carries the segment, the language and the correlation id', async () => {
    renderResults.push({ data: null, error: null });          // findRender: absent
    renderResults.push({ data: { id: 'render-new' }, error: null }); // the claim
    await tap();
    await flush();

    expect(named('lp612.tap.received')).toHaveLength(1);
    expect(named('lp612.tap.received')[0][1]).toMatchObject({
      segmentId: SEGMENT_ID,
      lang: 'en',
      userId: 'user-1',
      // The lane's correlation id is built at the tap and threaded into the render row and the
      // SQS envelope — it is the ONE key that joins tap, queue, author, render and deliver.
      correlationId: `lp612:${SEGMENT_ID}:user-1`,
    });
  });
});

// ── the serving decision ────────────────────────────────────────────────────

describe('every serving outcome emits exactly one event, named for the outcome', () => {
  test('a miss that is queued emits lp612.serve.queued with the render id', async () => {
    renderResults.push({ data: null, error: null });
    renderResults.push({ data: { id: 'render-new' }, error: null });
    await tap();
    await flush();

    expect(named('lp612.serve.queued')).toHaveLength(1);
    expect(named('lp612.serve.queued')[0][1]).toMatchObject({
      outcome: 'queued',
      segmentId: SEGMENT_ID,
      lang: 'en',
      renderId: 'render-new',
      correlationId: `lp612:${SEGMENT_ID}:user-1`,
    });
    expect(typeof named('lp612.serve.queued')[0][1].elapsedMs).toBe('number');
  });

  test('a cache hit emits lp612.serve.cache_hit AND carries the renderId it served from', async () => {
    // The cache-hit line logs segmentId/lang/tv today and NOT the render id — so "which cached
    // row did she actually get?" is unanswerable for the one path that serves most teachers.
    renderResults.push({
      data: {
        id: 'render-cached', status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf',
        one_screen: 'Summary.', overlay_dropped: false,
      },
      error: null,
    });
    await tap();
    await flush();

    expect(named('lp612.serve.cache_hit')).toHaveLength(1);
    expect(named('lp612.serve.cache_hit')[0][1]).toMatchObject({
      outcome: 'cache_hit',
      renderId: 'render-cached',
      segmentId: SEGMENT_ID,
      lang: 'en',
    });
  });

  test('a held segment emits lp612.serve.held — a refusal is an outcome, not a silence', async () => {
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    await tap();
    await flush();

    expect(named('lp612.serve.held')).toHaveLength(1);
    expect(named('lp612.serve.held')[0][1]).toMatchObject({ outcome: 'held', segmentId: SEGMENT_ID });
  });

  test('a recursive re-decide still emits ONE event for the request, not one per attempt', async () => {
    // requestLesson re-enters itself when the row moves under it. A per-attempt event would
    // double-count every race in the dashboard.
    renderResults.push({
      data: { id: 'render-live', status: 'authoring', started_at: new Date().toISOString() },
      error: null,
    });
    // the join answers 'not_authoring' → re-decide, and the second pass finds a ready row
    require('../../bot/shared/config/supabase').rpc
      .mockResolvedValueOnce({ data: 'not_authoring', error: null });
    renderResults.push({
      data: {
        id: 'render-live', status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf', overlay_dropped: false,
      },
      error: null,
    });

    await tap();
    await flush();

    const serveEvents = mockLogEvent.mock.calls.filter((c) => String(c[0]).startsWith('lp612.serve.'));
    expect(serveEvents).toHaveLength(1);
    expect(serveEvents[0][0]).toBe('lp612.serve.cache_hit');
  });
});
