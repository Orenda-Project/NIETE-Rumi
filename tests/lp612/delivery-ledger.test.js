/**
 * Every 6-12 lesson a teacher RECEIVED leaves a durable row — so /quiz can list it.
 *
 * THE HOLE. A 6-12 lesson served from the cache wrote nothing about the teacher to the database:
 * the Redis LP shelf (24 h, cap 5, flushed on every quiz/coaching/video start) and a log line.
 * `niete_lp612_renders.requested_by` names only the FIRST requester, and `waiters` is emptied the
 * moment the render is done. On production, 10–24 Sep 2026, 1,439 of 3,392 serves were cache hits
 * (and the share grows as the cache fills), so "which 6-12 lessons did this teacher get?" had no
 * answer for most lessons — and a quiz menu that lists a teacher's recent lessons cannot be built
 * on "no answer".
 *
 * THE FIX. `deliverRender` — the ONE function both the cache-hit path and the worker's waiter loop
 * call — writes `niete_lp612_deliveries` after the document send SUCCEEDS, beside the shelf push.
 * Like the shelf push it is soft: the lesson is the document, and a ledger that cannot be written
 * never costs the teacher the thing she asked for. A missing table (the migration not yet applied)
 * is said at error level at most once per ten minutes — not once per delivery — and retried after
 * that, so applying the migration needs no restart.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockPushToShelf = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: (...a) => mockPushToShelf(...a),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockMissingTable = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    if (t === 'niete_lp612_deliveries' && mockMissingTable) {
      const err = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.niete_lp612_deliveries' in the schema cache" } };
      const b = new Proxy({}, {
        get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : (k === 'single' || k === 'maybeSingle' ? async () => err : () => b)),
      });
      return b;
    }
    return mockDb.from(t);
  },
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const SEGMENT = {
  segment_id: 'grade_8_mathematics.c05.p071-073', book_stem: 'grade_8_mathematics', chapter_key: 'c05', grade: 8,
  subject: 'Mathematics', chapter_number: 5, chapter_title: 'Sets', subtopic_title: 'Set-builder notation',
  menu_title: 'Sets & notation', printed_page_start: 71, printed_page_end: 73,
};
const TEACHER = '11111111-1111-4111-8111-111111111111';
const RENDER = '22222222-2222-4222-8222-222222222222';
const R2_KEY = Serving.r2KeyFor(SEGMENT.segment_id, 'ur', 'v9.6');

function deliver(over = {}) {
  return Serving.deliverRender({
    phone: '923001234567', userId: TEACHER, r2Key: R2_KEY, segment: SEGMENT, lang: 'ur', oneScreen: 'x',
    renderId: RENDER, sendMaxAttempts: 1, sendRetryDelaysMs: [], ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createMemorySupabase({ niete_lp612_deliveries: [] });
  mockMissingTable = false;
  Serving.__resetDeliveryLedgerForTests && Serving.__resetDeliveryLedgerForTests();
  mockSendMessage.mockResolvedValue(true);
  mockPushToShelf.mockResolvedValue(undefined);
});

test('a delivered lesson writes one ledger row: who, which render, which exact version, when', async () => {
  mockSendDocumentByLink.mockResolvedValue(true);
  await deliver();
  const rows = mockDb.table('niete_lp612_deliveries');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual(expect.objectContaining({
    user_id: TEACHER, render_id: RENDER, segment_id: SEGMENT.segment_id, lang: 'ur', template_version: 'v9.6', surface: 'whatsapp',
  }));
  expect(Date.parse(rows[0].delivered_at)).not.toBeNaN();
});

test('a send that failed writes nothing — a record of a lesson she never received is worse than none', async () => {
  mockSendDocumentByLink.mockResolvedValue(false);
  await expect(deliver()).rejects.toThrow(/document send failed/);
  expect(mockDb.table('niete_lp612_deliveries')).toHaveLength(0);
});

test('no teacher id (nothing to key it by) writes nothing and does not throw', async () => {
  mockSendDocumentByLink.mockResolvedValue(true);
  await deliver({ userId: null });
  expect(mockDb.table('niete_lp612_deliveries')).toHaveLength(0);
});

test('the table not there yet costs the teacher nothing, and is said ONCE at error level — not per delivery', async () => {
  mockMissingTable = true;
  mockSendDocumentByLink.mockResolvedValue(true);
  await expect(deliver()).resolves.toBeUndefined();
  await expect(deliver()).resolves.toBeUndefined();
  const said = mockLog.mock.calls.filter((c) => /niete_lp612_deliveries/.test(JSON.stringify(c)));
  expect(said).toHaveLength(1);
  expect(said[0][2]).toBe('error');
  expect(mockPushToShelf).toHaveBeenCalledTimes(2);
});

test('the template version comes from the ONE key shape r2KeyFor writes', () => {
  expect(Serving.templateVersionOfKey(Serving.r2KeyFor('grade_9_physics.c01.p001-002', 'en', 'v9.7'))).toBe('v9.7');
  expect(Serving.templateVersionOfKey('something/else.pdf')).toBeNull();
});

test('once the migration lands the ledger starts recording again — no restart needed', async () => {
  mockMissingTable = true;
  mockSendDocumentByLink.mockResolvedValue(true);
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  await deliver();
  mockMissingTable = false;                        // the migration is applied
  await deliver();                                 // inside the quiet period: not retried yet
  expect(mockDb.table('niete_lp612_deliveries')).toHaveLength(0);
  const { MISSING_RETRY_MS } = require('../../bot/shared/services/lp612-deliveries.store');
  clock.mockReturnValue(now + MISSING_RETRY_MS + 1);
  await deliver();
  expect(mockDb.table('niete_lp612_deliveries')).toHaveLength(1);
  clock.mockRestore();
});
