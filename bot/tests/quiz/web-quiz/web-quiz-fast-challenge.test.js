'use strict';
/**
 * Fast challenge pages (app_settings web_quiz_fast, default off): the challenge menu (/ch/:token) and each game's page
 * (/ch/:token/read, /missing, /listen, /bigger) read the child's grade and language together, read the challenge's
 * switches together, and run the page's remaining lookups together, each after the same checks as today.
 * Supabase is the boundary and is faked with a fixed delay per read; R2, the voice provider and Redis are faked;
 * the challenge service, the tokens and the child-test item bank run for real.
 *
 * Off: every payload is exactly today's (golden recorded before the change). On: the same payloads, more reads at once.
 * Volatile fields: a game's `ct` is a signed token holding a generated run id and an expiry clock; it is compared as
 * its kind, child and game only (r and exp stripped).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/ogg' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');

const GOLDEN = path.join(__dirname, 'web-quiz-fast-challenge.golden.json');
const READ_MS = 25;
const KID = '44444444-4444-4444-8444-444444444444';
const OLD = '44444444-4444-4444-8444-777777777777';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const DEV = { device: 'FamilyPhoneDeviceRef_1' };
const SWITCHES = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing',
  'web_quiz_challenge_listen', 'web_quiz_challenge_questions', 'web_quiz_challenge_realtime', 'web_quiz_challenge_read_guard'];

let fake;
let inflight = 0;
let maxInflight = 0;
let Ch;
let T;

const slow = (p) => {
  inflight += 1; maxInflight = Math.max(maxInflight, inflight);
  return new Promise((r) => setTimeout(r, READ_MS)).then(() => { inflight -= 1; return p(); });
};
function seed({ fast = false, juice = false } = {}) {
  fake = makeFake({
    app_settings: [...SWITCHES.map((key) => ({ key, value: true })), ...(fast ? [{ key: 'web_quiz_fast', value: true }] : []), ...(juice ? [{ key: 'web_quiz_juice', value: true }] : [])],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Zara Testwala' }, { id: OLD, list_id: null, self_reported_class: '7', student_name: 'Big Testwala' }],
    quiz_share_codes: [{ id: SC, language: 'ur' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1', created_at: '2026-10-01T10:00:00Z' }],
    web_quiz_challenge_runs: [{ id: 'x9', student_id: KID, exercise: 'bigger', status: 'scored', score: { correct: 7, n: 10 }, lang: 'en', meta: {}, created_at: '2026-10-06T10:00:00Z' }],
  });
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => slow(() => then.call(b, (x) => x)).then(res, rej);
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: (n, a) => slow(() => fake.rpc(n, a)) });
}

const SAVED = { ...process.env };
async function fresh(opts) {
  jest.resetModules();
  seed(opts);
  T = require('../../../shared/services/quiz/web-quiz-token');
  Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  require('../../../shared/services/quiz/web-quiz-fast').on();
  await new Promise((r) => setTimeout(r, 3 * READ_MS));
}
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-internal-key', CHILD_TEST_R2_ENV: 'sandbox', R2_BUCKET_NAME: 'r2-default', WEB_QUIZ_TOKEN_SECRET: 'fast-ch-secret' };
  inflight = 0; maxInflight = 0;
});
afterAll(() => { process.env = SAVED; });

const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const st = () => T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
const stable = (o) => {
  const out = JSON.parse(JSON.stringify(o));
  if (out.ct) { const { k, sid, ex } = T.verify(out.ct, 'c') || {}; out.ct = { k, sid, ex }; }
  return out;
};
const call = async (fn) => { try { return stable(await fn()); } catch (e) { return { status: e.status, body: e.body }; } };

/** The payloads this file pins. */
async function pages(fast) {
  await fresh({ fast });
  const out = {};
  out.menu_hub = await call(() => Ch.menu(hub(), DEV));
  out.menu_hub_en = await call(() => Ch.menu(hub(), { ...DEV, lang: 'en' }));
  out.menu_quiz = await call(() => Ch.menu(st()));
  for (const ex of ['read', 'missing', 'listen', 'bigger']) out[`ex_${ex}`] = await call(() => Ch.exercise(hub(), ex, DEV));
  out.ex_read_quiz = await call(() => Ch.exercise(st(), 'read', {}));
  out.not_eligible = await call(() => Ch.menu(hub([OLD]), { device: 'OtherPhoneDeviceRef_22' }));
  out.no_game = await call(() => Ch.exercise(hub(), 'nope', DEV));
  return out;
}

test('switch off: the menu and game payloads are today\'s, byte for byte (golden)', async () => {
  const out = await pages(false);
  expect(out.menu_hub.exercises.length).toBeGreaterThan(1);
  expect(out.ex_read.story).toBeTruthy();
  if (!fs.existsSync(GOLDEN)) fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
  expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
});

test('switch on: the menu and game payloads are exactly the switch-off payloads', async () => {
  const off = await pages(false);
  const on = await pages(true);
  expect(on).toEqual(off);
});

/** The most reads in flight at once during one call (the switches warmed by a first call). */
async function peak(fast, fn) {
  await fresh({ fast });
  await fn();
  maxInflight = 0;
  await fn();
  return maxInflight;
}

test('switch on: the menu\'s lookups run together (more reads in flight at once than today)', async () => {
  const off = await peak(false, () => Ch.menu(hub(), DEV));
  const on = await peak(true, () => Ch.menu(hub(), DEV));
  expect(on).toBeGreaterThan(off);
  expect(on).toBeGreaterThanOrEqual(3);
});

test.each(['read', 'missing', 'listen', 'bigger'])('switch on: the %s page\'s lookups run together (more reads in flight at once than today)', async (ex) => {
  const off = await peak(false, () => Ch.exercise(hub(), ex, DEV));
  const on = await peak(true, () => Ch.exercise(hub(), ex, DEV));
  expect(on).toBeGreaterThan(off);
  expect(on).toBeGreaterThanOrEqual(3);
});

test('switch on: a failed runs read refuses the menu as today, and leaves nothing unhandled', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await fresh({ fast: true });
    await Ch.menu(hub(), DEV);
    const supabase = require('../../../shared/config/supabase');
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'web_quiz_challenge_runs') b.then = (res, rej) => slow(() => ({ data: null, error: { code: '42703', message: 'no column' } })).then(res, rej);
      return b;
    };
    expect(await call(() => Ch.menu(hub(), DEV))).toEqual({ status: 503, body: { error: 'unavailable' } });
    expect(await call(() => Ch.exercise(hub(), 'read', DEV))).toEqual({ status: 503, body: { error: 'unavailable' } });
    await new Promise((r) => setTimeout(r, 6 * READ_MS));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});

test('switch on with the sound kit on: the menu names juice exactly as with fast off (the kit read joins the early reads)', async () => {
  await fresh({ fast: true, juice: true });
  const on = await call(() => Ch.menu(hub(), DEV));
  await fresh({ fast: false, juice: true });
  const off = await call(() => Ch.menu(hub(), DEV));
  expect(on.juice).toBe(true);
  expect(on).toEqual(off);
});

