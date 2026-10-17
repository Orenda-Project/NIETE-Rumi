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
const K = require('../../../shared/services/quiz/web-quiz-live-read-keys');
let logger;
beforeEach(() => {
  process.env.SONIOX_API_KEY = FAKE_MAIN_KEY;
  global.fetch = jest.fn(async () => okMint());
  logger = require('../../../shared/utils/logger');
  LR._reset(); K._reset();
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
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'off' } });
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

  test('an Urdu read finishes on the quiet at 75 % (real speech drops ~2 of 50 Urdu words); English stays 80 %; Done still from 80 % on a counted read', async () => {
    db.app_settings.push(LR3, RT);
    const ur = await Ch.exercise(hub(), 'read', { ...D, lang: 'ur' });
    expect(ur.lr3.finish.pct).toBe(0.75);
    expect(LR.FINISH_PCT_UR).toBe(0.75);
    expect((await LR.forRead({ counted: true, lang: 'ur' })).lr3).toMatchObject({ done_from: 0.8, finish: { pct: 0.75, quiet: false } });
    expect((await LR.forRead({ counted: false, lang: 'en' })).lr3.finish.pct).toBe(0.8);
    expect((await LR.forRead({ counted: false })).lr3.finish.pct).toBe(0.8);
  });

  test('a counted read (the record rule, first attempt): never the quiet end', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_challenge_record', value: true });
    const out = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    expect(out.lr3.finish.quiet).toBe(false);
    expect(out.lr3.counted).toBe(true);
    expect(out.lr3.done_from).toBe(0.8);
    expect(out.lr3.done).toBe(true);
  });

  test('fast pages: the menu asks for the component switch with its first wave of reads, not after the runs read', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_fast', value: true });
    const Fast = require('../../../shared/services/quiz/web-quiz-fast');
    Fast._reset(); Fast.on();
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    expect(Fast.on()).toBe(true);
    await Ch.menu(hub(), { ...D, lang: 'en' });   // binds the link; warms nothing in LR (reset below)
    LR._reset(); Ch.__reset();
    const spy = jest.spyOn(LR, 'forMenu');
    let release; const gate = new Promise((r) => { release = r; });
    const from = supabase.from.bind(supabase);
    supabase.from = (t) => { const q = from(t); if (t !== 'web_quiz_challenge_runs') return q; const then = q.then.bind(q); q.then = (res, rej) => gate.then(() => then(res, rej)); return q; };
    try {
      const pending = Ch.menu(hub(), { ...D, lang: 'en' });
      for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
      expect(spy).toHaveBeenCalled();
      release();
      expect((await pending).lr3).toBe(true);
    } finally { supabase.from = from; spy.mockRestore(); Fast._reset(); }
  });

  test('only the read carries it; the menu says to load the component', async () => {
    db.app_settings.push(LR3, RT);
    expect((await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' })).lr3).toBeUndefined();
    expect((await Ch.menu(hub(), { ...D, lang: 'en' })).lr3).toBe(true);
  });
});

