'use strict';
/**
 * Free-form lesson plans — the typed-topic seam, as goldens (NIETE).
 *
 * A golden row = one fixture teacher + one inbound, run through the REAL handler chain twice with
 * ONLY the switch changed: (a) app_settings.freeform_lp ABSENT, (b) ON for everyone with every
 * hand-off true. Each run records, in order, every outbound WhatsApp call, every database write and
 * every queued job. The two recordings must be equal, and the first is pinned in
 * tests/fflp/goldens/<row>.golden.json, generated from the code BEFORE this change, so a later
 * change that moves a catalogue door fails loudly.
 *
 * The ONE intended difference (N1-MISS): a typed topic that is in neither catalogue, with the switch
 * on, is queued for the free-form engine instead of opening the catalogue. With the switch off it
 * is byte-for-byte today's answer. A HIT is never changed.
 *
 * Real: the text handler, the catalogue door, the app-redirect check, the switch, the catalogue
 * lookup, the queue service. Faked at the network boundary: the database (memory, writes recorded),
 * WhatsApp, the SQS driver, redis, the LLM.
 */
jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

// No test here may open a connection: every boundary is faked below. The guard refuses any call
// that slips past the fakes at once (as an aborted request, which no client retries, so a missed
// boundary fails the test instead of hanging it) and the afterEach names the caller.
const mockEgress = [];
{
  const net = require('net');
  const where = () => new Error().stack.split('\n').slice(3)
    .find((l) => l.includes('/bot/') && !l.includes('node_modules')) || '(no bot frame)';
  const rel = (l) => l.trim().replace(`${process.cwd()}/`, '');
  net.Socket.prototype.connect = function guardedConnect(...a) {
    const o = (a[0] && typeof a[0] === 'object') ? a[0] : { port: a[0], host: a[1] };
    mockEgress.push(`socket ${o.host || o.path}:${o.port} from ${rel(where())}`);
    this.destroy(new Error('egress refused by the test'));
    return this;
  };
  if (typeof global.fetch === 'function') {
    global.fetch = async (u) => {
      let host = '?';
      try { host = new URL(String((u && u.url) || u)).host; } catch (_) { /* keep ? */ }
      mockEgress.push(`fetch ${host} from ${rel(where())}`);
      const e = new Error('egress refused by the test');
      e.name = 'AbortError';
      throw e;
    };
  }
}

const fs = require('fs');
const path = require('path');
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
const mockRec = [];
const mockWRITES = new Set(['insert', 'update', 'upsert', 'delete']);
function mockRecordingFrom(table) {
  const chain = mockDb.from(table);
  return new Proxy(chain, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v === 'function' && mockWRITES.has(prop)) {
        return (...args) => { mockRec.push(['db', table, prop, args[0]]); return v.apply(target, args); };
      }
      return v;
    },
  });
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockRecordingFrom(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
// A service that builds its OWN client instead of using the shared config (the comprehension-flow
// check on every routed text does) reaches the same memory database, so the intent door runs whole
// with nothing on the network.
jest.mock('../../bot/node_modules/@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...a) => mockRecordingFrom(...a), rpc: (...a) => mockDb.rpc(...a) }),
}));
jest.mock('../../bot/shared/services/queue', () => ({
  queueCoachingJob: jest.fn(async (id, type, payload) => { mockRec.push(['sqs', type, payload]); return { MessageId: 'm' }; }),
}));

const mockStore = new Map();
// Redis writes, recorded apart from the golden files (which pin WhatsApp, database and queue) so the
// absent-vs-on comparison covers them too.
const mockRedisRec = [];
const mockRw = (op, k, v) => { mockRedisRec.push([op, k, v === undefined ? null : v]); };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockRw('redis.set', k, v); mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockRw('redis.del', k); mockStore.delete(k); return 1; }),
  },
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRw('set', k, v); mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, t, v) => { mockRw('setex', k, [t, v]); mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  setNX: jest.fn(async (k, v) => { mockRw('setNX', k, v); if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockRw('delete', k); mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockRw('del', k); mockStore.delete(k); return true; }),
}));

const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: jest.fn().mockResolvedValue('a warm answer'),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

