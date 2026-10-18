'use strict';
/**
 * The class table and the school league with the child home on (app_settings `web_quiz_class_doors`, default OFF):
 *  - the hub boot JSON gets `class_doors: {class, schools}` (the quiz page's /q/<code>/class and /schools for the
 *    child's newest class quiz, with its hub key) beside `home_v3`; a child no teacher's quiz reached gets none;
 *  - finish's fold (web-quiz-hub-door.foldField) gets `class_doors: true` beside `card_fold` for a class child's own run.
 * Off, absent, the string 'true', or the home off -> the payloads are today's, byte for byte. Set-up copied from
 * web-quiz-hub-home-fallback.test.js. Invented children only.
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
const ClassDoors = require('../../../shared/services/quiz/web-quiz-class-doors-flag');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WatchRoot = require('../../../shared/services/quiz/watch-root');

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
  ClassDoors._resetCache();
  WatchRoot._resetCache();
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

const CD = 'web_quiz_class_doors';
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');
const RUN = { id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, status: 'completed', share_code_id: 'sc-1' };

describe('web_quiz_class_doors on the hub', () => {
  test('on with the home on: class_doors names the newest class quiz\'s class table and league, with its hub key', async () => {
    seed([...HOME_ON, ON(CD)]);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.home_v3).toBe(1);
    const k = T.chipId('sc-1', KID);
    // the hub's own language travels on both links, so the table and the league open in it
    expect(out.class_doors).toEqual({ class: `/q/MATH01/class?k=${encodeURIComponent(k)}&lang=${out.lang}`, schools: `/q/MATH01/schools?k=${encodeURIComponent(k)}&lang=${out.lang}` });
    expect(out.lang).toMatch(/^(en|ur)$/);
  });

  test('the newest class quiz wins; a friend\'s challenge code or a library lesson code is never the class', async () => {
    seed([...HOME_ON, ON(CD)], {
      quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }, { id: 'q-2', topic: 'Plants', subject: 'Science', language: 'en', grade: '3', video_id: null }],
      quiz_share_codes: [
        { id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) },
        { id: 'sc-2', code: 'SCI002', quiz_id: 'q-2', active: true, expires_at: ahead(240), topic: 'Plants', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(20) },
        { id: 'sc-3', code: 'FRND03', quiz_id: 'q-2', active: true, expires_at: ahead(240), topic: 'Plants', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: 'sc-2', invited_by_student_id: KID, created_at: ago(2) },
      ],
      quiz_sessions: [
        { id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(9), created_at: ago(9), student_class: '3' },
        { id: 's2', share_code_id: 'sc-2', quiz_id: 'q-2', student_id: KID, status: 'completed', correct_answers: 5, total_questions_answered: 10, mastery_percentage: 50, completed_at: ago(5), created_at: ago(5), student_class: '3' },
        { id: 's3', share_code_id: 'sc-3', quiz_id: 'q-2', student_id: KID, status: 'completed', correct_answers: 9, total_questions_answered: 10, mastery_percentage: 90, completed_at: ago(1), created_at: ago(1), student_class: '3' },
      ],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.class_doors.class).toMatch(/^\/q\/SCI002\/class\?k=/);
    expect(out.class_doors.schools).toMatch(/^\/q\/SCI002\/schools\?k=/);
  });

  // The watch root (app_settings VALUE web_quiz_watch_root) has no parent, so the hub counts it as teacher-sent; its table
  // is every school's strangers. A newer run on it (or on a video code under it) never takes the home's class doors.
  test('the watch root and a video code under it are never the class: the doors name the class quiz', async () => {
    const ROOT = '66666666-6666-4666-8666-000000000071';
    const WATCH = '77777777-7777-4777-8777-000000000071';
    seed([...HOME_ON, ON(CD), { key: 'web_quiz_watch_root', value: ROOT }], {
      quiz_share_codes: [
        { id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) },
        { id: ROOT, code: 'ROOT01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(3) },
        { id: WATCH, code: 'WTCH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: ROOT, invited_by_student_id: null, created_at: ago(3) },
      ],
      quiz_sessions: [
        { id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(9), created_at: ago(9), student_class: '3' },
        { id: 's3', share_code_id: WATCH, quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 6, total_questions_answered: 10, mastery_percentage: 60, completed_at: ago(2), created_at: ago(2), student_class: '3' },
        { id: 's2', share_code_id: ROOT, quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 5, total_questions_answered: 10, mastery_percentage: 50, completed_at: ago(1), created_at: ago(1), student_class: '3' },
      ],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.class_doors.class).toMatch(/^\/q\/MATH01\/class\?k=/);
    expect(out.class_doors.schools).toMatch(/^\/q\/MATH01\/schools\?k=/);
  });

  test('a child no teacher\'s quiz has reached: no class_doors', async () => {
    seed([...HOME_ON, ON(CD)], { quiz_sessions: [] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.home_v3).toBe(1);
    expect(out).not.toHaveProperty('class_doors');
  });

  test('GOLDEN: absent, false and the string \'true\' -> the payload is today\'s, string-equal', async () => {
    const tok = T.signHub([KID]);
    seed(HOME_ON);
    const base = await Hub.hub(tok, A);
    expect(base).not.toHaveProperty('class_doors');
    for (const row of [{ key: CD, value: false }, STR(CD)]) {
      seed([...HOME_ON, row]);
      expect(JSON.stringify(await Hub.hub(tok, A))).toBe(JSON.stringify(base));
    }
  });

  test('GOLDEN: on, but the home off -> today\'s hub', async () => {
    const tok = T.signHub([KID]);
    const base = await Hub.hub(tok, A);
    seed([...BASE_ON, ON(CD)]);
    expect(JSON.stringify(await Hub.hub(tok, A))).toBe(JSON.stringify(base));
  });
});

describe('web_quiz_class_doors linksOf', () => {
  test('the language travels only when it is en or ur', () => {
    const h = [{ teacherSent: true, code: 'MATH01', shareCodeId: 'sc-1' }];
    for (const lang of ['en', 'ur']) expect(ClassDoors.linksOf(h, KID, null, lang).class).toMatch(new RegExp(`&lang=${lang}$`));
    for (const lang of ['fr', 'ur&x=1', '', null]) expect(JSON.stringify(ClassDoors.linksOf(h, KID, null, lang))).not.toContain('lang=');
  });
});

describe('web_quiz_class_doors on finish\'s fold', () => {
  test('on with the home on: {card_fold, class_doors} for a class child\'s own run', async () => {
    seed([...HOME_ON, ON(CD)]);
    expect(await Door.foldField(RUN)).toEqual({ card_fold: true, class_doors: true });
  });
  test('a child with no class: no_class, never class_doors', async () => {
    seed([...HOME_ON, ON(CD)], { quiz_sessions: [] });
    expect(await Door.foldField(RUN)).toEqual({ card_fold: true, no_class: true });
  });
  test('a friend\'s challenge run or a teacher\'s test run: {}', async () => {
    seed([...HOME_ON, ON(CD)]);
    expect(await Door.foldField({ ...RUN, invited_by_student_id: 'someone-else' })).toEqual({});
    expect(await Door.foldField({ ...RUN, user_id: TEACHER })).toEqual({});
  });
  // The watch root (app_settings VALUE web_quiz_watch_root) is a code with no parent, so the hub counts it as teacher-sent;
  // its table is every school's strangers. Its video codes hang under it. Neither is the child's class.
  const ROOT = '66666666-6666-4666-8666-000000000071';
  const WATCH = '77777777-7777-4777-8777-000000000071';
  const rootCodes = (over = {}) => ({
    quiz_share_codes: [...db.quiz_share_codes,
      { id: ROOT, code: 'ROOT01', quiz_id: 'q-1', active: true, expires_at: ahead(240), teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(2) },
      { id: WATCH, code: 'WTCH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), teacher_user_id: TEACHER, parent_share_code_id: ROOT, invited_by_student_id: null, created_at: ago(2) }],
    quiz_sessions: [...db.quiz_sessions,
      { id: 's2', share_code_id: ROOT, quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 5, total_questions_answered: 10, completed_at: ago(0.5), created_at: ago(0.5) },
      { id: 's3', share_code_id: WATCH, quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 6, total_questions_answered: 10, completed_at: ago(0.2), created_at: ago(0.2) }],
    ...over,
  });
  test('a run on the watch root or on a video code under it: never class_doors (a class child keeps no_class off)', async () => {
    seed([...HOME_ON, ON(CD), { key: 'web_quiz_watch_root', value: ROOT }], rootCodes());
    expect(await Door.foldField({ ...RUN, id: 's2', share_code_id: ROOT })).toEqual({ card_fold: true });
    expect(await Door.foldField({ ...RUN, id: 's3', share_code_id: WATCH })).toEqual({ card_fold: true });
    expect(await Door.foldField(RUN)).toEqual({ card_fold: true, class_doors: true });
  });
  test('GOLDEN: absent, false, the string \'true\' -> today\'s fold; home off -> {}', async () => {
    for (const rows of [HOME_ON, [...HOME_ON, { key: CD, value: false }], [...HOME_ON, STR(CD)]]) {
      seed(rows);
      expect(await Door.foldField(RUN)).toEqual({ card_fold: true });
    }
    seed([...BASE_ON, ON(CD)]);
    expect(await Door.foldField(RUN)).toEqual({});
  });
  // The watch root's VALUE cannot be read (past watch-root.js's 30 s cache): the doors stay closed, never open onto it.
  const rootDown = () => {
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const sel = b.select.bind(b);
      b.select = (...a) => { const q = sel(...a); const eq = q.eq.bind(q); q.eq = (k, v) => { if (v === 'web_quiz_watch_root') throw new Error('down'); return eq(k, v); }; return q; };
      return b;
    };
  };
  test('the watch root cannot be read: a run on the root gets no class_doors (fails closed)', async () => {
    seed([...HOME_ON, ON(CD), { key: 'web_quiz_watch_root', value: ROOT }], rootCodes());
    jest.setSystemTime(NOW + 10 * 60 * 1000);
    rootDown();
    expect(await Door.foldField({ ...RUN, id: 's2', share_code_id: ROOT })).toEqual({ card_fold: true });
  });
  test('the watch root cannot be read: the home\'s doors never name the root', async () => {
    seed([...HOME_ON, ON(CD), { key: 'web_quiz_watch_root', value: ROOT }], rootCodes());
    jest.setSystemTime(NOW + 20 * 60 * 1000);
    rootDown();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(JSON.stringify(out.class_doors || {})).not.toMatch(/ROOT01/);
  });
  test('the child\'s quizzes cannot be read: the fold is today\'s, never no_class', async () => {
    seed([...HOME_ON, ON(CD)]);
    const SQ = require('../../../shared/services/quiz/student-quiz.service');
    const spy = jest.spyOn(SQ, 'quizzesForStudents').mockRejectedValue(new Error('down'));
    expect(await Door.foldField(RUN)).toEqual({ card_fold: true });
    spy.mockRestore();
  });
  test('switch off: the watch root is never read, on the fold or on the hub', async () => {
    seed([...HOME_ON, { key: 'web_quiz_watch_root', value: ROOT }], rootCodes());
    const spy = jest.spyOn(WatchRoot, 'watchRootId');
    await Door.foldField(RUN);
    await Hub.hub(T.signHub([KID]), A);
    expect(spy.mock.calls.filter((c) => c[1] && c[1].strict)).toEqual([]);
    spy.mockRestore();
  });
  test('a read error on the switch: off (fails closed), the fold stays today\'s', async () => {
    seed([...HOME_ON, ON(CD)]);
    await Home.flags();
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'app_settings') throw new Error('down'); return from(t); };
    expect(await Door.foldField(RUN)).toEqual({ card_fold: true });
  });
});
