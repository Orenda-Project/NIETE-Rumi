'use strict';
/**
 * The v3 child home's keys on the hub boot JSON (web-quiz-hub-home.js through the real web-quiz-hub.js): the golden
 * (web_quiz_home_v3 off or absent -> the payload deep-equal to today's, no new key), the three doors always present
 * (an empty door is [] / null, never missing), the Videos door only with a class quiz, the day-dots as a count, the jar
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
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: 'true' });
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
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-home-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  seed(BASE_ON);
});

describe('GOLDEN: web_quiz_home_v3 off -> the hub payload is today\'s', () => {
  test('absent and false give the same payload, with no home key', async () => {
    const base = await Hub.hub(T.signHub([KID]), A);
    seed([...BASE_ON, { key: 'web_quiz_home_v3', value: 'false' }, ON('web_quiz_stories')]);
    const off = await Hub.hub(T.signHub([KID]), A);
    expect(off).toEqual(base);
    expect(JSON.stringify(off)).toBe(JSON.stringify(base));
    ['home_v3', 'doors', 'head'].forEach((k) => expect(off).not.toHaveProperty(k));
  });

  test('a settings read that fails -> fail closed: no home key', async () => {
    seed([...BASE_ON, ON('web_quiz_home_v3')]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const inner = b.in.bind(b);
      b.in = (c, vs) => (vs.includes('web_quiz_home_v3') ? Promise.resolve({ data: null, error: { message: 'down' } }) : inner(c, vs));
      return b;
    };
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).not.toHaveProperty('home_v3');
    expect(out).not.toHaveProperty('doors');
  });
});

describe('web_quiz_home_v3 on: the doors and the header', () => {
  const HOME_ON = [...BASE_ON, ON('web_quiz_home_v3')];

  test('the three doors are always present; keys are added, nothing of today\'s changes', async () => {
    const base = await Hub.hub(T.signHub([KID]), A);
    seed(HOME_ON);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.home_v3).toBe(1);
    expect(Object.keys(out.doors).sort()).toEqual(['games', 'stories', 'videos']);
    expect(Array.isArray(out.doors.stories)).toBe(true);
    expect(Array.isArray(out.doors.games)).toBe(true);
    const { home_v3: _h, doors: _d, head: _x, ...rest } = out;
    expect(rest).toEqual(base);
  });

  test('Games: the teacher\'s finished quiz is a done row; the numbers game with the challenge on', async () => {
    seed(HOME_ON);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.doors.games).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'quiz', code: 'MATH01', done: true }),
      { kind: 'numbers' },
    ]));
    // No score about the child rides in a door row.
    expect(JSON.stringify(out.doors)).not.toMatch(/"(best|score|tries)"/);
  });

  test('Videos: the library href for a child with a class quiz; null (door shown empty) for a child with none', async () => {
    seed(HOME_ON);
    const withRoot = await Hub.hub(T.signHub([KID]), A);
    expect(withRoot.doors.videos).toEqual(expect.objectContaining({ href: expect.stringMatching(/^\/lib\//) }));
    seed(HOME_ON, { quiz_share_codes: [], quiz_sessions: [] });
    const none = await Hub.hub(T.signHub([KID]), A);
    expect(none.doors).toHaveProperty('videos', null);
    expect(none.doors.stories).toEqual([]);
  });

  test('Stories: the storybook shelf stub only with web_quiz_stories on', async () => {
    seed(HOME_ON);
    expect((await Hub.hub(T.signHub([KID]), A)).doors.stories).not.toContainEqual({ kind: 'shelf' });
    seed([...HOME_ON, ON('web_quiz_stories')]);
    expect((await Hub.hub(T.signHub([KID]), A)).doors.stories).toContainEqual({ kind: 'shelf' });
  });

  test('head: day-dots are a count of days with a finish this week (never a number shown), jar only with the Book', async () => {
    seed(HOME_ON);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.head).toEqual({ dots: 1, today: expect.any(Boolean), jar: null });
  });

  test('a locked phone (forwarded link) gets no home keys and no names', async () => {
    seed(HOME_ON);
    await Hub.hub(T.signHub([KID]), A);
    const other = await Hub.hub(T.signHub([KID]), { device: 'BBBBBBBBBBBBBBBBBBBBBB' });
    expect(other.locked).toBe(true);
    expect(other).not.toHaveProperty('doors');
  });
});

describe('pure parts', () => {
  test('doorsOf: shelf passages become story ids; "more stories" (a dead end) is never a door row', () => {
    const d = Home.doorsOf({
      out: { play: { shelf: [{ id: 'week_story', pid: 'p1', nx: 'new', title: 'The red kite' }, { id: 'listen', pid: 'p2', nx: 'seen' }, { id: 'numbers', nx: 'seen' }, { id: 'older', nx: 'seen' }] } },
      stories: false, hasRoot: false,
    });
    expect(d.stories).toEqual([{ kind: 'passage', id: 'p1', fresh: true, title: 'The red kite' }, { kind: 'listen', id: 'p2', fresh: false }]);
    expect(d).toEqual({ stories: d.stories, games: [], videos: null });
  });

  test('headOf: counts days, not finishes; ignores last week', () => {
    const now = Date.parse('2026-10-16T12:00:00Z'); // a Friday in PKT
    const h = Home.headOf(['2026-10-16T08:00:00Z', '2026-10-16T09:00:00Z', '2026-10-13T08:00:00Z', '2026-10-10T08:00:00Z'], now);
    expect(h).toEqual({ dots: 2, today: true });
  });
});
