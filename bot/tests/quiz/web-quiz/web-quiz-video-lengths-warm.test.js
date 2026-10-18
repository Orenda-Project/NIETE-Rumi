'use strict';
/**
 * app_settings `web_quiz_video_shelf` (default off; on only for the JSON true) on the hub: opening the hub with the home
 * on asks the library to read the child's grade's lesson lengths in the background (web-quiz-library.warmGrade), so the
 * first Videos open after a restart already shows "6 min" on its lessons. The answer itself is never changed; off, or
 * the home off, asks nothing. Invented children only.
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
const Library = require('../../../shared/services/quiz/web-quiz-library');
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
const SHELF = 'web_quiz_video_shelf';

describe('a hub open warms its grade\'s lesson lengths (web_quiz_video_shelf)', () => {
  let warm;
  beforeEach(() => { warm = jest.spyOn(Library, 'warmGrade').mockImplementation(() => undefined); });
  afterEach(() => warm.mockRestore());
  test('on with the home on: the child\'s grade is asked for once, and the answer is the same as with it never asked', async () => {
    seed([...HOME_ON, ON(SHELF)]);
    const tok = T.signHub([KID]);
    const out = await Hub.hub(tok, A);
    expect(out.home_v3).toBe(1);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(String(warm.mock.calls[0][0])).toBe('3');
    expect(warm.mock.calls[0][1]).toEqual({ lang: out.lang });
    warm.mockImplementation(() => { throw new Error('never stops the hub'); });
    seed([...HOME_ON, ON(SHELF)]);
    expect(JSON.stringify(await Hub.hub(tok, A))).toBe(JSON.stringify(out));
  });
  test.each([['absent', HOME_ON], ['false', [...HOME_ON, { key: SHELF, value: false }]], ['the string true', [...HOME_ON, STR(SHELF)]], ['on, the home off', [...BASE_ON, ON(SHELF)]], ['on, but no Videos door (the library off)', [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home'), ON('web_quiz_home_v3'), ON(SHELF)]]])('%s: nothing is asked', async (_l, settings) => {
    seed(settings);
    await Hub.hub(T.signHub([KID]), A);
    expect(warm).not.toHaveBeenCalled();
  });
});
