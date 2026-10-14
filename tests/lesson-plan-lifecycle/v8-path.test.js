'use strict';
/**
 * Grade 1-5 (v8) lesson plans leave their lifecycle row — and nothing the teacher sees changes.
 *
 * THE HOLE. A v8 lesson plan writes a niete_lp_downloads row and a lesson_plans row, but no
 * lesson_plan_requests row: no status, no stage times, and nothing that ties the plan the portal
 * lists back to its ask or to the logs of that ask.
 *
 * THE FIX. With LP_LIFECYCLE_PATHS on for `niete_v8_segment`, every ask that reaches an outcome
 * writes ONE lifecycle row (completed, or failed with a code), and the download row and the plan
 * row it already writes name that row (request_id). With the switch off, every write is exactly
 * what it was.
 *
 * Driven end to end — the REAL Flow endpoint into the REAL delivery service and the REAL lifecycle
 * writer — with only the network faked: Supabase (stateful, in memory), the cache, R2's presigner,
 * WhatsApp. The assertions are on the rows written and on what WhatsApp was asked to send.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentByLink: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.DOC' }] }),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');

const LESSON = 'grade_1_english_ch1_seg3';
const lessonRow = (i) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`, segment_index: i, lp_type: 'content',
  day_label: `Day ${i}`, section: 'Diving Deeper', section_short: 'Diving Deeper',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Diving Deeper', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [lessonRow(3)] }],
  }],
};
const ASSET = {
  id: `asset-${LESSON}`, lesson_id: LESSON, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${LESSON}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
};
const TEACHER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' };
const tap = (userId = 'user-1') => EP.handlePakistanLpDataExchange(
  `${userId}:pakistan-lp:${Date.now()}`, 'SELECT_LESSON', { step: 'lesson', lesson: `V8-${LESSON}` },
);
async function settle() {
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r));
}
const rows = (t) => mockDb.rows(t);
const sends = () => ({
  texts: WhatsAppService.sendMessage.mock.calls.map((c) => [c[0], c[1]]),
  docs: WhatsAppService.sendDocumentByLink.mock.calls.map((c) => [c[0], c[2], c[3]]),
  voice: WhatsAppService.sendVoicenoteFromR2Key.mock.calls.length,
});

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
let now;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockRedis.reset();
  mockDb.reset({
    users: [TEACHER], niete_lp_assets: [ASSET], niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [],
  });
  now = Date.parse('2026-10-13T05:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  Date.now.mockRestore();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('switched OFF (LP_LIFECYCLE_PATHS unset) — every write is exactly what it was', () => {
  test('no lifecycle row, and neither the download row nor the plan row carries a request_id key', async () => {
    await tap();
    await settle();
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    expect(rows('niete_lp_downloads')).toHaveLength(1);
    expect(rows('niete_lp_downloads')[0]).not.toHaveProperty('request_id');
    expect(rows('lesson_plans')).toHaveLength(1);
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
  });
});

describe('switched ON for niete_v8_segment', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment'; });

  test('a delivered lesson writes ONE completed lifecycle row, and the download and plan rows name it', async () => {
    await tap();
    await settle();
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    const ask = asks[0];
    expect(ask).toEqual(expect.objectContaining({
      user_id: 'user-1',
      phone_number: '923001234567',
      status: 'completed',
      source: 'niete_v8_segment',
      channel: 'whatsapp',
      region: 'niete',
      grade: 1,
      subject: 'english',
      artifact_ref: LESSON,
      language: 'ur',
      error_code: null,
    }));
    expect(ask.topic).toBe(rows('lesson_plans')[0].topic);
    // The ask's log id is the one the download ledger already carries for this ask.
    expect(ask.correlation_id).toBe(rows('niete_lp_downloads')[0].correlation_id);
    expect(ask.correlation_id).toBeTruthy();
    // Stage times are in order.
    expect(Date.parse(ask.created_at)).toBeLessThanOrEqual(Date.parse(ask.generated_at));
    expect(Date.parse(ask.generated_at)).toBeLessThanOrEqual(Date.parse(ask.delivered_at));
    expect(ask.completed_at).toBe(ask.delivered_at);
    // The two rows the portal and the survey hang off name the ask.
    expect(rows('niete_lp_downloads')[0]).toEqual(expect.objectContaining({ status: 'sent', request_id: ask.id }));
    expect(rows('lesson_plans')[0].request_id).toBe(ask.id);
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({
      requestId: ask.id, source: 'niete_v8_segment', userId: 'user-1',
    }));
  });

  test('a send Meta refused writes a FAILED row (DELIVERY_FAILED, generated but not delivered); no plan row, as before', async () => {
    WhatsAppService.sendDocumentByLink.mockResolvedValueOnce(null);
    await tap();
    await settle();
    const [ask] = rows('lesson_plan_requests');
    expect(ask).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null, completed_at: null,
    }));
    expect(ask.generated_at).toBeTruthy();
    expect(rows('niete_lp_downloads')[0]).toEqual(expect.objectContaining({ status: 'failed', request_id: ask.id }));
    expect(rows('lesson_plans')).toHaveLength(0);
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.failed', expect.objectContaining({ requestId: ask.id }));
  });

  test('no current asset writes a FAILED row (NO_ASSET, never generated), linked from the download row', async () => {
    mockDb.reset({ users: [TEACHER], niete_lp_assets: [], niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [] });
    await tap();
    await settle();
    const [ask] = rows('lesson_plan_requests');
    expect(ask).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NO_ASSET', generated_at: null }));
    expect(rows('niete_lp_downloads')[0].request_id).toBe(ask.id);
  });

  test('a teacher with no phone: no lifecycle row is possible (the table needs one), and the download row is as before', async () => {
    mockDb.reset({
      users: [{ ...TEACHER, phone_number: null }], niete_lp_assets: [ASSET],
      niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [],
    });
    await tap();
    await settle();
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    expect(rows('niete_lp_downloads')[0]).not.toHaveProperty('request_id');
  });

  test('a lifecycle write that FAILS costs the teacher nothing: same sends, rows written without a link', async () => {
    const real = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((t) => {
      if (t !== 'lesson_plan_requests') return real(t);
      const err = { data: null, error: { code: '57014', message: 'statement timeout' } };
      const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : () => b) });
      return b;
    });
    await tap();
    await settle();
    mockDb.from.mockImplementation(real);
    expect(WhatsAppService.sendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(rows('niete_lp_downloads')[0]).toEqual(expect.objectContaining({ status: 'sent' }));
    expect(rows('niete_lp_downloads')[0]).not.toHaveProperty('request_id');
    expect(rows('lesson_plans')).toHaveLength(1);
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.lifecycle.write_failed', expect.objectContaining({ code: '57014' }));
  });
});

describe('switched ON, a plan or download table that refuses the link (request_id) — the row still lands, as before', () => {
  const { withoutV164 } = require('./helpers/pre-migration');
  let original;
  beforeEach(() => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    original = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation(withoutV164(original, { tables: ['lesson_plans', 'niete_lp_downloads'] }));
  });
  afterEach(() => { mockDb.from.mockImplementation(original); });

  test('the lifecycle row is written; the download and plan rows land without the link', async () => {
    await tap();
    await settle();
    expect(rows('lesson_plan_requests')).toHaveLength(1);
    expect(rows('niete_lp_downloads')).toHaveLength(1);
    expect(rows('niete_lp_downloads')[0]).not.toHaveProperty('request_id');
    expect(rows('lesson_plans')).toHaveLength(1);
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
  });
});

describe('nothing the teacher sees changes', () => {
  test('the exact same WhatsApp sends, in the same order, with the switch off and on', async () => {
    await tap();
    await settle();
    const off = sends();

    jest.clearAllMocks();
    mockRedis.reset();
    mockDb.reset({ users: [TEACHER], niete_lp_assets: [ASSET], niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [] });
    process.env.LP_LIFECYCLE_PATHS = 'all';
    await tap();
    await settle();
    const on = sends();

    expect(on).toEqual(off);
    expect(off.docs).toHaveLength(1);
  });
});
