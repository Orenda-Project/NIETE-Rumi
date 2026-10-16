'use strict';
/**
 * Live reading v3 (app_settings `web_quiz_live_read_v3`, off unless true; web-quiz-live-read-v3.js). With it on, the read
 * payload tells the page how a reading finishes itself (the last word, or most of the passage then a short quiet — never
 * on a counted read — and a Done button always shown), the menu says to load the live-reading component, and a story
 * page can ask for its own one-read temporary speech key. Off, every payload is today's and the story key is 404.
 * Soniox's HTTP API (global fetch), Supabase, R2, the STT call and the LLM are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
// The voice gateway's provider calls are the network boundary for the mascot's clips.
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding (web-quiz-hub deviceTrusted) runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const AudioService = require('../../../shared/services/audio.service');
const llm = require('../../../shared/services/llm-client');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }, { id: KID2, list_id: LIST }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
});

// The family's phone (the first to open the hub link); every hub-token call below comes from it.
const DEV = 'FamilyPhoneDeviceRef_1';
const DEV_B = 'ForwardedToPhoneRef_22';
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const st = () => T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
const expectFail = async (p, status, error) => {
  await expect(p).rejects.toMatchObject({ status, body: expect.objectContaining({ error }) });
};

// ── tokens ───────────────────────────────────────────────────────────────────

const LR3 = { key: 'web_quiz_live_read_v3', value: true };
const RT = { key: 'web_quiz_challenge_realtime', value: true };
const FAKE_MAIN_KEY = 'main-key-test-only';
const okMint = () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:abc-test-only', expires_at: '2026-10-07T10:00:30Z' }) });
const LR = require('../../../shared/services/quiz/web-quiz-live-read-v3');
let logger;
beforeEach(() => {
  process.env.SONIOX_API_KEY = FAKE_MAIN_KEY;
  global.fetch = jest.fn(async () => okMint());
  logger = require('../../../shared/utils/logger');
  LR._reset();
});
afterAll(() => { delete global.fetch; });

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'ct' || k === 'run' ? undefined : v)));

describe('switch off: today\'s payloads, byte for byte', () => {
  test('absent, or any value but true: no lr3 on the read payload or the menu', async () => {
    const before = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    const menuBefore = await Ch.menu(hub(), { ...D, lang: 'en' });
    expect(before).not.toHaveProperty('lr3');
    expect(menuBefore).not.toHaveProperty('lr3');
    db.app_settings.push({ key: 'web_quiz_live_read_v3', value: 'maybe' });
    Ch.__reset();
    const after = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(JSON.stringify(await Ch.menu(hub(), { ...D, lang: 'en' }))).toBe(JSON.stringify(menuBefore));
  });

  test('the story-page key is 404 off and Soniox is never called', async () => {
    await expect(LR.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'off' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('switch on: the read says how it finishes itself', () => {
  test('real-time off: the v3 switch is not even read, the read is today\'s', async () => {
    db.app_settings.push(LR3);
    const reads = [];
    const from = supabase.from.bind(supabase);
    supabase.from = (t) => { const q = from(t); const eq = q.eq && q.eq.bind(q); if (t === 'app_settings' && eq) q.eq = (k, v) => { reads.push(v); return eq(k, v); }; return q; };
    const out = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    supabase.from = from;
    expect(out).not.toHaveProperty('lr3');
    expect(reads).not.toContain('web_quiz_live_read_v3');
  });

  test('a practice/uncounted read: last word, or 80 % then 4 s quiet, and Done always; the glow, no number', async () => {
    db.app_settings.push(LR3, RT);
    const out = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    expect(out.lr3).toEqual({ meter: 'glow', done: true, done_from: 0, counted: false, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true } });
    // the rest of the payload is untouched
    Ch.__reset();
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_live_read_v3');
    const off = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    const { lr3, ...rest } = strip(out);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
  });

  test('a counted read (the record rule, first attempt): never the quiet end', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_challenge_record', value: true });
    const out = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    expect(out.lr3.finish.quiet).toBe(false);
    expect(out.lr3.counted).toBe(true);
    expect(out.lr3.done_from).toBe(0.8);
    expect(out.lr3.done).toBe(true);
  });

  test('only the read carries it; the menu says to load the component', async () => {
    db.app_settings.push(LR3, RT);
    expect((await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' })).lr3).toBeUndefined();
    expect((await Ch.menu(hub(), { ...D, lang: 'en' })).lr3).toBe(true);
  });
});

describe('storyKey: a temporary key for one story-page reading', () => {
  test('mints a single-use key with the server key and returns only the temporary one; nothing logged', async () => {
    db.app_settings.push(LR3);
    const out = await LR.storyKey({ st: hub(), book: 'en-g1-cat_01', page: 3, lang: 'en', device: DEV });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.soniox.com/v1/auth/temporary-api-key');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_MAIN_KEY}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ usage_type: 'transcribe_websocket', expires_in_seconds: 30, single_use: true, max_session_duration_seconds: 90 });
    expect(body.client_reference_id).toBe(out.run);
    expect(out).toEqual({ api_key: 'temp:abc-test-only', expires_at: '2026-10-07T10:00:30Z', ws: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5', lang: 'en', run: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    // no run row: a story page read keeps no voice and is never counted
    expect(db.web_quiz_challenge_runs).toEqual([]);
    const logged = JSON.stringify([logger.logToFile.mock.calls, logger.logError.mock.calls, require('../../../shared/utils/structured-logger').logEvent.mock.calls]);
    expect(logged).not.toContain('temp:abc');
    expect(logged).not.toContain(FAKE_MAIN_KEY);
  });

  test('a forged hub token, another phone, or a bad book/page is refused before Soniox', async () => {
    db.app_settings.push(LR3);
    await expect(LR.storyKey({ st: 'nope.' + 'x'.repeat(22), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 401 });
    await LR.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV });   // binds the link to the family phone
    global.fetch.mockClear();
    await expect(LR.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV_B })).rejects.toMatchObject({ status: 403 });
    await expect(LR.storyKey({ st: hub(), book: '../etc', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'bad_page' } });
    await expect(LR.storyKey({ st: hub(), book: 'b1', page: 0, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'bad_page' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a child\'s day cap of story-page keys ⇒ 429, no key minted', async () => {
    db.app_settings.push(LR3);
    for (let k = 0; k < LR.STORY_KEYS_PER_DAY; k += 1) await LR.storyKey({ st: hub(), book: 'b1', page: (k % 20) + 1, lang: 'en', device: DEV });
    global.fetch.mockClear();
    await expect(LR.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('Soniox refusing ⇒ 502 live_unavailable (logged with its status only)', async () => {
    db.app_settings.push(LR3);
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(LR.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 502, body: { error: 'live_unavailable' } });
    expect(logger.logError).toHaveBeenCalledWith('web_quiz.lr_key_failed', expect.objectContaining({ status: 401 }));
  });
});

describe('the row keeps how a v3 reading ended (RULING #C1 line 11)', () => {
  const body = { live_ui_v: 3, ended: 'quiet' };
  test('switch on and the page says v3: live_ui_v and the ending; under the record rule the guard keeps the ending', async () => {
    db.app_settings.push(LR3);
    expect(await LR.metaFor(body)).toEqual({ live_ui_v: 3, ended: 'quiet' });
    expect(await LR.metaFor(body, { record: true })).toEqual({ live_ui_v: 3 });
    expect(await LR.metaFor({ live_ui_v: 3, ended: '<script>' })).toEqual({ live_ui_v: 3 });
  });
  test('switch off, or a page that is not v3: nothing', async () => {
    expect(await LR.metaFor(body)).toEqual({});
    db.app_settings.push(LR3);
    Ch.__reset();
    expect(await LR.metaFor({ ended: 'quiet' })).toEqual({});
  });
});