jest.mock('../../bot/shared/services/whatsapp.service', () => {
  const m = {};
  for (const name of ['sendMessage', 'sendCtaUrl', 'sendFlow', 'sendInteractiveMessage', 'sendInteractiveButtons',
    'sendFeatureMenuCarousel', 'sendLanguageSelectionList', 'sendTemplate', 'sendDocument', 'sendDocumentByLink', 'sendImage']) {
    m[name] = jest.fn(async (...a) => { mockRec.push(['wa', name, ...a]); return true; });
  }
  m.sendTypingIndicator = jest.fn();
  m.markAsRead = jest.fn();
  m.startContinuousTypingIndicator = () => ({ stop: jest.fn() });
  return m;
});
jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(async ({ existingContext }) => existingContext || null),
  buildLpContext: jest.fn().mockResolvedValue({ entries: [] }),
  deliveryHint: () => '',
}));
jest.mock('../../bot/shared/services/lp612-edit-router.service', () => ({ maybeHandleLp612Reply: jest.fn().mockResolvedValue(false) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(async () => global.__TEST_USER__),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn(async (...a) => { mockRec.push(['conv', ...a]); }),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  ...jest.requireActual('../../bot/shared/handlers/exam-checker.handler'),
  hasActiveExamSession: jest.fn().mockResolvedValue(false),
  handleExamText: jest.fn().mockResolvedValue(null),
}));

const GOLDEN_DIR = path.join(__dirname, 'goldens');
const PHONE = '923000000003';
const TEACHER = {
  id: '22222222-2222-4222-8222-222222222222', phone_number: PHONE, name: 'Ayesha', first_name: 'Ayesha', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};
const ON_ROW = { key: 'freeform_lp', value: JSON.stringify({ mode_by_segment: { '*': 'on' }, handoff: { niete_catalogue_miss: true, followup: true }, testers: [], schema_ready: true }) };
const onRow = (extra) => ({ key: 'freeform_lp', value: JSON.stringify({ ...JSON.parse(ON_ROW.value), ...extra }) });
const SEGMENTS = [
  { segment_id: 's-1', grade: 7, subject: 'science', is_current: true, is_religious: false, subtopic_title: 'Photosynthesis in green plants', menu_title: 'Photosynthesis', chapter_title: 'Nutrition in plants' },
];
const HIT_TOPIC = 'Make a lesson plan on photosynthesis for grade 7';
const MISS_TOPIC = 'lesson plan on quasars and black holes';

const ENV = { ...process.env };
let handler;
// The engine is not on this deployment yet; a test that needs it present stands it in through the index's
// own resolver (the module a later change ports).
const mockEngine = { generateAndDeliver: jest.fn() };
function load({ switchOn, settings = [], user = TEACHER, engine = true, row = null }) {
  jest.resetModules();
  mockRec.length = 0;
  mockRedisRec.length = 0;
  mockStore.clear();
  mockDb = makeDb({
    users: [{ ...user }],
    app_settings: [...settings.map((r) => ({ ...r })), ...(switchOn ? [{ ...(row || ON_ROW) }] : [])],
    user_feature_first_use: [], coaching_sessions: [], niete_lp612_segments: SEGMENTS.map((r) => ({ ...r })),
  });
  handler = require('../../bot/shared/handlers/text-message.handler');
  if (switchOn && engine) require('../../bot/shared/services/fflp')._internals.resolveEngine = () => mockEngine;
}

/** What a run did, with clock values masked (flow tokens, ISO stamps, the signed /go link, a generated request id). */
function recording() {
  const mask = (s) => s
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>')
    .replace(/:pakistan-lp:\d+/g, ':pakistan-lp:<ts>')
    .replace(/\/go\/[A-Za-z0-9_-]+/g, '/go/<signed-token>')
    .replace(/"requestId":"[0-9a-f-]{36}"/g, '"requestId":"<request-id>"');
  return JSON.parse(mask(JSON.stringify(mockRec)));
}

