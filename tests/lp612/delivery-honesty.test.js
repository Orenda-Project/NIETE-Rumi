/**
 * bd-m1xyt — a lesson that never arrived must never be counted as delivered.
 *
 * THE BUG. `sendDocumentByLink` NEVER throws (see whatsapp.service.js:785) — every failure (a
 * Meta 5xx, a rate limit, an expired 24h window, a bad token) is caught INTERNALLY and reported
 * back as a plain `false`. `deliverRender` used to `await` that call and ignore what came back:
 * it recorded the delivery on the LP shelf, scheduled a "was that useful?" feedback prompt, and
 * — via the worker's per-waiter loop, which only ever sees a resolved promise — counted the
 * teacher as `delivered`. Every surface (`recordDelivery`, the feedback prompt, `delivered`,
 * `lp612.deliver.completed`) reported success for a lesson that never left the building.
 *
 * PRODUCTION EVIDENCE (Axiom, `niete-logs`, 14-day window): `sendDocumentByLink` fails ~30-50
 * times a day, every day — not an incident. Sampling the last 3 days, 97% of failures carry Meta
 * error 131056, the (Business Account, Consumer Account) PAIR RATE LIMIT — not a broken token or
 * an expired window. A tight, fast retry does not recover from a rate limit; it deepens it for
 * the exact teacher it exists to help. That is why the retry below backs off in SECONDS, keeps
 * the attempt count low, and shares one deadline across an entire delivery loop rather than
 * resetting per waiter — see the constants and comments in lp612-serving.service.js.
 *
 * THE FIX, in three parts: (1) a falsy or thrown `sendDocumentByLink` response is retried a
 * small, bounded number of times with real backoff; (2) exhausting the retry budget makes
 * `deliverRender` THROW, which both existing callers already handle — the cache-hit branch of
 * `requestLessonImpl` turns it into `deliver_failed`, the worker's per-waiter loop turns it into
 * `deliveryFailures`; (3) `recordDelivery()` and the feedback prompt run ONLY after a send that
 * actually reported success, never before.
 *
 * `WhatsAppService.sendDocumentByLink` is the ONLY thing mocked at the network boundary here —
 * `lp612-serving.service` itself is the real module. Mocking the module under test would prove
 * nothing about whether the fix actually runs on the real call path (root CLAUDE.md rule 6).
 */

const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn();
const mockPushToShelf = jest.fn().mockResolvedValue(undefined);
const mockScheduleFeedbackPrompt = jest.fn();
const mockLogEvent = jest.fn();
const mockGetPresignedUrl = jest.fn().mockResolvedValue('https://signed.example/x.pdf');
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: (...a) => mockPushToShelf(...a),
}));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({
  scheduleFeedbackPrompt: (...a) => mockScheduleFeedbackPrompt(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

// Just enough of a supabase double to walk requestLesson's cache-hit branch.
const mockDbResults = [];
function mockBuilder() {
  const settle = () => Promise.resolve(
    mockDbResults.length ? mockDbResults.shift() : { data: null, error: null },
  );
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: settle, maybeSingle: settle, then: (r, j) => settle().then(r, j),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockBuilder(), rpc: jest.fn() }));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  chapter_key: 'c01',
  grade: 9,
  subject: 'Chemistry',
  chapter_number: 1,
  chapter_title: 'Chapter One',
  subtopic_title: 'Branches of chemistry',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
};

// Zero delays in every test unless a test is specifically about timing — production uses real
// seconds-scale backoff (see the constants in lp612-serving.service.js); waiting for it here
// would only slow the suite down without proving anything a fake delay cannot.
const deliver = (over = {}) => Serving.deliverRender({
  phone: '923001234567',
  userId: 'user-1',
  r2Key: 'lp612/v9.1/en/x.pdf',
  segment: SEGMENT,
  lang: 'en',
  oneScreen: 'Summary.',
  sendRetryDelaysMs: [0, 0],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbResults.length = 0;
  mockSendMessage.mockResolvedValue(true);
  mockPushToShelf.mockResolvedValue(undefined);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/x.pdf');
  mockSegmentById.mockResolvedValue(SEGMENT);
});

