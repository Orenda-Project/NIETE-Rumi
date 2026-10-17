'use strict';
/**
 * After a quiz with the child home on (app_settings web_quiz_home_v3): finish() tells the card to fold to the card and
 * ONE next thing (`card_fold`), only on a class child's own run; and the card's Home row reaches the child's home
 * (POST /hubdoor {home}) on a finished run even with the card's door and the Home button switched off.
 * Home off: the finish payload and the door are today's. Supabase and Redis are the boundaries and are faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const HomeFlags = require('../../../shared/services/quiz/web-quiz-home-flags');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const FRIEND = '44444444-4444-4444-8444-555555555555';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// lesson: the quiz's code is a library lesson's (a "watch more" code under a teacher's), so no teacher sent this child a quiz
function seed({ home, door = false, sess = {}, lesson = false } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_hub_door', value: door },
      ...(home === undefined ? [] : [{ key: 'web_quiz_home_v3', value: home }])],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: future, invited_by_student_id: null, parent_share_code_id: lesson ? 'sc-parent' : null, created_at: ago(30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'in_progress', user_id: null,
      invited_by_student_id: null, created_at: ago(0.1), device_ref: D1, ...sess }],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's1', question_id: Q(n), selected_option: 'A', is_correct: true })),
    students: [{ id: KID, student_name: 'Zara Testwala' }, { id: FRIEND, student_name: 'Omar Testwala' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const st = (over = {}) => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC, ...over });
const err = async (p) => { try { await p; } catch (e) { return { status: e.status, ...(e.body || {}) }; } return null; };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'fold-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  Flags._resetCache();
  HomeFlags._resetCache();
});
afterAll(() => { process.env = SAVED; });

describe('finish(): the card folds with the home on', () => {
  test('a class child\'s own run, the home on: card_fold', async () => {
    seed({ home: true });
    expect((await WQ.finishSession({ st: st() })).card_fold).toBe(true);
  });
  test('the home off or absent, or the string "true": no key (the payload is today\'s)', async () => {
    for (const home of [undefined, false, 'true']) {
      Flags._resetCache(); HomeFlags._resetCache();
      seed({ home });
      expect(await WQ.finishSession({ st: st() })).not.toHaveProperty('card_fold');
    }
  });
  test('a child with no class (no quiz a teacher sent: a library lesson\'s code), the home on: no_class beside card_fold (the card says "Share")', async () => {
    seed({ home: true, lesson: true });
    expect(await WQ.finishSession({ st: st() })).toMatchObject({ card_fold: true, no_class: true });
  });
  test('a class child (this quiz is the teacher\'s): card_fold, no no_class; home off: neither key', async () => {
    seed({ home: true });
    const out = await WQ.finishSession({ st: st() });
    expect(out.card_fold).toBe(true);
    expect(out).not.toHaveProperty('no_class');
    for (const home of [undefined, false, 'true']) {
      Flags._resetCache(); HomeFlags._resetCache();
      seed({ home, lesson: true });
      expect(await WQ.finishSession({ st: st() })).not.toHaveProperty('no_class');
    }
  });
  test('a friend\'s challenge run and the teacher\'s own run: no key', async () => {
    seed({ home: true, sess: { student_id: FRIEND, invited_by_student_id: KID } });
    expect(await WQ.finishSession({ st: st() })).not.toHaveProperty('card_fold');
    HomeFlags._resetCache();
    seed({ home: true, sess: { student_id: null, user_id: TEACHER } });
    expect(await WQ.finishSession({ st: st() })).not.toHaveProperty('card_fold');
  });
});

describe('the folded card\'s Home row: the door to the child\'s home on a finished run', () => {
  test('home on, the card\'s door and the Home button off: a hub link for this child', async () => {
    seed({ home: true, sess: { status: 'completed' } });
    expect((await Door.door({ st: st(), home: 1 }, WQ.WqError)).href).toMatch(/^\/h\/[A-Za-z0-9._-]+$/);
  });
  test('home on, the run not finished: 404 no_door (the Home button\'s own rule is unchanged)', async () => {
    seed({ home: true });
    expect(await err(Door.door({ st: st(), home: 1 }, WQ.WqError))).toMatchObject({ status: 404, error: 'no_door' });
  });
  test('home off: 404 no_door, as today', async () => {
    seed({ home: false, sess: { status: 'completed' } });
    expect(await err(Door.door({ st: st(), home: 1 }, WQ.WqError))).toMatchObject({ status: 404, error: 'no_door' });
  });
});

describe('the Jugnu page\'s menu (GET /ch/:token): its end cards fold the same way with the home on', () => {
  const express = require('express');
  const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  let server; let base; let menu;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => { menu = jest.spyOn(Ch, 'menu').mockResolvedValue({ form: 'G3', lang: 'en', exercises: [] }); });
  afterEach(() => menu.mockRestore());
  const get = async () => (await fetch(`${base}/ch/tok.sig`, { headers: { 'x-api-key': 'test-key' } })).json();

  test('home on: card_fold', async () => {
    seed({ home: true });
    expect((await get()).card_fold).toBe(true);
  });
  test('home off, absent or the string "true": no key (the menu is today\'s)', async () => {
    for (const home of [undefined, false, 'true']) {
      HomeFlags._resetCache();
      seed({ home });
      expect(await get()).toEqual({ form: 'G3', lang: 'en', exercises: [] });
    }
  });
});

describe('the folded card\'s two event lines keep their fields (the after-quiz next thing, read against today\'s card)', () => {
  test('card_view {fold: 1} and next_pick {src: fold, kind}', () => {
    expect(WQ.cleanEvent({ n: 'card_view', band: 'mid', friend: 0, fold: 1 }).props).toEqual({ band: 'mid', friend: 0, fold: 1 });
    expect(WQ.cleanEvent({ n: 'next_pick', src: 'fold', kind: 'storybook' }).props).toEqual({ src: 'fold', kind: 'storybook' });
  });
  test('only those shapes: another event\'s kind, a fold that is not 1, a kind that is not a slug are dropped (today\'s lines)', () => {
    expect(WQ.cleanEvent({ n: 'card_share', src: 'card', kind: 'card_image' }).props).toEqual({ src: 'card' });
    expect(WQ.cleanEvent({ n: 'card_view', band: 'mid', fold: true }).props).toEqual({ band: 'mid' });
    expect(WQ.cleanEvent({ n: 'next_pick', src: 'fold', kind: 'Zara Testwala' }).props).toEqual({ src: 'fold' });
  });
  test('next_pick\'s kind is a LIST (the slot\'s own kinds), never a pattern: a name-shaped slug is dropped', () => {
    for (const kind of ['story', 'storybook', 'game', 'read', 'listen', 'video', 'quiz', 'trail']) {
      expect(WQ.cleanEvent({ n: 'next_pick', src: 'fold', kind }).props).toEqual({ src: 'fold', kind });
    }
    for (const kind of ['zara_testwala', 'invite', 'stories', 'x']) {
      expect(WQ.cleanEvent({ n: 'next_pick', src: 'fold', kind }).props).toEqual({ src: 'fold' });
    }
  });
});