function golden(row, rec) {
  const file = path.join(GOLDEN_DIR, `${row}.golden.json`);
  if (process.env.UPDATE_FFLP_GOLDENS === '1') {
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  }
  expect(fs.existsSync(file)).toBe(true);
  expect(rec).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const typing = () => ({ stop: jest.fn() });
async function direct(body, user = TEACHER, language = 'en') {
  global.__TEST_USER__ = { ...user };
  await handler.handleLessonPlanRequest(PHONE, body, { ...user }, 'sess-1', language, typing(), 'typed_topic');
  await new Promise((r) => setImmediate(r));
}
async function say(body, user = TEACHER) {
  global.__TEST_USER__ = { ...user };
  await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...user });
  await new Promise((r) => setImmediate(r));
}

const redisRecording = () => JSON.parse(JSON.stringify(mockRedisRec).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>'));
async function both(run, { sameRedis = true, ...opts } = {}) {
  load({ ...opts, switchOn: false });
  await run();
  const off = recording();
  const offRedis = redisRecording();
  load({ ...opts, switchOn: true });
  await run();
  const on = recording();
  if (sameRedis) expect(redisRecording()).toEqual(offRedis);
  return { off, on, offRedis };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDetectIntent.mockResolvedValue({ type: 'general' });
  process.env = {
    ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: 'https://portal.example.test',
    PAKISTAN_LP_FLOW_ID: 'flow-lp', OPENAI_API_KEY: 'test-openai', OPENROUTER_API_KEY: 'test-openrouter',
  };
  delete process.env.APP_STORE_URL;
  delete process.env.LP_612_ROUTE_ALL;
  delete process.env.LP_LIFECYCLE_PATHS;
});
afterEach(() => {
  const seen = mockEgress.splice(0);
  expect(seen).toEqual([]);
});
afterAll(() => { process.env = ENV; });

describe('N1-HIT — a typed topic the catalogue holds: the IDENTICAL catalogue door, switch absent or on', () => {
  test.each([
    ['N1-HIT-en', 'en', HIT_TOPIC, {}],
    ['N1-HIT-ur', 'ur', 'جماعت ہفتم کے لیے Photosynthesis پر سبق', {}],
    ['N1-HIT-route-all', 'en', HIT_TOPIC, { LP_612_ROUTE_ALL: 'true' }],
  ])('%s', async (row, language, topic, env) => {
    Object.assign(process.env, env);
    const { off, on } = await both(() => direct(topic, TEACHER, language));
    expect(on).toEqual(off);
    expect(off.filter((r) => r[0] === 'sqs')).toEqual([]);
    golden(row, off);
  });
  test('N1-HIT-bare: a request with no topic word is the catalogue, switch absent or on', async () => {
    const { off, on } = await both(() => direct('lesson plan please'));
    expect(on).toEqual(off);
    golden('N1-HIT-bare', off);
  });
});

