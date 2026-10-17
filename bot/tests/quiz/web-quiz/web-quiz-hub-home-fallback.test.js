'use strict';
/**
 * The home's plain fallback switch (app_settings `web_quiz_home_fallback_v3`) on the hub boot JSON: `home_fb: 1` beside
 * `home_v3` only when both are the JSON boolean true; off, absent, the string 'true', or the home itself off -> the
 * payload is today's, byte for byte. Copied set-up from web-quiz-hub-home.test.js.
 * Original header follows.
 * The v3 child home's keys on the hub boot JSON (web-quiz-hub-home.js through the real web-quiz-hub.js): the golden
 * (web_quiz_home_v3 off or absent -> the payload deep-equal to today's, no new key), the three doors always present
 * (an empty door is [] / null, never missing), the Videos door for every child with a library (no class: a watch), the day-dots as a count, the jar
 * only with the Book, and fail-closed reads. Supabase and Redis are the boundaries and are faked. Invented children only.
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
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');
const redis = require('../../../shared/services/cache/railway-redis.service');

const KID = '44444444-4444-4444-8444-000000000071';
const TEACHER = '11111111-1111-4111-8111-000000000071';
const LIST = '55555555-5555-4555-8555-000000000071';
// One fixed clock for every test (a Wednesday noon in PKT): the token's exp, the week's dots and the seeds never move
// between the two hub reads a golden compares (a second boundary between two signHub calls once made the tokens differ).
const NOW = Date.parse('2026-10-14T07:00:00Z');
const ONLY_DATE = { now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] };
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
// A switch is on only as the JSON boolean the flip writes; the string 'true' is OFF (see the string test below).
const ON = (k) => ({ key: k, value: true });
const STR = (k) => ({ key: k, value: 'true' });
const BASE_ON = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home'), ON('web_quiz_library')];

let db;
function seed(settings, over = {}) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE7', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(1), created_at: ago(1), student_class: '3' }],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  Home._resetCache();
}

beforeEach(() => {
  jest.useFakeTimers(ONLY_DATE);
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-home-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  seed(BASE_ON);
});
afterEach(() => jest.useRealTimers());

const HOME_ON = [...BASE_ON, ON('web_quiz_home_v3')];
const FB = 'web_quiz_home_fallback_v3';
const prTok = (over = {}) => T.sign({ k: 'h', ids: [], pr: 1, g: 3, lang: 'en', exp: Math.floor(Date.now() / 1000) + 3600, ...over });

describe('web_quiz_home_fallback_v3', () => {
  test('on (JSON true) with the home on: home_fb: 1 on a child\'s hub and on the practice home', async () => {
    seed([...HOME_ON, ON(FB)]);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.home_v3).toBe(1);
    expect(out.home_fb).toBe(1);
    const pr = await Hub.hub(prTok(), {});
    expect(pr.home_fb).toBe(1);
  });

  test('GOLDEN: absent, false and the string \'true\' -> the payload is today\'s, string-equal, no home_fb', async () => {
    const tok = T.signHub([KID]);
    seed(HOME_ON);
    const base = await Hub.hub(tok, A);
    expect(base).not.toHaveProperty('home_fb');
    for (const row of [{ key: FB, value: false }, STR(FB)]) {
      seed([...HOME_ON, row]);
      const off = await Hub.hub(tok, A);
      expect(JSON.stringify(off)).toBe(JSON.stringify(base));
    }
  });

  test('GOLDEN: on, but the home off -> today\'s hub, no home key, no home_fb', async () => {
    const tok = T.signHub([KID]);
    const base = await Hub.hub(tok, A);
    seed([...BASE_ON, ON(FB)]);
    const out = await Hub.hub(tok, A);
    expect(JSON.stringify(out)).toBe(JSON.stringify(base));
  });

  test('the switch read: JSON true only, its own 30 s cache, fail closed; the home\'s own read is untouched', async () => {
    const Flag = require('../../../shared/services/quiz/web-quiz-home-fallback-flag');
    seed([...HOME_ON, ON(FB)]);
    expect(await Flag.on()).toBe(true);
    expect(await Home.flags()).toEqual({ at: expect.any(Number), home: true, stories: false });
    seed([...HOME_ON, STR(FB)]);
    expect(await Flag.on()).toBe(false);
    seed([...HOME_ON, { key: FB, value: 1 }]);
    expect(await Flag.on()).toBe(false);
    supabase.from = () => { throw new Error('down'); };
    Flag._resetCache();
    expect(await Flag.on()).toBe(false);
    const out = await Flag.withFallback({});
    expect(out).toEqual({});
  });
});
