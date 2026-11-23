'use strict';
/**
 * "Your turn" in a teacher's "Try it as a student" preview (bd-21q0kr; app_settings `web_quiz_practice_your_turn`,
 * JSON true only, default off). A preview link is a hub token that names no child ({k:'h', ids:[], pr:1, g, tu}); the
 * teacher home mints it with the teacher's users id as `tu`.
 *
 * Switch OFF (absent, false, the string "true"): the preview's book is today's, byte for byte (lr3:false and none of
 * Your turn's bits), and the story-page speech key refuses the preview token as it does today (401, no key minted).
 * Switch ON (and the deployment's live reading on): the preview's book is the child's book with Your turn's bits
 * (lr3, lrr, read_fb, read_sheet) and lr3_keep:false (nothing of the voice is kept, and the notice says so); the
 * preview gets a one-read speech key counted against the TEACHER (its own day cap, app_settings
 * `web_quiz_live_read_preview_keys_per_day`, default 40), inside the same day's read budget as a child's key, and
 * never against any child: no web_quiz_live_read_keys row, a child's own cap and keys exactly as before.
 * The preview's story events stay answered and never kept.
 *
 * The real router, the real services: only the network boundaries are stood in for — Supabase (an in-memory table
 * double that applies filters), Soniox's HTTP API (global fetch, for its host only), Redis (an in-memory double whose
 * evalScript answers this feature's scripts as Redis would), R2, speech, the LLM.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/ogg' })),
  downloadFromR2: jest.fn(async () => null),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  getObjectBytes: jest.fn(async () => null),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn() }));
// Redis, the boundary: strings, sets and the scripts this feature runs (answered as Redis answers them). `mockRedisUp`
// false = Redis unreachable (the service answers null to every call, as railway-redis.service does).
const mockRedisUp = { v: true };
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const writes = [];
  const set = (k) => { if (!(store.get(k) instanceof Set)) store.set(k, new Set()); return store.get(k); };
  return {
    _store: store, _writes: writes,
    isAvailable: () => mockRedisUp.v,
    get: async (k) => (mockRedisUp.v && store.has(k) ? store.get(k) : null),
    set: async (k, v) => { if (!mockRedisUp.v) return false; writes.push(k); store.set(k, v); return true; },
    setNX: async (k, v) => { if (!mockRedisUp.v) return false; writes.push(k); if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => { writes.push(k); return store.delete(k); },
    incr: async (k) => { if (!mockRedisUp.v) return null; writes.push(k); const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
    expire: async () => mockRedisUp.v,
    evalScript: async (script, keys = [], args = []) => {
      if (!mockRedisUp.v) return null;
      const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
      if (script === P.COUNT_LUA) return set(keys[0]).size;
      if (script === P.TOTAL_LUA) return Number(store.get(keys[0])) || 0;
      if (script === P.CLAIM_LUA) {
        writes.push(keys[0]);
        const s = set(keys[0]);
        const added = !s.has(args[0]);
        s.add(args[0]);
        if (added && s.size > Number(args[1])) { s.delete(args[0]); return -s.size; }
        if (added) { writes.push(keys[1]); store.set(keys[1], (Number(store.get(keys[1])) || 0) + 1); }
        return s.size;
      }
      throw new Error('a script this double does not know');
    },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const logger = require('../../../shared/utils/logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const F = require('./__fixtures__/stories-testwala');

const SWITCH = 'web_quiz_practice_your_turn';
const CAP = 'web_quiz_live_read_preview_keys_per_day';
const TEACHER = '77777777-7777-4777-8777-777777777777';
const TEACHER_B = '88888888-8888-4888-8888-888888888888';
const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const BOOK = F.BOOK(10);
const PAGES = [1, 2, 3, 4, 5, 6].map((n) => ({ ...F.P1, id: F.PAGE(10, n), book_id: BOOK, n }));
// Every switch the child's Your turn rides: stories, live reading v3 + real-time, its word rules, the reading moment and
// its one-sheet picture, Jugnu keeping its passage recordings (a child's notice says "kept"; a preview's never may).
const LIVE = ['web_quiz_stories', 'web_quiz_live_read_v3', 'web_quiz_challenge_realtime', 'web_quiz_lr_repeat', 'web_quiz_read_feedback',
  'web_quiz_read_sheet', 'web_quiz_challenge_keep_audio', 'web_quiz_challenge', 'web_quiz_practice_play'];
const MINT_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';

const realFetch = global.fetch;
let soniox;
let fake; let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default';
  process.env.SONIOX_API_KEY = 'main-key-test-only';
  // Soniox's HTTP API is the boundary: only its host is answered here; the test's own calls reach the real router.
  soniox = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:pv-test-only', expires_at: '2026-11-19T10:00:30Z' }) }));
  global.fetch = (url, init) => (String(url).startsWith('https://api.soniox.com/') ? soniox(url, init) : realFetch(url, init));
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(async () => { global.fetch = realFetch; await new Promise((r) => (server ? server.close(r) : r())); });

function reset() {
  for (const m of ['web-quiz-practice-play', 'web-quiz-stories', 'web-quiz-read-feedback', 'web-quiz-live-read-v3', 'web-quiz-live-read-keys', 'web-quiz-challenge-budget']) {
    require(`../../../shared/services/quiz/${m}`)._reset();
  }
  require('../../../shared/services/quiz/web-quiz-challenge').__reset();
  try { require('../../../shared/services/quiz/web-quiz-live-read-preview')._reset(); } catch (_) { /* not there before the feature */ }
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags', 'web-quiz-book']) require(`../../../shared/services/quiz/${m}`)._resetCache();
}
function world({ turn, live = true, extra = [] } = {}) {
  const settings = [...(live ? LIVE : LIVE.filter((k) => !['web_quiz_live_read_v3', 'web_quiz_challenge_realtime'].includes(k))).map((key) => ({ key, value: true }))];
  if (turn !== undefined) settings.push({ key: SWITCH, value: turn });
  fake = guardColumns(makeFake({
    app_settings: [...settings, ...extra],
    story_books: [F.book(10, { grade: 3, pages: PAGES.length })],
    story_pages: PAGES,
    story_page_voices: [{ ...F.VOICE_P1, id: 'v-b10', page_id: PAGES[0].id, audio_key: `story/sandbox/${BOOK}/a01-dddd0010.ogg` }],
    story_questions: F.QUESTIONS.map((q) => ({ ...q, id: `${q.id}-10`, book_id: BOOK })),
    story_events: [],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    web_quiz_live_read_keys: [],
    web_quiz_challenge_runs: [],
  }));
  Object.assign(supabase, fake);
  reset();
  redis._store.clear();
  redis._writes.length = 0;
  mockRedisUp.v = true;
  soniox.mockClear();
  logEvent.mockClear();
  logger.logError.mockClear();
}