describe('N1-MISS — a typed topic in neither catalogue', () => {
  test('switch absent: byte-identical to today (the catalogue Flow)', async () => {
    load({ switchOn: false });
    await direct(MISS_TOPIC);
    golden('N1-MISS-off-flow', recording());
  });
  test('switch absent, no Flow provisioned: byte-identical to today (the not-in-catalog text)', async () => {
    delete process.env.PAKISTAN_LP_FLOW_ID;
    load({ switchOn: false });
    await direct(MISS_TOPIC);
    golden('N1-MISS-off-text', recording());
  });
  test('switch ON: one freeform_v1 request + one lesson_plan_generation job with track, one short "writing" line — no Flow, no not-in-catalog text', async () => {
    load({ switchOn: true });
    await direct(MISS_TOPIC);
    const rec = recording();
    const inserts = rec.filter((r) => r[0] === 'db' && r[2] === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe('lesson_plan_requests');
    expect(inserts[0][3]).toMatchObject({ user_id: TEACHER.id, phone_number: PHONE, source: 'freeform_v1', content_type: 'lesson_plan', status: 'pending', language: 'en', full_message: MISS_TOPIC });
    const jobs = rec.filter((r) => r[0] === 'sqs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe('lesson_plan_generation');
    expect(jobs[0][2]).toMatchObject({ track: 'freeform_v1', entry: 'niete_catalogue_miss', userId: TEACHER.id, fullMessage: MISS_TOPIC });
    const wa = rec.filter((r) => r[0] === 'wa');
    expect(wa).toEqual([['wa', 'sendMessage', PHONE, 'Writing your lesson plan now. It takes about a minute.']]);
    golden('N1-MISS-on', rec);
  });
  test('switch ON, Urdu: the Urdu line', async () => {
    load({ switchOn: true });
    await direct('آتش فشاں اور زلزلے پر سبق', TEACHER, 'ur');
    const wa = recording().filter((r) => r[0] === 'wa');
    expect(wa).toEqual([['wa', 'sendMessage', PHONE, 'آپ کا لیسن پلان لکھا جا رہا ہے۔ تقریباً ایک منٹ لگے گا۔']]);
  });
  test('switch ON but the request cannot be queued (the database refuses the row): today\'s catalogue door, unchanged', async () => {
    load({ switchOn: false });
    await direct(MISS_TOPIC);
    const today = recording();
    load({ switchOn: true });
    const realFrom = mockDb.from;
    mockDb.from = (t) => (t === 'lesson_plan_requests'
      ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'violates check constraint' } }) }) }) }
      : realFrom(t));
    await direct(MISS_TOPIC);
    const rec = recording();
    // The one extra entry is the refused insert itself; everything she receives is today's.
    expect(rec[0]).toEqual(['db', 'lesson_plan_requests', 'insert', expect.objectContaining({ source: 'freeform_v1' })]);
    expect(rec.slice(1)).toEqual(today);
    expect(rec.filter((r) => r[0] === 'sqs')).toEqual([]);
  });
  test('switch ON for a TESTER only: another teacher still gets today\'s door', async () => {
    const other = { ...TEACHER, id: '33333333-3333-4333-8333-333333333333', phone_number: '923000000004' };
    load({ switchOn: false, user: other });
    await direct(MISS_TOPIC, other);
    const today = recording();
    jest.resetModules();
    mockRec.length = 0;
    mockDb = makeDb({ users: [{ ...other }], app_settings: [{ key: 'freeform_lp', value: JSON.stringify({ mode_by_segment: { '*': 'off' }, handoff: { niete_catalogue_miss: true }, testers: [PHONE] }) }], niete_lp612_segments: SEGMENTS });
    handler = require('../../bot/shared/handlers/text-message.handler');
    await direct(MISS_TOPIC, other);
    expect(recording()).toEqual(today);
  });
  test('no user (lookup failed): today\'s text, switch absent or on, and nothing queued', async () => {
    const run = async () => { await handler.handleLessonPlanRequest(PHONE, MISS_TOPIC, null, null, 'en', typing()); };
    const { off, on } = await both(run);
    expect(on).toEqual(off);
    expect(on.filter((r) => r[0] === 'sqs')).toEqual([]);
  });
});

describe('N-NIETE — the other catalogue doors, switch absent vs on', () => {
  const PROD_REDIRECT = [
    { key: 'app_redirect_lesson_plan', value: 'teachers' },
    { key: 'portal_teacher_v2', value: 'teachers' },
  ];
  test.each([
    ['N-NIETE-bare-lesson-plan', 'lesson plan', null, []],
    ['N-NIETE-bare-lp', 'lp', null, []],
    ['N-NIETE-intent-hit', HIT_TOPIC, 'lesson_plan', []],
    ['N-NIETE-redirect-bare', 'lesson plan', null, PROD_REDIRECT],
    ['N-NIETE-redirect-intent-hit', HIT_TOPIC, 'lesson_plan', PROD_REDIRECT],
  ])('%s', async (row, body, intent, settings) => {
    mockDetectIntent.mockResolvedValue({ type: intent || 'general' });
    const { off, on } = await both(() => say(body), { settings });
    expect(on).toEqual(off);
    golden(row, off);
  });
  test('N1-MISS through the real lesson_plan intent door: switch absent = today\'s Flow; switch on = the one queued job', async () => {
    mockDetectIntent.mockResolvedValue({ type: 'lesson_plan' });
    const { off, on } = await both(() => say(MISS_TOPIC), { sameRedis: false });
    golden('N-NIETE-intent-miss-off', off);
    expect(off.filter((r) => r[0] === 'sqs')).toEqual([]);
    expect(on.filter((r) => r[0] === 'sqs')).toHaveLength(1);
    expect(on.filter((r) => r[0] === 'wa' && r[1] === 'sendFlow')).toEqual([]);
  });
});

