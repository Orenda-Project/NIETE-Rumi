/**
 * 6-12 LPs · the worker's share of the language work.
 *
 *  - `overlay_dropped` is PERSISTED: an Urdu render of an English-medium book
 *    whose ur_overlay did not survive is an essentially-English document in RTL
 *    chrome, and every teacher served from this row — first hit and every cache
 *    hit after — deserves the honest caption. A status that exists only in a
 *    log rolls off; the row is what serving reads. Rule 24(b): a silent
 *    fallback is a regression mask.
 *  - Waiters are told things in THEIR OWN ui language, per entry: two teachers
 *    waiting on one render need not share one.
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
// The delivery audience is CLAIMED at the end of the job through `lp612_claim_waiters`, rather
// than read from a snapshot taken before authoring — see tests/lp612/author-worker.test.js,
// "the audience is whoever is waiting WHEN IT FINISHES". `seed()` records the list it seeded so
// the claim returns it, which is what these language tests have always assumed happens.
let seededWaiters = [];
const mockRpc = jest.fn(() => Promise.resolve({ data: seededWaiters, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const EN_SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
  language: 'en',
};
const UR_SEGMENT = { ...EN_SEGMENT, segment_id: 'grade_10_pakstudies.c01.p006-007', language: 'ur' };

const jobFor = (lang) => ({
  renderId: 'render-1',
  segmentId: EN_SEGMENT.segment_id,
  lang,
  templateVersion: 'v9.1',
  correlationId: 'corr-1',
});

function seed(waiters, segment) {
  seededWaiters = waiters;
  mockDbResults.push({
    data: { id: 'render-1', status: 'authoring', waiters },
    error: null,
  });
  mockDbResults.push({ data: segment, error: null });
}

const readyPatch = () => mockDbCalls.find(
  (c) => c.op === 'update' && c.payload && c.payload.status === 'ready',
);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], rounds: 1,
    model: 'anthropic/claude-sonnet-5',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
    overlayApplied: [],
  });
  mockDeliverRender.mockResolvedValue();
});

// ── overlay_dropped is a persisted fact, not a log line ─────────────────────

describe('overlay_dropped on the render row', () => {
  test('ur render of an EN-medium book with NO overlay applied → dropped, and delivery says so', async () => {
    seed([{ user_id: 'u1', phone: '92300', ui_lang: 'ur' }], EN_SEGMENT);
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 12, warnings: [],
      overlayApplied: [],
    });

    await Worker.process(jobFor('ur'));

    expect(readyPatch().payload.overlay_dropped).toBe(true);
    expect(mockDeliverRender).toHaveBeenCalledWith(expect.objectContaining({
      overlayDropped: true,
    }));
  });

  test('ur render whose overlay DID apply is not flagged', async () => {
    seed([{ user_id: 'u1', phone: '92300', ui_lang: 'ur' }], EN_SEGMENT);
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 12, warnings: [],
      overlayApplied: ['/sections/0/blocks/0/text'],
    });

    await Worker.process(jobFor('ur'));

    expect(readyPatch().payload.overlay_dropped).toBe(false);
    expect(mockDeliverRender).toHaveBeenCalledWith(expect.objectContaining({
      overlayDropped: false,
    }));
  });

  test('a UR-medium book needs no overlay — never flagged', async () => {
    seed([{ user_id: 'u1', phone: '92300', ui_lang: 'ur' }], UR_SEGMENT);
    await Worker.process({ ...jobFor('ur'), segmentId: UR_SEGMENT.segment_id });
    expect(readyPatch().payload.overlay_dropped).toBe(false);
  });

  test('an English render is never flagged', async () => {
    seed([{ user_id: 'u1', phone: '92300', ui_lang: 'en' }], EN_SEGMENT);
    await Worker.process(jobFor('en'));
    expect(readyPatch().payload.overlay_dropped).toBe(false);
  });
});

// ── each waiter hears failure in her own language ───────────────────────────

describe('waiters are told things in their own ui language', () => {
  test('a failure reaches an Urdu-UI waiter in Urdu and an English-UI waiter in English', async () => {
    seed([
      { user_id: 'u1', phone: '92300UR', ui_lang: 'ur' },
      { user_id: 'u2', phone: '92300EN', ui_lang: 'en' },
    ], EN_SEGMENT);
    mockAuthorLessonPlan.mockRejectedValue(Object.assign(new Error('boom'), { code: 'AUTHOR_FAILED' }));

    await Worker.process(jobFor('en'));

    expect(mockSendMessage).toHaveBeenCalledWith('92300UR', UX_STRINGS.lp612Failed.ur);
    expect(mockSendMessage).toHaveBeenCalledWith('92300EN', UX_STRINGS.lp612Failed.en);
  });

  test('a waiter with no ui_lang falls back to the job language', async () => {
    seed([{ user_id: 'u1', phone: '92300' }], EN_SEGMENT);
    mockAuthorLessonPlan.mockRejectedValue(Object.assign(new Error('boom'), { code: 'AUTHOR_FAILED' }));

    await Worker.process(jobFor('en'));

    expect(mockSendMessage).toHaveBeenCalledWith('92300', UX_STRINGS.lp612Failed.en);
  });
});