const preview = (over = {}) => T.sign({ k: 'h', ids: [], pr: 1, g: 3, lang: 'en', tu: TEACHER, exp: Math.floor(Date.now() / 1000) + 3600, ...over });
const childHub = () => T.sign({ k: 'h', ids: [KID], exp: Math.floor(Date.now() / 1000) + 3600 });
const DEV = 'FamilyPhoneDeviceRef_1';
const H = { 'x-api-key': 'route-key', 'x-wq-device': 'TeacherPhoneDeviceRef1' };
const get = async (p) => { const r = await fetch(`${base}${p}`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, body, headers = {}) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const bookOf = (t) => get(`/stories/book/${BOOK}/h/${encodeURIComponent(t)}?kid=`);
// the page's own key request (wq-stories-q.js getKey): {st, kid, book, page, lang}; a preview's kid is the hub's null
const keyFor = (t, page, kid = null, headers = {}) => post('/lr/key', { st: t, kid, book: BOOK, page, lang: 'en' }, headers);
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const Stories = () => require('../../../shared/services/quiz/web-quiz-stories');
// the child's book as bookData answers it (no child attached): the payload both sides are judged against
const childBook = async () => { reset(); return Stories().bookData(BOOK); };

describe('GOLDEN: web_quiz_practice_your_turn off -> the preview is exactly today\'s', () => {
  for (const turn of [undefined, false, 'true', 1]) {
    test(`switch ${JSON.stringify(turn)}: the book is today's preview book, byte for byte`, async () => {
      world({ turn });
      const kid = await childBook();
      // today's preview: the child's book without Your turn's four bits, and lr3 false in its own place
      const today = { ...kid };
      ['lrr', 'lr3_keep', 'read_fb', 'read_sheet'].forEach((k) => delete today[k]);
      today.lr3 = false;
      reset();
      const r = await bookOf(preview());
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).toBe(JSON.stringify(today));
      expect(r.body.lr3).toBe(false);
      ['lrr', 'lr3_keep', 'read_fb', 'read_sheet'].forEach((k) => expect(r.body).not.toHaveProperty(k));
    });
    test(`switch ${JSON.stringify(turn)}: the story-page key refuses the preview (401, as today), nothing minted or counted`, async () => {
      world({ turn });
      const r = await keyFor(preview(), 1);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'bad_token' });
      expect(soniox).not.toHaveBeenCalled();
      expect(fake.db.web_quiz_live_read_keys).toEqual([]);
      expect(redis._writes).toEqual([]);
      expect(events('web_quiz.content_refused')).toEqual([expect.objectContaining({ route: 'challenge', practice: 1 })]);
    });
  }
});