describe('only the typed-topic door routes: the other two callers of the same handler are unchanged', () => {
  test('N-NIETE-oxbridge-tap: the picker\'s "Generate LP" tap (same arguments as the webhook passes) is identical, switch absent or on', async () => {
    const run = async () => {
      global.__TEST_USER__ = { ...TEACHER };
      await handler.handleLessonPlanRequest(PHONE, MISS_TOPIC, { ...TEACHER }, null, 'en', typing());
      await new Promise((r) => setImmediate(r));
    };
    const { off, on } = await both(run);
    golden('N-NIETE-oxbridge-tap', off); // today's bytes, pinned first
    expect(on).toEqual(off);
    expect(on.filter((r) => r[0] === 'sqs')).toEqual([]);
  });
  test('N-NIETE-menu-fallback: a topic typed after the menu\'s "Lesson Planning" is identical, switch absent or on', async () => {
    const run = async () => {
      const CS = require('../../bot/shared/services/conversation-state.service');
      await CS.setState(TEACHER.id, {
        flow: 'lesson_plan', step: 'awaiting_topic', ttlSeconds: 3600,
        payload: { sessionId: 'sess-1', language: 'en', from: PHONE, askedAt: '2026-01-01T00:00:00.000Z' },
      });
      mockRec.length = 0;
      await say(MISS_TOPIC);
    };
    const { off, on } = await both(run);
    golden('N-NIETE-menu-fallback', off); // today's bytes, pinned first
    expect(on).toEqual(off);
    expect(on.filter((r) => r[0] === 'sqs')).toEqual([]);
    expect(off.filter((r) => r[0] === 'wa').length).toBeGreaterThan(0);
  });
});

describe('the engine and the schema must both be there before the switch can route anything', () => {
  async function today() {
    load({ switchOn: false });
    await direct(MISS_TOPIC);
    return recording();
  }
  test('engine absent => today\'s door even with the switch on', async () => {
    const before = await today();
    load({ switchOn: true, engine: false });
    await direct(MISS_TOPIC);
    expect(recording()).toEqual(before);
  });
  test.each([
    ['missing', {}],
    ['the string "true"', { schema_ready: 'true' }],
    ['the number 1', { schema_ready: 1 }],
  ])('schema_ready %s => today\'s door', async (_n, extra) => {
    const before = await today();
    const v = JSON.parse(ON_ROW.value);
    delete v.schema_ready;
    load({ switchOn: true, row: { key: 'freeform_lp', value: JSON.stringify({ ...v, ...extra }) } });
    await direct(MISS_TOPIC);
    expect(recording()).toEqual(before);
  });
  test('engine present + schema_ready:true => one queued job', async () => {
    load({ switchOn: true });
    await direct(MISS_TOPIC);
    const rec = recording();
    expect(rec.filter((r) => r[0] === 'sqs')).toHaveLength(1);
    expect(rec.filter((r) => r[0] === 'db' && r[2] === 'insert' && r[1] === 'lesson_plan_requests')).toHaveLength(1);
  });
});

describe('the job cannot be queued after the row is written', () => {
  test('an SQS failure marks the row failed at once and she gets today\'s door, not "writing your plan"', async () => {
    load({ switchOn: false });
    await direct(MISS_TOPIC);
    const before = recording();
    load({ switchOn: true });
    require('../../bot/shared/services/queue').queueCoachingJob.mockRejectedValueOnce(new Error('sqs down'));
    await direct(MISS_TOPIC);
    const rec = recording();
    const writes = rec.filter((r) => r[0] === 'db' && r[1] === 'lesson_plan_requests');
    expect(writes.map((r) => r[2])).toEqual(['insert', 'update']);
    expect(writes[1][3]).toMatchObject({ status: 'failed' });
    expect(rec.filter((r) => r[0] !== 'db' || r[1] !== 'lesson_plan_requests')).toEqual(before);
    expect(mockDb.tables.lesson_plan_requests[0]).toMatchObject({ status: 'failed', source: 'freeform_v1' });
  });
});
