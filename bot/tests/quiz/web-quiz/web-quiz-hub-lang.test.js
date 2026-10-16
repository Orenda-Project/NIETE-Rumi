'use strict';
/**
 * The hub honours the language the child chose (?lang=en|ur on /h/<token>, forwarded by the edge) over the guess
 * from their history, ONLY under app_settings web_quiz_challenge_v2 (with its parents web_quiz_challenge and
 * web_quiz_hub, read like web-quiz-hub-play.js: 30 s cache, fail closed). Without lang, with any other value, or
 * with the switch off, the payload is deep-equal to today's. Supabase and Redis are the boundaries and are faked;
 * every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const redis = require('../../../shared/services/cache/railway-redis.service');

const KID = '44444444-4444-4444-8444-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
// One clock for the file: each side of a comparison seeds the same rows, to the millisecond.
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: 'true' });
const BASE = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_library')];
const V2 = [...BASE, ON('web_quiz_challenge_v2')];

let db;
let reads;
function seed(settings, { failSettings = false } = {}) {
  db = {
    app_settings: settings,
    // An English history (the guess says en) and an Urdu spelling of the name (shown only on an Urdu hub).
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '3', list_id: LIST, is_active: true, phone: '923000000000', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3' }],
  };
  const fake = makeFake(db);
  reads = [];
  const from = (t) => {
    reads.push(t);
    if (failSettings && t === 'app_settings') {
      const err = { data: null, error: { message: 'settings down' } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
      return chain;
    }
    return fake.from(t);
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  seed(BASE);
});

// A fresh hub, so the device binding and the caches start alike for each side of a comparison.
async function hubWith(settings, opts) {
  redis._store.clear();
  seed(settings);
  return Hub.hub(T.signHub([KID]), { ...A, ...opts });
}

describe('under web_quiz_challenge_v2: ?lang wins over the history guess', () => {
  test('lang=ur on an English history: an Urdu hub (the name, the library link)', async () => {
    const guess = await hubWith(V2, {});
    expect(guess.lang).toBe('en');
    const out = await hubWith(V2, { lang: 'ur' });
    expect(out.lang).toBe('ur');
    expect(out.kids[0].first).toBe('زارا');
    expect(out.lib.href).toMatch(/&l=ur$/);
  });

  test('lang=en on an Urdu history: an English hub', async () => {
    seed(V2);
    db.quizzes[0].language = 'ur';
    db.quiz_share_codes[0].language = 'ur';
    redis._store.clear();
    const guess = await Hub.hub(T.signHub([KID]), A);
    expect(guess.lang).toBe('ur');
    redis._store.clear();
    Hub._resetCache(); Play._resetCache();
    const out = await Hub.hub(T.signHub([KID]), { ...A, lang: 'en' });
    expect(out.lang).toBe('en');
    expect(out.kids[0].first).toBe('Zara');
  });

  test('a phone that may not see the children: the locked hub is in the chosen language too', async () => {
    seed(V2);
    const token = T.signHub([KID]);
    await Hub.hub(token, A);                               // the first phone binds the link
    const out = await Hub.hub(token, { device: 'BBBBBBBBBBBBBBBBBBBBBB', lang: 'ur' });
    expect(out).toMatchObject({ locked: true, lang: 'ur', kids: [] });
  });
});

describe('GOLDEN: anything else is today\'s payload, deep-equal', () => {
  test.each([
    ['switch absent', BASE],
    ['switch false', [...BASE, { key: 'web_quiz_challenge_v2', value: 'false' }]],
    ['switch on but its parent web_quiz_challenge off', [ON('web_quiz_hub'), ON('web_quiz_library'), ON('web_quiz_challenge_v2')]],
  ])('%s: lang=ur changes nothing', async (_n, settings) => {
    const base = await hubWith(settings, {});
    const asked = await hubWith(settings, { lang: 'ur' });
    expect(asked).toEqual(base);
    expect(asked.lang).toBe('en');
  });

  test.each([[undefined], [''], ['fr'], ['UR'], [['ur']], ['ur&x=1']])('switch on, lang=%p: today\'s payload', async (lang) => {
    const base = await hubWith(V2, {});
    const out = await hubWith(V2, { lang });
    expect(out).toEqual(base);
  });

  test('no lang asked: no extra settings read (the bot\'s reads are today\'s)', async () => {
    const before = (await hubWith(BASE, {}), reads.slice());
    await hubWith(BASE, { lang: undefined });
    expect(reads).toEqual(before);
  });

  test('the settings read fails: closed, the history guess', async () => {
    redis._store.clear();
    seed(V2, { failSettings: true });
    // Every switch read fails here, so the hub itself is off (503): the language never decides anything.
    await expect(Hub.hub(T.signHub([KID]), { ...A, lang: 'ur' })).rejects.toMatchObject({ status: 503 });
  });

  test('the v2 read alone fails: closed, the history guess', async () => {
    redis._store.clear();
    seed(V2);
    const spy = jest.spyOn(Play, 'switches').mockRejectedValue(new Error('down'));
    try {
      const out = await Hub.hub(T.signHub([KID]), { ...A, lang: 'ur' });
      expect(out.lang).toBe('en');
    } finally { spy.mockRestore(); }
  });
});

describe('the internal routes hand the hub its lang', () => {
  test('GET /hub/:token?lang=ur and POST /hub/:token {lang} -> opts.lang', async () => {
    const express = require('express');
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const spy = jest.spyOn(Hub, 'hub').mockResolvedValue({ kids: [] });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
      await fetch(`${base}/hub/abc.def?src=door&lang=ur`, { headers: { 'x-api-key': 'route-key' } });
      await fetch(`${base}/hub/abc.def`, { method: 'POST', headers: { 'x-api-key': 'route-key', 'content-type': 'application/json' }, body: JSON.stringify({ kid: 'k', device_ref: 'd', lang: 'en' }) });
      expect(spy.mock.calls[0][1]).toMatchObject({ src: 'door', lang: 'ur' });
      expect(spy.mock.calls[1][1]).toMatchObject({ kid: 'k', device: 'd', lang: 'en' });
    } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
  });
});