describe('web_quiz_practice_your_turn on: the preview book carries Your turn as the child gets it', () => {
  test('the child\'s book with lr3, lrr, read_fb and read_sheet; lr3_keep false (nothing of the voice kept); no share card, no miss row', async () => {
    world({ turn: true });
    const kid = await childBook();
    expect(kid).toMatchObject({ lr3: true, lrr: true, read_fb: 1, read_sheet: 1, lr3_keep: true });
    reset();
    const r = await bookOf(preview());
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toBe(JSON.stringify({ ...kid, lr3_keep: false }));
    expect(fake.db.story_events).toEqual([]);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('the deployment\'s live reading off: no Your turn to give, the preview book is today\'s', async () => {
    world({ turn: true, live: false });
    const kid = await childBook();
    const today = { ...kid };
    ['lrr', 'lr3_keep', 'read_fb', 'read_sheet'].forEach((k) => delete today[k]);
    today.lr3 = false;
    reset();
    expect(JSON.stringify((await bookOf(preview())).body)).toBe(JSON.stringify(today));
  });

  test('a preview link that names no teacher (no `tu`): nobody to count a key against, so no Your turn and no key', async () => {
    world({ turn: true });
    const t = T.sign({ k: 'h', ids: [], pr: 1, g: 3, lang: 'en', exp: Math.floor(Date.now() / 1000) + 3600 });
    const b = await bookOf(t);
    expect(b.status).toBe(200);
    expect(b.body.lr3).toBe(false);
    expect((await keyFor(t, 1)).status).toBe(401);
    expect(soniox).not.toHaveBeenCalled();
  });

  test('the preview\'s story events, Your turn\'s page read included, are answered and never kept', async () => {
    world({ turn: true });
    const t = preview();
    const read = await post(`/stories/event/h/${encodeURIComponent(t)}`, { book_id: BOOK, page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 5, ms: 4000, ended: 'last_word', notice: 1 } });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ ok: true });
    const done = await post(`/stories/event/h/${encodeURIComponent(t)}`, { book_id: BOOK, event: 'story_done', data: {} });
    expect(done.body).toMatchObject({ ok: true, sticker: false });
    expect(fake.db.story_events).toEqual([]);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
});

describe('web_quiz_practice_your_turn on: the preview\'s speech key, counted against the teacher', () => {
  test('a one-read key through the real route: Soniox minted once, no child row, the teacher\'s count is one', async () => {
    world({ turn: true });
    const r = await keyFor(preview(), 1);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ api_key: 'temp:pv-test-only', expires_at: '2026-11-19T10:00:30Z', ws: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5', lang: 'en', run: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(soniox).toHaveBeenCalledTimes(1);
    const [url, init] = soniox.mock.calls[0];
    expect(url).toBe(MINT_URL);
    expect(JSON.parse(init.body)).toMatchObject({ single_use: true, client_reference_id: r.body.run });
    // never under any child: no row in the children's key table, no run row, nothing written to the database
    expect(fake.db.web_quiz_live_read_keys).toEqual([]);
    expect(fake.db.web_quiz_challenge_runs).toEqual([]);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
    const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
    expect(await P.countToday(TEACHER)).toBe(1);
    expect(await P.countToday(TEACHER_B)).toBe(0);
    const ev = events('web_quiz.lr_key');
    expect(ev).toEqual([expect.objectContaining({ src: 'story_page', practice: 1, n: 1, cap: 40 })]);
    // never the teacher's id, never a key, in any line
    const logged = JSON.stringify([logEvent.mock.calls, logger.logToFile.mock.calls, logger.logError.mock.calls]);
    expect(logged).not.toContain(TEACHER);
    expect(logged).not.toContain('temp:pv');
  });

  test('the teacher\'s own day cap (app_settings web_quiz_live_read_preview_keys_per_day): at the cap 429, Soniox not asked, and a new process still says so', async () => {
    world({ turn: true, extra: [{ key: CAP, value: 3 }] });
    for (let p = 1; p <= 3; p += 1) expect((await keyFor(preview(), p)).status).toBe(200);
    soniox.mockClear();
    const rest = await keyFor(preview(), 4);
    expect(rest.status).toBe(429);
    expect(rest.body).toEqual({ error: 'enough_for_today' });
    expect(soniox).not.toHaveBeenCalled();
    // a restart / another replica: nothing in this process remembers, the count is kept outside it
    reset();
    expect((await keyFor(preview(), 5)).status).toBe(429);
    expect(soniox).not.toHaveBeenCalled();
    // another teacher's preview is counted on its own
    expect((await keyFor(preview({ tu: TEACHER_B }), 1)).status).toBe(200);
    expect(events('web_quiz.lr_key_rest')).toEqual(expect.arrayContaining([expect.objectContaining({ practice: 1, n: 3, cap: 3 })]));
  });

  test('the cap absent: 40 a day', async () => {
    world({ turn: true });
    const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
    expect(P.CAP_KEY).toBe(CAP);
    expect(P.PREVIEW_KEYS_PER_DAY).toBe(40);
    expect(await P.cap()).toBe(40);
  });

  test('reading the same page again soon (sentence by sentence) mints fresh keys but counts once', async () => {
    world({ turn: true, extra: [{ key: CAP, value: 2 }] });
    for (let k = 0; k < 4; k += 1) expect((await keyFor(preview(), 1)).status).toBe(200);
    expect(soniox).toHaveBeenCalledTimes(4);
    const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
    expect(await P.countToday(TEACHER)).toBe(1);
    expect((await keyFor(preview(), 2)).status).toBe(200);
    expect((await keyFor(preview(), 3)).status).toBe(429);
  });

  test('two keys asked at once at one below the cap: exactly one is handed out', async () => {
    world({ turn: true, extra: [{ key: CAP, value: 2 }] });
    expect((await keyFor(preview(), 1)).status).toBe(200);
    const got = await Promise.all([keyFor(preview(), 2), keyFor(preview(), 3)]);
    expect(got.map((g) => g.status).sort()).toEqual([200, 429]);
    const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
    expect(await P.countToday(TEACHER)).toBe(2);
  });

  test('the day\'s read budget holds for a preview key as for a child\'s, and a preview key spends it (a quarter of a read)', async () => {
    world({ turn: true, extra: [{ key: 'web_quiz_challenge_daily_reads', value: 1 }] });
    const Budget = require('../../../shared/services/quiz/web-quiz-challenge-budget');
    for (let p = 1; p <= 4; p += 1) expect((await keyFor(preview(), p)).status).toBe(200);
    expect(await Budget.readsToday()).toBe(1);
    // a new process counts the budget again from where the keys are kept: the preview's four are still there
    reset();
    expect(await Budget.readsToday()).toBe(1);
    soniox.mockClear();
    expect((await keyFor(preview(), 5)).status).toBe(429);
    // and the child's key meets the same spent budget
    expect((await keyFor(childHub(), 1, null, { 'x-wq-device': DEV })).status).toBe(429);
    expect(soniox).not.toHaveBeenCalled();
  });

  test('Redis cannot count: no key (503 live_unavailable), Soniox never asked', async () => {
    world({ turn: true });
    mockRedisUp.v = false;
    const r = await keyFor(preview(), 1);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'live_unavailable' });
    expect(soniox).not.toHaveBeenCalled();
  });

  test('the practice home itself off (web_quiz_practice_play): the preview token is refused as today', async () => {
    world({ turn: true });
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'web_quiz_practice_play');
    reset();
    expect((await keyFor(preview(), 1)).status).toBe(401);
    expect(soniox).not.toHaveBeenCalled();
  });
});

