'use strict';
/**
 * The child's first open, "Jugnu says hello" (app_settings `web_quiz_child_welcome`, default OFF, JSON true only; only
 * with `web_quiz_home_v3` on), the server's half: the hub answer for a chosen child says `welcome: {v, attempt}` while
 * this child has not finished or skipped it and has been shown it fewer than 2 times; the page's one write (POST
 * /hub/:token/welcome {kid, outcome: shown|done|skipped}) keeps that per child in Redis (`wq:welcome:<hash>`); the
 * second show is written done at once, so there is never a third. The key rides the home's one settings read. While
 * the welcome is up, the Next stop it shows is not counted as an untapped show. Off, or the home off: the hub answer
 * is today's, byte for byte, and Redis is never asked. Invented children only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn(async function set(k, v) { if (!this._up) return false; store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
    incr: jest.fn(async () => 1), expire: jest.fn(async () => true),
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
const tryReq = (p) => { try { return require(p); } catch (_) { return null; } };
const Welcome = tryReq('../../../shared/services/quiz/web-quiz-child-welcome');

const KID = '44444444-4444-4444-8444-000000000081';
const SIB = '44444444-4444-4444-8444-000000000082';
const TEACHER = '11111111-1111-4111-8111-000000000081';
const LIST = '55555555-5555-4555-8555-000000000081';
const NOW = Date.parse('2026-10-14T07:00:00Z');
const ONLY_DATE = { now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] };
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: true });
const BASE_ON = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home'), ON('web_quiz_library')];
const HOME_ON = [...BASE_ON, ON('web_quiz_home_v3')];
const W = 'web_quiz_child_welcome';

let db;
let fake;
function seed(settings, over = {}) {
  db = {
    app_settings: settings,
    students: [
      { id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE8', created_at: ago(500) },
      { id: SIB, student_name: 'Omar Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE8', created_at: ago(400) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [
      { id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(1), created_at: ago(1), student_class: '3', device_ref: A.device },
      { id: 's2', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: SIB, status: 'completed', correct_answers: 5, total_questions_answered: 10, mastery_percentage: 50, completed_at: ago(2), created_at: ago(2), student_class: '3', device_ref: A.device },
    ],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  Home._resetCache();
}
beforeEach(() => {
  jest.useFakeTimers(ONLY_DATE);
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'welcome-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  redis._up = true;
  seed(HOME_ON);
});
afterEach(() => jest.useRealTimers());

const stable = (o) => JSON.parse(JSON.stringify(o));
const tok = () => T.signHub([KID, SIB]);
const hubOf = async (who = KID, t = tok()) => stable(await Hub.hub(t, { ...A, kid: T.chipId('h', who) }));
const reads = (t) => fake.calls.filter((c) => c.table === t && c.op === 'select').length;
const record = (outcome, who = KID, t = tok()) => Welcome.record({ token: t, kid: T.chipId('h', who), device: A.device, outcome });

describe('switch off, or the home off: today\'s hub answer, byte for byte; Redis never asked', () => {
  test('absent, false, the string "true": no `welcome`, the same answer as without the key', async () => {
    const base = await hubOf();
    expect(base.home_v3).toBe(1);
    for (const value of [false, 'true', { enabled: true }]) {
      seed([...HOME_ON, { key: W, value }]);
      const out = await hubOf();
      expect([value, 'welcome' in out]).toEqual([value, false]);
      expect(out).toEqual(base);
    }
    expect(redis.get.mock.calls.filter(([k]) => /^wq:welcome:/.test(k))).toEqual([]);
  });
  test('on with the home off: inert (no key, nothing asked)', async () => {
    seed([...BASE_ON]);
    const base = await hubOf();
    seed([...BASE_ON, ON(W)]);
    const out = await hubOf();
    expect(out).toEqual(base);
    expect(redis.get.mock.calls.filter(([k]) => /^wq:welcome:/.test(k))).toEqual([]);
  });
});

describe('switch on with the home on', () => {
  beforeEach(() => seed([...HOME_ON, ON(W)]));
  test('a chosen child never welcomed: `welcome: {v, attempt: 1}`, the only key added; the same settings reads as off', async () => {
    const on = await hubOf();
    const onReads = reads('app_settings');
    expect(on.welcome).toEqual({ v: Welcome.V, attempt: 1 });
    seed(HOME_ON);
    const off = await hubOf();
    const offReads = reads('app_settings');
    const rest = { ...on };
    delete rest.welcome;
    expect(rest).toEqual(off);
    expect(onReads).toBe(offReads);
  });
  test('no chosen child (a phone with two and none picked): no `welcome`', async () => {
    const out = stable(await Hub.hub(tok(), A));
    expect(out.kid).toBeNull();
    expect('welcome' in out).toBe(false);
  });
  test('done or skipped: never again (only its replay on demand); per child, so a brother on the same phone still gets his own', async () => {
    for (const outcome of ['done', 'skipped']) {
      redis._store.clear();
      expect((await record(outcome)).ok).toBe(true);
      expect((await hubOf(KID)).welcome).toEqual({ v: Welcome.V, replay: 1 });
      expect((await hubOf(SIB)).welcome).toEqual({ v: Welcome.V, attempt: 1 });
    }
  });
  test('left early: shown again as attempt 2; the second show is written done, so there is never a third', async () => {
    await record('shown');
    expect((await hubOf()).welcome).toEqual({ v: Welcome.V, attempt: 2 });
    await record('shown');
    expect((await hubOf()).welcome).toEqual({ v: Welcome.V, replay: 1 });
  });
  test('a grown-up\'s "Show Jugnu\'s hello again" (reset) re-arms it for that child only', async () => {
    await record('done');
    await record('done', SIB);
    expect((await record('reset')).ok).toBe(true);
    expect((await hubOf(KID)).welcome).toEqual({ v: Welcome.V, attempt: 1 });
    expect((await hubOf(SIB)).welcome).toEqual({ v: Welcome.V, replay: 1 });
  });
  test('no Redis: no welcome (it cannot be kept once per child), and the hub still answers', async () => {
    redis._up = false;
    const out = await hubOf();
    expect(out.home_v3).toBe(1);
    expect('welcome' in out).toBe(false);
  });
  test('the write: another link\'s child or an unknown outcome is refused; off is 404', async () => {
    await expect(Welcome.record({ token: tok(), kid: 'nope', device: A.device, outcome: 'done' })).rejects.toMatchObject({ status: 403 });
    await expect(record('maybe')).rejects.toMatchObject({ status: 400 });
    seed(HOME_ON);
    await expect(record('done')).rejects.toMatchObject({ status: 404 });
  });
});

describe('the Next stop under the welcome is not an untapped show', () => {
  const NO = require('../../../shared/services/quiz/web-quiz-next-offer');
  test('nextFor with hold: the "shown, not tapped" streak stays where it was', async () => {
    seed([...HOME_ON, ON(W), ON('web_quiz_next_offer')]);
    NO._resetCache();
    const cand = [{ kind: 'quiz', id: 'q.a', href: '/q/A', title: 'x', title_ur: 'x', minutes: 3, rule: 'teacher_quiz', sent_at: ago(1) }];
    const key = (k) => [...redis._store.keys()].find((x) => !/^wq:(welcome|sit):/.test(x) && redis._store.get(x) && typeof redis._store.get(x) === 'object' && 's' in redis._store.get(x));
    await NO.nextFor({ ctx: 'home', studentId: KID, candidates: cand });
    const k = key();
    expect(k).toBeTruthy();
    const after1 = JSON.stringify(redis._store.get(k).s);
    await NO.nextFor({ ctx: 'home', studentId: KID, candidates: cand, hold: true });
    expect(JSON.stringify(redis._store.get(k).s)).toBe(after1);
    await NO.nextFor({ ctx: 'home', studentId: KID, candidates: cand });
    expect(redis._store.get(k).s.n).toBe(JSON.parse(after1).n + 1);
  });
  test('the hub holds it only while the welcome itself is up, never for its replay', async () => {
    const Src = require('../../../shared/services/quiz/web-quiz-next-offer-sources');
    const spy = jest.spyOn(NO, 'nextFor').mockResolvedValue(null);
    const out = { kid: 'c1', teacher: { code: 'NEWQ01', k: 'k1', topic: 'Shapes', subject: 'maths' }, again: [] };
    const prep = Promise.resolve({ rows: { quizIds: new Map(), storyCodes: new Set(), unsentCodes: new Set(), known: null, covers: new Map() }, onItsWay: [], books: [], sw: { watch: false } });
    for (const [w, held] of [[{ welcome: { v: 1, attempt: 1 } }, true], [{ welcome: { v: 1, replay: 1 } }, false], [{}, false]]) {
      spy.mockClear();
      await Src.hubField({ out, token: 't', history: [], lang: 'en', chosenId: KID, grade: '3', subjectArt: () => null, prep, hold: Promise.resolve(w) });
      expect([w, Boolean(spy.mock.calls[0] && spy.mock.calls[0][0].hold)]).toEqual([w, held]);
    }
    spy.mockRestore();
  });
});

describe('the page\'s welcome lines ride the v3 envelope', () => {
  const E3 = require('../../../shared/services/quiz/web-quiz-events-v3');
  test('welcome_shown / _step / _skip / _done keep their fields, by their rules', () => {
    for (const n of ['welcome_shown', 'welcome_step', 'welcome_skip', 'welcome_done']) expect([n, E3.relayed({ n })]).toEqual([n, true]);
    expect(E3.clean3({ n: 'welcome_shown', form: 'short', v: 1, attempt: 2, lang: 'ur', junk: 'x' })).toEqual({ form: 'short', v: 1, attempt: 2, lang: 'ur' });
    expect(E3.clean3({ n: 'welcome_step', n_step: 9, step: 3, ms_since_shown: 4200 })).toEqual({ step: 3, ms_since_shown: 4200 });
    expect(E3.clean3({ n: 'welcome_skip', at_step: 2 })).toEqual({ at_step: 2 });
    expect(E3.clean3({ n: 'welcome_done', via: 'letsgo', ms_since_shown: 9000 })).toEqual({ via: 'letsgo', ms_since_shown: 9000 });
    expect(E3.clean3({ n: 'welcome_done', via: 'elsewhere' })).toEqual({});
  });
});