// "Hear it again" on the kind card (its own switch, web_quiz_zero_read_listen, JSON true only): a live v3 read's payload
// says `zero_listen: true`; anything else, and every other payload, is today's.
describe('"Hear it again" switch: the live v3 read says zero_listen only when the switch is JSON true', () => {
  const ZL = 'web_quiz_zero_read_listen';
  test('on: the read carries zero_listen: true; the rest of the payload is untouched', async () => {
    db.app_settings.push(LR3, RT);
    const off = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    expect(off).not.toHaveProperty('zero_listen');
    Ch.__reset();
    db.app_settings.push({ key: ZL, value: true });
    const out = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    expect(out.zero_listen).toBe(true);
    const { zero_listen: zl, ...rest } = out;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
  });
  test.each([['the string "true"', 'true'], ['1', 1], ['{}', {}], ['false', false]])('%s: off, the read is today\'s byte for byte', async (_, value) => {
    db.app_settings.push(LR3, RT);
    const before = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    Ch.__reset();
    db.app_settings.push({ key: ZL, value });
    const after = strip(await Ch.exercise(hub(), 'read', { ...D, lang: 'en' }));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
  test('live reading v3 off: the switch is not even read, the read is today\'s', async () => {
    db.app_settings.push(RT, { key: ZL, value: true });
    const reads = [];
    const from = supabase.from.bind(supabase);
    supabase.from = (t) => { const q = from(t); const eq = q.eq && q.eq.bind(q); if (t === 'app_settings' && eq) q.eq = (k, v) => { reads.push(v); return eq(k, v); }; return q; };
    const out = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    supabase.from = from;
    expect(out).not.toHaveProperty('zero_listen');
    expect(reads).not.toContain(ZL);
  });
  test('only a read carries it', async () => {
    db.app_settings.push(LR3, RT, { key: ZL, value: true });
    expect(await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' })).not.toHaveProperty('zero_listen');
  });
});

describe('storyKey: a temporary key for one story-page reading', () => {
  // the books the child app can read: ready books, their pages (a picture-only page has no words to read)
  const B1 = 'b1000000-0000-4000-8000-000000000001';
  beforeEach(() => {
    db.app_settings.push({ key: 'web_quiz_stories', value: true });
    db.story_books = [{ id: B1, slug: 'b1', status: 'ready' }, { id: 'b2000000-0000-4000-8000-000000000002', slug: 'en-g1-cat_01', status: 'ready' }, { id: 'b3000000-0000-4000-8000-000000000003', slug: 'draft1', status: 'draft' }];
    db.story_pages = [
      ...Array.from({ length: 20 }, (_, k) => ({ id: `p1000000-0000-4000-8000-0000000000${String(k + 1).padStart(2, '0')}`, book_id: B1, n: k + 1, is_picture: false })),
      { id: 'p1000000-0000-4000-8000-000000000021', book_id: B1, n: 21, is_picture: true },
      { id: 'p2000000-0000-4000-8000-000000000003', book_id: 'b2000000-0000-4000-8000-000000000002', n: 3, is_picture: false },
      { id: 'p3000000-0000-4000-8000-000000000001', book_id: 'b3000000-0000-4000-8000-000000000003', n: 1, is_picture: false },
    ];
  });

  test('a page the child app cannot read gets no key: stories off, a draft book, no such page, a picture-only page ⇒ 404, Soniox never called', async () => {
    db.app_settings.push(LR3, RT);
    await expect(K.storyKey({ st: hub(), book: 'draft1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 30, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 21, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(K.storyKey({ st: hub(), book: 'nobook', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    // the book by its id works as well as by its slug
    await expect(K.storyKey({ st: hub(), book: B1, page: 2, lang: 'en', device: DEV })).resolves.toMatchObject({ api_key: 'temp:abc-test-only' });
    global.fetch.mockClear();
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories');
    LR._reset(); K._reset();
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.web_quiz_live_read_keys).toHaveLength(1);
  });

  test('a Urdu page\'s key says ur; anything else is en', async () => {
    db.app_settings.push(LR3, RT);
    expect((await K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'ur', device: DEV })).lang).toBe('ur');
    expect((await K.storyKey({ st: hub(), book: 'b1', page: 2, lang: 'fr', device: DEV })).lang).toBe('en');
    expect(db.web_quiz_live_read_keys.map((r) => r.lang)).toEqual(['ur', 'en']);
  });

  test('real-time off ⇒ 404 off, whatever the v3 switch says: one switch stops every live key', async () => {
    db.app_settings.push(LR3);
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'off' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('mints a single-use key with the server key and returns only the temporary one; nothing logged', async () => {
    db.app_settings.push(LR3, RT);
    const out = await K.storyKey({ st: hub(), book: 'en-g1-cat_01', page: 3, lang: 'en', device: DEV });
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
    db.app_settings.push(LR3, RT);
    await expect(K.storyKey({ st: 'nope.' + 'x'.repeat(22), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 401 });
    await K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV });   // binds the link to the family phone
    global.fetch.mockClear();
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV_B })).rejects.toMatchObject({ status: 403 });
    await expect(K.storyKey({ st: hub(), book: '../etc', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'bad_page' } });
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 0, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'bad_page' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a child\'s day cap of story-page keys is kept in the database: a restarted process still says 429, no key minted', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_live_read_story_keys_per_day', value: 3 });
    for (let k = 0; k < 3; k += 1) await K.storyKey({ st: hub(), book: 'b1', page: k + 1, lang: 'en', device: DEV });
    expect(db.web_quiz_live_read_keys).toHaveLength(3);
    expect(db.web_quiz_live_read_keys[0]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), student_id: KID, src: 'story_page', lang: 'en', created_at: expect.any(String) });
    // a new process (a restart, another replica): nothing in memory, the rows still count
    LR._reset(); K._reset(); Ch.__reset();
    global.fetch.mockClear();
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.web_quiz_live_read_keys).toHaveLength(3);
    // the day's count per child is in the log (the cap is set from the real spread, never a guess)
    const ev = require('../../../shared/utils/structured-logger').logEvent.mock.calls;
    expect(ev.filter((c) => c[0] === 'web_quiz.lr_key').map((c) => [c[1].n, c[1].cap])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(ev.filter((c) => c[0] === 'web_quiz.lr_key_rest').map((c) => [c[1].n, c[1].cap])).toEqual([[3, 3]]);
  });

  test('reading the same page again soon (one sentence at a time, a retry) mints a fresh one-stream key but counts once', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_live_read_story_keys_per_day', value: 3 }, { key: 'web_quiz_challenge_daily_reads', value: 100 });
    const Budget = require('../../../shared/services/quiz/web-quiz-challenge-budget');
    Budget._reset();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      for (let k = 0; k < 5; k += 1) await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).resolves.toMatchObject({ api_key: 'temp:abc-test-only' });
      expect(db.web_quiz_live_read_keys).toHaveLength(1);           // one count in the child's cap and in the day's budget
      expect(global.fetch).toHaveBeenCalledTimes(5);                 // a key opens one stream: each sentence gets its own
      expect(await Budget.readsToday()).toBe(0.25);
      const ev = require('../../../shared/utils/structured-logger').logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.lr_key');
      expect(ev.map((c) => [c[1].n, !!c[1].repeat])).toEqual([[1, false], [1, true], [1, true], [1, true], [1, true]]);
      await K.storyKey({ st: hub(), book: 'b1', page: 2, lang: 'en', device: DEV });
      await K.storyKey({ st: hub(), book: 'b1', page: 3, lang: 'en', device: DEV });
      expect(db.web_quiz_live_read_keys).toHaveLength(3);
      // at the cap: the page being read still reads; a new page rests
      await expect(K.storyKey({ st: hub(), book: 'b1', page: 3, lang: 'en', device: DEV })).resolves.toMatchObject({ api_key: 'temp:abc-test-only' });
      await expect(K.storyKey({ st: hub(), book: 'b1', page: 4, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
      // the free repeats are bounded per page and in time: past the window the page counts again (and rests at the cap)
      now.mockReturnValue(t0 + K.REPEAT_MS + 1);
      await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429 });
    } finally { now.mockRestore(); }
  });

  test('free repeats of one page stop at REPEAT_MAX: the next one is counted like a new page', async () => {
    db.app_settings.push(LR3, RT);
    for (let k = 0; k <= K.REPEAT_MAX; k += 1) await K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV });
    expect(db.web_quiz_live_read_keys).toHaveLength(1);
    await K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV });
    expect(db.web_quiz_live_read_keys).toHaveLength(2);
  });

  test('the cap absent ⇒ 40 a day; yesterday\'s keys do not count', async () => {
    db.app_settings.push(LR3, RT);
    expect(K.STORY_KEYS_PER_DAY).toBe(40);
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    db.web_quiz_live_read_keys = Array.from({ length: 40 }, (_, k) => ({ id: `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`, student_id: KID, src: 'story_page', lang: 'en', created_at: old }));
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).resolves.toMatchObject({ api_key: 'temp:abc-test-only' });
    db.web_quiz_live_read_keys = Array.from({ length: 40 }, (_, k) => ({ id: `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`, student_id: KID, src: 'story_page', lang: 'en', created_at: new Date().toISOString() }));
    LR._reset(); K._reset();
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429 });
  });

  test('story-page keys count a quarter of a read in the whole day\'s read budget: at the cap a story key AND a passage read are refused', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_challenge_daily_reads', value: 1 });
    const Budget = require('../../../shared/services/quiz/web-quiz-challenge-budget');
    Budget._reset();
    expect(LR.STORY_KEY_WEIGHT).toBe(0.25);
    // four story keys = one passage read's worth (a story page is 5-15 s of audio, a passage ~60 s)
    for (let k = 0; k < 4; k += 1) await K.storyKey({ st: hub(), book: 'b1', page: k + 1, lang: 'en', device: DEV });
    expect(await Budget.readsToday()).toBe(1);
    // a new process: the budget is counted from the tables, the story keys included at a quarter each
    Budget._reset(); LR._reset(); K._reset();
    expect(await Budget.readsToday()).toBe(1);
    global.fetch.mockClear();
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 5, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
    await expect(Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).rejects.toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the key cannot be counted (the table unreadable) ⇒ no key: 503, Soniox never called', async () => {
    db.app_settings.push(LR3, RT);
    const from = supabase.from.bind(supabase);
    supabase.from = (t) => (t === 'web_quiz_live_read_keys' ? { select: () => ({ eq: () => ({ gte: async () => ({ count: null, error: { message: 'relation does not exist' } }) }), gte: async () => ({ count: null, error: { message: 'relation does not exist' } }) }), insert: async () => ({ error: { message: 'relation does not exist' } }) } : from(t));
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 503, body: { error: 'live_unavailable' } });
    supabase.from = from;
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('Soniox refusing ⇒ 503 live_unavailable (logged with its status only), and the refused key costs the child nothing', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_challenge_daily_reads', value: 100 });
    const Budget = require('../../../shared/services/quiz/web-quiz-challenge-budget');
    Budget._reset();
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV })).rejects.toMatchObject({ status: 503, body: { error: 'live_unavailable' } });
    expect(logger.logError).toHaveBeenCalledWith('web_quiz.lr_key_failed', expect.objectContaining({ status: 401 }));
    // no row, no budget: the next try of the same page is a first try, not a free repeat
    expect(db.web_quiz_live_read_keys || []).toEqual([]);
    expect(await Budget.readsToday()).toBe(0);
    global.fetch = jest.fn(async () => okMint());
    await K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV });
    expect(db.web_quiz_live_read_keys).toHaveLength(1);
  });

  test('two keys asked at the same moment at one below the cap: exactly one is handed out, the other rests', async () => {
    db.app_settings.push(LR3, RT, { key: 'web_quiz_live_read_story_keys_per_day', value: 3 });
    const today = new Date().toISOString();
    db.web_quiz_live_read_keys = [0, 1].map((k) => ({ id: `00000000-0000-4000-8000-00000000000${k}`, student_id: KID, src: 'story_page', lang: 'en', created_at: today }));
    await K.storyKey({ st: hub(), book: 'b1', page: 9, lang: 'en', device: DEV });   // binds the link
    db.web_quiz_live_read_keys.pop();
    const got = await Promise.allSettled([
      K.storyKey({ st: hub(), book: 'b1', page: 1, lang: 'en', device: DEV }),
      K.storyKey({ st: hub(), book: 'b1', page: 2, lang: 'en', device: DEV }),
    ]);
    expect(got.map((g) => g.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(got.find((g) => g.status === 'rejected').reason).toMatchObject({ status: 429, body: { error: 'enough_for_today' } });
    expect(db.web_quiz_live_read_keys).toHaveLength(3);
  });
});