describe('a child\'s Your turn and cap are exactly as before, with teachers previewing beside them', () => {
  test('the teacher\'s keys never touch the child\'s count, and the child\'s never touch the teacher\'s', async () => {
    world({ turn: true, extra: [{ key: 'web_quiz_live_read_story_keys_per_day', value: 2 }, { key: CAP, value: 3 }] });
    for (let p = 1; p <= 3; p += 1) expect((await keyFor(preview(), p)).status).toBe(200);
    // the child reads two pages (the child's own cap is 2), then rests: the teacher's three were never theirs
    expect((await keyFor(childHub(), 1, null, { 'x-wq-device': DEV })).status).toBe(200);
    expect((await keyFor(childHub(), 2, null, { 'x-wq-device': DEV })).status).toBe(200);
    expect((await keyFor(childHub(), 3, null, { 'x-wq-device': DEV })).status).toBe(429);
    expect(fake.db.web_quiz_live_read_keys.map((r) => [r.student_id, r.src])).toEqual([[KID, 'story_page'], [KID, 'story_page']]);
    const P = require('../../../shared/services/quiz/web-quiz-live-read-preview');
    expect(await P.countToday(TEACHER)).toBe(3);
    const kidKeys = events('web_quiz.lr_key').filter((e) => !e.practice);
    expect(kidKeys.map((e) => [e.n, e.cap])).toEqual([[1, 2], [2, 2]]);
  });

  test('switch on: the child\'s own book is unchanged (lr3_keep as the deployment says, the share card field still offered)', async () => {
    world({ turn: true });
    const on = await childBook();
    world({ turn: undefined });
    const off = await childBook();
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    expect(on.lr3_keep).toBe(true);
  });
});
