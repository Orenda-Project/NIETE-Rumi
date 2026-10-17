'use strict';
/**
 * The quiz finish's cost with the child home on (web_quiz_home_v3): its card_fold and no_class (a child no teacher's
 * quiz has reached shares with "Share") are read beside the scorecard's other lookups, never after them. Every read
 * takes READ_MS at the boundary (Supabase, faked) and is given a WAVE, 1 + the highest wave of the reads already
 * finished when it started; the page waits for the highest wave. With fast pages on, the finish waits for exactly as
 * many waves with the home on as off, warm and 31 s later (every 30 s cache stale), and off never longer than the base
 * did (the constants below, the base's own counts on this fixture), for a class child and a child with no class.
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
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

const READ_MS = 8;
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const future = new Date(NOW + 86400000 * 10).toISOString();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();

// The base's waves on this fixture (fast on, home absent; measured on the base before the fold), warm / stale.
const BASE = { class: { warm: 6, stale: 6 }, lesson: { warm: 6, stale: 6 } };

// lesson: the quiz's code is a library lesson's (under a teacher's), so no teacher sent this child a quiz
function tables({ home, lesson, storyBoard }) {
  return {
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_fast', value: true },
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : []),
      ...(storyBoard ? [{ key: 'web_quiz_story_board_refuse', value: true }] : [])],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: storyBoard ? 'story' : 'transcript', video_id: null }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: future, invited_by_student_id: null, parent_share_code_id: lesson ? 'sc-parent' : null, created_at: ago(30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'in_progress', user_id: null,
      invited_by_student_id: null, created_at: ago(0.1), device_ref: D1 }],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's1', question_id: Q(n), selected_option: 'A', is_correct: true })),
    students: [{ id: KID, student_name: 'Zara Testwala' }],
  };
}

let reads = [];
let doneMax = 0;
function seed(opts) {
  const fake = makeFake(tables(opts));
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); })
        .then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

let WQ;
let T;
// Each finish completes its session, so every request gets the fixture afresh; the modules (and their caches) stay.
async function measure(opts) {
  await settle();
  seed(opts);
  reads = [];
  doneMax = 0;
  const out = await WQ.finishSession({ st: T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC }) });
  const waves = doneMax;
  await settle();
  return { out, waves };
}
async function warmAndStale(opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(opts);
  WQ = require('../../../shared/services/quiz/web-quiz.service');
  T = require('../../../shared/services/quiz/web-quiz-token');
  await measure(opts);
  const warm = await measure(opts);
  jest.setSystemTime(NOW + 31 * 1000);
  const stale = await measure(opts);
  return { warm, stale };
}

const SAVED = { ...process.env };
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => {
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'finish-waves-secret' };
});

describe.each([['a class child', 'class', false], ['a child with no class', 'lesson', true]])('the quiz finish with the child home on: %s', (_name, key, lesson) => {
  test('home on: the same waves as home off, warm and stale (+0); off never above the base', async () => {
    const off = await warmAndStale({ lesson });
    const on = await warmAndStale({ lesson, home: true });
    console.log(`finish waves (${key}): home off ${off.warm.waves} warm / ${off.stale.waves} stale; home on ${on.warm.waves} / ${on.stale.waves}; base ${BASE[key].warm} / ${BASE[key].stale}`);
    expect(on.warm.out.card_fold).toBe(true);
    if (lesson) expect(on.warm.out.no_class).toBe(true);
    else expect(on.warm.out).not.toHaveProperty('no_class');
    expect(off.warm.out).not.toHaveProperty('card_fold');
    expect({ warm: on.warm.waves, stale: on.stale.waves }).toEqual({ warm: off.warm.waves, stale: off.stale.waves });
    expect(off.warm.waves).toBeLessThanOrEqual(BASE[key].warm);
    expect(off.stale.waves).toBeLessThanOrEqual(BASE[key].stale);
  });
});

// A storybook finish under web_quiz_story_board_refuse (no class picture): the switch and the quiz's source are read
// beside the finish's other early lookups, so the page waits no longer than the base, warm or stale.
test('a storybook finish with web_quiz_story_board_refuse on: no class picture, never above the base\'s waves', async () => {
  const on = await warmAndStale({ storyBoard: true });
  expect(on.warm.out.art.class).toBeNull();
  expect(on.warm.out.art.table).toBeNull();
  expect(on.warm.waves).toBeLessThanOrEqual(BASE.class.warm);
  expect(on.stale.waves).toBeLessThanOrEqual(BASE.class.stale);
});