describe('a falsy sendDocumentByLink return is a failed delivery, not a successful one', () => {
  test('THE RED TEST — a `false` return must not resolve as a successful delivery', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);

    // On unfixed code this resolves cleanly (the return value is ignored). After the fix it must
    // reject, so the two callers' existing catch blocks turn it into deliver_failed/deliveryFailures.
    await expect(deliver()).rejects.toThrow();
  });

  test('a failed send does NOT call recordDelivery — no shelf entry for a lesson she never got', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver()).rejects.toThrow();
    expect(mockPushToShelf).not.toHaveBeenCalled();
  });

  test('a failed send does NOT schedule the "was that useful?" prompt', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver()).rejects.toThrow();
    expect(mockScheduleFeedbackPrompt).not.toHaveBeenCalled();
  });

  test('a THROWN sendDocumentByLink is treated the same as a falsy return', async () => {
    // sendDocumentByLink is documented never to throw, but deliverRender must not depend on that
    // holding forever.
    mockSendDocumentByLink.mockRejectedValue(new Error('ECONNRESET'));
    await expect(deliver()).rejects.toThrow();
    expect(mockPushToShelf).not.toHaveBeenCalled();
  });
});

describe('a retry is attempted before giving up — bounded, because 131056 is a rate limit', () => {
  test('a transient failure that recovers on retry still counts as a real delivery', async () => {
    mockSendDocumentByLink
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(deliver()).resolves.not.toThrow();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(2);
    expect(mockPushToShelf).toHaveBeenCalledTimes(1);
    expect(mockScheduleFeedbackPrompt).toHaveBeenCalledTimes(1);
  });

  test('the retry budget is small and bounded, not open-ended', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver()).rejects.toThrow();
    // The exact number is a deliberate, documented choice (see the constants in the service) —
    // pinned here so a future change to it is a conscious edit, not a silent drift.
    expect(mockSendDocumentByLink.mock.calls.length).toBe(3);
  });

  test('a shared delivery deadline stops retrying early rather than blowing the job budget', async () => {
    // Many waiters failing in the same job share ONE deadline (see lp612-author.worker.js) so
    // that a pile-up cannot push the job past its SQS visibility window. An already-expired
    // deadline must still make the FIRST attempt — every waiter is owed at least one try — but
    // skip the retry wait.
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver({
      sendRetryDelaysMs: [1000, 1000],
      sendDeadlineAt: Date.now() - 1,
    })).rejects.toThrow();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });
});

describe('a delivery failure is a distinct, queryable event', () => {
  test('emits a structured event naming phone, renderId, segmentId, lang and the attempt count', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver({ renderId: 'render-77' })).rejects.toThrow();

    const call = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.send.failed');
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({
      renderId: 'render-77',
      segmentId: SEGMENT.segment_id,
      lang: 'en',
      phone: '923001234567',
      userId: 'user-1',
      attempts: 3,
    });
  });

  test('a delivery that succeeds emits no failure event at all', async () => {
    mockSendDocumentByLink.mockResolvedValue(true);
    await deliver();
    expect(mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.send.failed')).toBeUndefined();
  });
});

describe('the cache-hit path (the one most teachers are on) surfaces the failure too', () => {
  test('requestLesson reports deliver_failed instead of cache_hit when the send fails', async () => {
    mockDbResults.push({
      data: { id: 'render-1', status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf' }, error: null,
    });
    mockSendDocumentByLink.mockResolvedValue(false);

    const out = await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: 'user-1', phone: '923001234567', lang: 'en',
    });

    expect(out.outcome).toBe('deliver_failed');
    expect(mockPushToShelf).not.toHaveBeenCalled();
    expect(mockScheduleFeedbackPrompt).not.toHaveBeenCalled();
    // This path exercises the PRODUCTION retry defaults (requestLessonImpl calls deliverRender
    // with no overrides), which back off in real seconds — see the constants in the service.
  }, 20000);
});
