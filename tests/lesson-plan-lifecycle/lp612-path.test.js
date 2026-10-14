'use strict';
/**
 * Grade 6-12 (lp612) asks leave their lifecycle row — and nothing the teacher sees changes.
 *
 * THE HOLE. A 6-12 lesson writes no lesson_plan_requests row: a delivered lesson is a
 * niete_lp612_deliveries row with nothing tying it to its ask or its logs, and an ask that FAILS
 * (send refused, render failed, segment gone, religious hold) leaves no row at all.
 *
 * THE FIX. With LP_LIFECYCLE_PATHS on for `niete_lp612`, every ask that reaches an outcome — on
 * WhatsApp, and in the portal / teacher app (channel 'portal', her phone read from users) — writes
 * ONE lifecycle row, and the delivery-ledger row (her WhatsApp delivery, or her portal claim) names
 * it. The places that see an outcome all go through lp612-lifecycle.service.js:
 *   · deliverRender — the ONE function the cache hit and the worker's waiter loop both call:
 *     completed after a confirmed send, failed (DELIVERY_FAILED) before it throws;
 *   · the requestLesson wrapper — outcomes that end the ask there (not_found, held, error);
 *   · the worker's fail() — one failed row per WhatsApp waiter it tells.
 * A waiter entry carries its ask's correlation id (switch on only), so the worker's rows can name
 * the logs of each teacher's own tap.
 *
 * Network faked only: Supabase (stateful, in memory), WhatsApp, R2, the shelf, the survey, and the
 * 6-12 catalogue (for the outcome cases).
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockPushToShelf = jest.fn();
const mockEvent = jest.fn();
const mockSegmentById = jest.fn();

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
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockJoined = [];
let mockFailRequests = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    if (t === 'lesson_plan_requests' && mockFailRequests) {
      const err = { data: null, error: { code: '57014', message: 'statement timeout' } };
      const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : () => b) });
      return b;
    }
    return mockDb.from(t);
  },
  rpc: (...a) => mockDb.rpc(...a),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const Lp612Lifecycle = require('../../bot/shared/services/lp612-lifecycle.service');

const SEGMENT = {
  segment_id: 'grade_8_mathematics.c05.p071-073', book_stem: 'grade_8_mathematics', chapter_key: 'c05', grade: 8,
  subject: 'Mathematics', chapter_number: 5, chapter_title: 'Sets', subtopic_title: 'Set-builder notation',
  menu_title: 'Sets & notation', printed_page_start: 71, printed_page_end: 73,
};
const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RENDER = '22222222-2222-4222-8222-222222222222';
const R2_KEY = Serving.r2KeyFor(SEGMENT.segment_id, 'ur', 'v9.6');
const CORR = `lp612:${SEGMENT.segment_id}:${TEACHER}`;
const PORTAL_TEACHER = '44444444-4444-4444-8444-444444444444';
// The portal and the app name a teacher by her id alone; the writer reads her phone from users.
const USERS = [
  { id: TEACHER, phone_number: '923001234567', preferred_language: 'ur' },
  { id: PORTAL_TEACHER, phone_number: '923005550000', preferred_language: 'en' },
];

const deliver = (over = {}) => Serving.deliverRender({
  phone: '923001234567', userId: TEACHER, r2Key: R2_KEY, segment: SEGMENT, lang: 'ur', oneScreen: 'x',
  renderId: RENDER, sendMaxAttempts: 1, sendRetryDelaysMs: [],
  askedAt: '2026-10-13T05:00:00.000Z', generatedAt: '2026-10-13T05:00:00.000Z', correlationId: CORR,
  ...over,
});
const rows = (t) => mockDb.table(t);

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION', 'LP_612_RELIGIOUS_ENABLED'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  delete process.env.LP_612_RELIGIOUS_ENABLED;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockFailRequests = false;
  mockJoined = [];
  mockDb = createMemorySupabase(
    { niete_lp612_deliveries: [], lesson_plan_requests: [], niete_lp612_renders: [], users: USERS },
    { rpc: { lp612_join_waiters: (args) => { mockJoined.push(args.p_entry); return 'joined'; } } },
  );
  Serving.__resetDeliveryLedgerForTests && Serving.__resetDeliveryLedgerForTests();
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockPushToShelf.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('deliverRender — the one function every 6-12 WhatsApp delivery goes through', () => {
  test('switched OFF: no lifecycle row, and the ledger row carries no request_id key', async () => {
    await deliver();
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    expect(rows('niete_lp612_deliveries')).toHaveLength(1);
    expect(rows('niete_lp612_deliveries')[0]).not.toHaveProperty('request_id');
  });

  test('switched ON: a delivered lesson writes ONE completed row, and the ledger row names it', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    await deliver();
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({
      user_id: TEACHER, phone_number: '923001234567', status: 'completed', source: 'niete_lp612',
      channel: 'whatsapp', region: 'niete', grade: 8, subject: 'Mathematics', topic: 'Sets & notation',
      artifact_ref: SEGMENT.segment_id, language: 'ur', correlation_id: CORR,
      created_at: '2026-10-13T05:00:00.000Z', generated_at: '2026-10-13T05:00:00.000Z', error_code: null,
    }));
    expect(asks[0].delivered_at).toBeTruthy();
    expect(rows('niete_lp612_deliveries')[0].request_id).toBe(asks[0].id);
  });

  test('switched ON: a send Meta refused writes a FAILED row (DELIVERY_FAILED) and still throws, as before', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockSendDocumentByLink.mockResolvedValue(false);
    await expect(deliver()).rejects.toThrow(/document send failed/);
    const [ask] = rows('lesson_plan_requests');
    expect(ask).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null, artifact_ref: SEGMENT.segment_id,
    }));
    expect(ask.generated_at).toBeTruthy();
    expect(rows('niete_lp612_deliveries')).toHaveLength(0);
  });

  test('switched ON: a document link that cannot be signed → a FAILED row (DELIVERY_FAILED), and it still throws, as before', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    require('../../bot/shared/storage/r2').getPresignedUrl.mockRejectedValueOnce(new Error('R2 sign failed'));
    await expect(deliver()).rejects.toThrow(/R2 sign failed/);
    const [ask] = rows('lesson_plan_requests');
    expect(ask).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null }));
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('switched ON: a lifecycle write that fails costs her nothing — delivered, ledger written without a link', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockFailRequests = true;
    await expect(deliver()).resolves.toBeUndefined();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(rows('niete_lp612_deliveries')).toHaveLength(1);
    expect(rows('niete_lp612_deliveries')[0]).not.toHaveProperty('request_id');
  });

  test('the WhatsApp sends are identical with the switch off and on', async () => {
    await deliver();
    const off = [mockSendMessage.mock.calls.map((c) => c.slice(0, 2)), mockSendDocumentByLink.mock.calls.map((c) => c.slice(0, 4))];
    jest.clearAllMocks();
    mockDb = createMemorySupabase({ niete_lp612_deliveries: [], lesson_plan_requests: [] });
    process.env.LP_LIFECYCLE_PATHS = 'all';
    await deliver();
    const on = [mockSendMessage.mock.calls.map((c) => c.slice(0, 2)), mockSendDocumentByLink.mock.calls.map((c) => c.slice(0, 4))];
    expect(on).toEqual(off);
  });
});

describe('switched ON, a delivery ledger that refuses the link (request_id) — the ledger row still lands', () => {
  test('her delivery row is written without the link, and the store keeps recording afterwards', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    const { withoutV164 } = require('./helpers/pre-migration');
    const realFrom = mockDb.from;
    mockDb.from = withoutV164((t) => realFrom(t), { tables: ['niete_lp612_deliveries'] });
    try {
      await deliver();
      await deliver({ renderId: '55555555-5555-4555-8555-555555555555' });
    } finally {
      mockDb.from = realFrom;
    }
    expect(rows('lesson_plan_requests')).toHaveLength(2);
    expect(rows('niete_lp612_deliveries')).toHaveLength(2);
    expect(rows('niete_lp612_deliveries')[0]).not.toHaveProperty('request_id');
  });
});

describe('requestLesson — outcomes that end the ask then and there', () => {
  const ask = (over = {}) => Serving.requestLesson({
    segmentId: SEGMENT.segment_id, userId: TEACHER, phone: '923001234567', lang: 'en', uiLang: 'en',
    correlationId: CORR, surface: 'whatsapp', ...over,
  });

  test('a segment that no longer exists → one FAILED row (NO_ASSET), grade read off the segment id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockSegmentById.mockResolvedValue(null);
    const res = await ask();
    expect(res.outcome).toBe('not_found');
    const [row] = rows('lesson_plan_requests');
    expect(row).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'NO_ASSET', grade: 8, artifact_ref: SEGMENT.segment_id, correlation_id: CORR,
    }));
  });

  test('a job that could not be queued ends the ask as QUEUE_FAILED, not a generation failure', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    await Lp612Lifecycle.recordRequestOutcome({
      req: { segmentId: SEGMENT.segment_id, userId: TEACHER, phone: '923001234567', lang: 'en', surface: 'whatsapp' },
      outcome: 'error', result: { outcome: 'error', error: 'enqueue failed' }, askedAt: '2026-10-13T05:00:00.000Z',
    });
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'QUEUE_FAILED' }));
  });

  test('a religious segment held by the operator → one FAILED row (NOT_ELIGIBLE)', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    const res = await ask();
    expect(res.outcome).toBe('held');
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NOT_ELIGIBLE' }));
  });

  test('a PORTAL ask that ends here writes ONE failed row, channel portal, her phone read from users', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    const res = await ask({ surface: 'portal', phone: null, userId: PORTAL_TEACHER, correlationId: null });
    expect(res.outcome).toBe('held');
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({
      user_id: PORTAL_TEACHER, phone_number: '923005550000', channel: 'portal', status: 'failed',
      error_code: 'NOT_ELIGIBLE', source: 'niete_lp612', artifact_ref: SEGMENT.segment_id,
    }));
  });

  test('a PORTAL ask for a segment the catalogue does not know is not an ask — no row (the portal endpoint takes any id)', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockSegmentById.mockResolvedValue(null);
    const res = await ask({ surface: 'portal', phone: null, userId: PORTAL_TEACHER, correlationId: null });
    expect(res.outcome).toBe('not_found');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });

  test('switched off, neither a WhatsApp nor a portal ask writes anything', async () => {
    mockSegmentById.mockResolvedValue(null);
    await ask({ surface: 'portal', phone: null, userId: PORTAL_TEACHER });
    await ask();
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });
});

describe('a PORTAL cache hit — the lesson is ready in her portal the moment she asks', () => {
  const { templateVersion } = require('../../bot/shared/config/lp612-flags');
  const READY = () => ({
    id: RENDER, segment_id: SEGMENT.segment_id, lang: 'en', template_version: templateVersion(), status: 'ready',
    r2_key: Serving.r2KeyFor(SEGMENT.segment_id, 'en', templateVersion()), one_screen: 'x', waiters: [],
  });
  const portalAsk = () => Serving.requestLesson({
    segmentId: SEGMENT.segment_id, userId: PORTAL_TEACHER, lang: 'en', surface: 'portal', correlationId: null,
  });
  beforeEach(() => {
    mockSegmentById.mockResolvedValue(SEGMENT);
    mockDb.tables.niete_lp612_renders = [READY()];
  });

  test('switched ON: ONE completed row, channel portal, written BEFORE her claim — and the claim names it', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    const res = await portalAsk();
    expect(res.outcome).toBe('cache_hit');
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({
      user_id: PORTAL_TEACHER, phone_number: '923005550000', channel: 'portal', status: 'completed',
      source: 'niete_lp612', artifact_ref: SEGMENT.segment_id, grade: 8, error_code: null, language: 'en',
    }));
    expect(asks[0].generated_at).toBe(asks[0].created_at);
    expect(asks[0].delivered_at).toBeTruthy();
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: PORTAL_TEACHER, surface: 'portal', request_id: asks[0].id }));
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('switched OFF: her claim is exactly the old row (no request_id key), and no lifecycle row', async () => {
    const res = await portalAsk();
    expect(res.outcome).toBe('cache_hit');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: PORTAL_TEACHER, surface: 'portal' }));
    expect(claim).not.toHaveProperty('request_id');
  });

  test('a lifecycle write that fails still leaves her claim (unlinked) — her next poll is answered', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    mockFailRequests = true;
    const res = await portalAsk();
    expect(res.outcome).toBe('cache_hit');
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: PORTAL_TEACHER, surface: 'portal' }));
    expect(claim).not.toHaveProperty('request_id');
  });
});

describe('a waiter carries the log id of her own ask (switch on only)', () => {
  test('switched OFF: the waiter entry is exactly the old shape', async () => {
    await Serving.joinWaiters(RENDER, { userId: TEACHER, phone: '923001234567', uiLang: 'ur', surface: 'whatsapp', correlationId: CORR });
    expect(Object.keys(mockJoined[0]).sort()).toEqual(['phone', 'requested_at', 'surface', 'ui_lang', 'user_id']);
  });

  test('switched ON: the waiter entry adds correlation_id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    await Serving.joinWaiters(RENDER, { userId: TEACHER, phone: '923001234567', uiLang: 'ur', surface: 'whatsapp', correlationId: CORR });
    expect(mockJoined[0]).toEqual(expect.objectContaining({ correlation_id: CORR, user_id: TEACHER }));
  });
});

describe('a failed render — one failed row per waiter, WhatsApp or portal', () => {
  const WAITERS = [
    { user_id: TEACHER, phone: '923001234567', ui_lang: 'ur', surface: 'whatsapp', requested_at: '2026-10-13T05:00:00.000Z', correlation_id: CORR },
    { user_id: OTHER, phone: '923009999999', ui_lang: 'en', surface: 'whatsapp', requested_at: '2026-10-13T05:01:00.000Z' },
    { user_id: PORTAL_TEACHER, phone: null, ui_lang: 'en', surface: 'portal', requested_at: '2026-10-13T05:02:00.000Z' },
  ];

  test('switched ON: RENDER_FAILED → a row per waiter — the portal waiter too (channel portal) — each with her own ask time and log id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    const n = await Lp612Lifecycle.recordWaitersFailed({
      waiters: WAITERS, segment: SEGMENT, segmentId: SEGMENT.segment_id, lang: 'ur', code: 'RENDER_FAILED', detail: 'pages missing',
    });
    expect(n).toBe(3);
    const portal = rows('lesson_plan_requests').find((r) => r.user_id === PORTAL_TEACHER);
    expect(portal).toEqual(expect.objectContaining({
      channel: 'portal', status: 'failed', error_code: 'RENDER_FAILED', phone_number: '923005550000',
      created_at: '2026-10-13T05:02:00.000Z',
    }));
    const byUser = Object.fromEntries(rows('lesson_plan_requests').map((r) => [r.user_id, r]));
    expect(byUser[TEACHER]).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'RENDER_FAILED', created_at: '2026-10-13T05:00:00.000Z', correlation_id: CORR, generated_at: null,
    }));
    expect(byUser[OTHER]).toEqual(expect.objectContaining({ created_at: '2026-10-13T05:01:00.000Z', correlation_id: null }));
    expect(byUser[OTHER].error_message).toMatch(/RENDER_FAILED/);
  });

  test('any other worker code (an author timeout) records GENERATION_FAILED', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    await Lp612Lifecycle.recordWaitersFailed({ waiters: WAITERS.slice(0, 1), segmentId: SEGMENT.segment_id, lang: 'ur', code: 'AUTHOR_TIMEOUT', detail: 'x' });
    expect(rows('lesson_plan_requests')[0].error_code).toBe('GENERATION_FAILED');
  });

  test('switched OFF: nothing, and no database call', async () => {
    const n = await Lp612Lifecycle.recordWaitersFailed({ waiters: WAITERS, segmentId: SEGMENT.segment_id, lang: 'ur', code: 'RENDER_FAILED' });
    expect(n).toBe(0);
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });
});