describe('the row keeps how a v3 reading ended (the UI version and the ending, beside the scorer\'s numbers)', () => {
  const body = { live_ui_v: 3, ended: 'quiet' };
  test('switch on and the page says v3: live_ui_v and the ending; under the record rule the guard keeps the ending', async () => {
    db.app_settings.push(LR3, RT);
    expect(await LR.metaFor(body)).toEqual({ live_ui_v: 3, ended: 'quiet' });
    expect(await LR.metaFor(body, { record: true })).toEqual({ live_ui_v: 3 });
    expect(await LR.metaFor({ live_ui_v: 3, ended: '<script>' })).toEqual({ live_ui_v: 3 });
  });
  test('switch off, or a page that is not v3: nothing', async () => {
    expect(await LR.metaFor(body)).toEqual({});
    db.app_settings.push(LR3, RT);
    Ch.__reset();
    expect(await LR.metaFor({ ended: 'quiet' })).toEqual({});
  });
});

// ── the scorer's final write: the v3 fields survive it, and nothing the page says becomes a number ──────────────
describe('a v3 reading through submit(): the finished row keeps live_ui_v and the ending; the numbers are the scorer\'s', () => {
  const FF = require('@ffmpeg-installer/ffmpeg').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqlr3-'));
  const clip = (secs) => {
    const f = path.join(dir, `s${secs}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
    return fs.readFileSync(f);
  };
  const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
  const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
  const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
    words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
  const start = async () => {
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    return { ct, key };
  };
  const scoredAs = (right, of) => {
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(of, 1.3));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < right ? 'correct' : k < of ? 'wrong' : 'skipped'))));
  };

  test('a scored practice read: live_ui_v and "quiet" are on the FINAL row (the scorer\'s write used to drop them)', async () => {
    db.app_settings.push(LR3);
    const { ct, key } = await start();
    scoredAs(20, 24);
    await Ch.submit({ ct, key, ms: 60000, live_ui_v: 3, ended: 'quiet' }, { waitMs: 60000 });
    const row = db.web_quiz_challenge_runs[0];
    expect(row.status).toBe('scored');
    expect(row.meta).toMatchObject({ live_ui_v: 3, ended: 'quiet' });
  });

  test('a failed read (nothing heard) keeps them too', async () => {
    db.app_settings.push(LR3);
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(10, 2));
    llm.__create.mockResolvedValue(marks(enTokens().map(() => 'skipped')));
    await Ch.submit({ ct, key, ms: 60000, live_ui_v: 3, ended: 'done_tap' }, { waitMs: 60000 });
    const row = db.web_quiz_challenge_runs[0];
    expect(row.status).toBe('failed');
    expect(row.meta).toMatchObject({ live_ui_v: 3, ended: 'done_tap', reason: 'unheard' });
  });

  test('switch off: the final row is today\'s (no live_ui_v, no ending from the page)', async () => {
    const { ct, key } = await start();
    scoredAs(20, 24);
    await Ch.submit({ ct, key, ms: 60000, live_ui_v: 3, ended: 'quiet' }, { waitMs: 60000 });
    const row = db.web_quiz_challenge_runs[0];
    expect(row.meta).not.toHaveProperty('live_ui_v');
    expect(row.meta).not.toHaveProperty('ended');
  });

  test('a forged v3 body (record:true, a wcpm, a score, 26 words "heard") cannot set the row: record, wcpm and score are the scorer\'s', async () => {
    db.app_settings.push(LR3, { key: 'web_quiz_challenge_record', value: true });
    const { ct, key } = await start();
    scoredAs(12, 15);
    const forged = { ct, key, ms: 60000, live_ui_v: 3, ended: 'last_word', record: true, wcpm: 180, score: { correct: 26, attempted: 26 }, correct: 26, words_read: 26, heard: 26, marks: Array(26).fill('read'), counted: true, live: { correct: 26, attempted: 26, secs: 9 } };
    const r = await Ch.submit(forged, { waitMs: 60000 });
    const row = db.web_quiz_challenge_runs[0];
    expect(row.status).toBe('scored');
    expect(row.wcpm).toBe(12);
    expect(r.wcpm).toBe(12);
    expect(row.score).toMatchObject({ correct: 12, attempted: 15 });
    expect(row.record === true).toBe(false);   // a reading not served as the record never becomes one from the page
    expect(row.meta.live_ui_v).toBe(3);
    expect(row.meta).not.toHaveProperty('words_read');
  });
});
