'use strict';
/**
 * The Stories field costs the hub no serial step: with the v3 home on, a warm hub reads in the same number of waves
 * with web_quiz_stories off and on (a half-read book included). A wave = every database read that is in flight
 * together; the fake answers each wave after a short tick. Children and books are invented ("Testwala").
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
const Stories = require('../../../shared/services/quiz/web-quiz-stories');

const KID = '44444444-4444-4444-8444-000000000081';
const TEACHER = '11111111-1111-4111-8111-000000000081';
const LIST = '55555555-5555-4555-8555-000000000081';
const BOOK = '5b000081-0000-4000-8000-000000000000';
const NOW = Date.parse('2026-10-14T07:00:00Z');
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const TRUE = (k) => ({ key: k, value: true });
const HOME = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_child_quiz_home', 'web_quiz_library', 'web_quiz_home_v3'].map(TRUE);
const HUB = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_child_quiz_home', 'web_quiz_library'].map(TRUE); // today's hub, no v3 home
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };

let waves = 0;
let batch = null;
function seed(settings, halfRead) {
  const fake = makeFake({
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE8', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(1), created_at: ago(1), student_class: '3' }],
    story_books: [{ id: BOOK, title: 'Book Testwala', grade: 3, lang: 'en', status: 'ready', pages: 2, cover_file: 'cover-aaaa0081.webp' }],
    story_events: halfRead ? [{ child_id: KID, book_id: BOOK, page_n: 1, event: 'story_page_read', data: {}, at: ago(2) }] : [],
  });
  // every read waits for its wave: reads started before the tick share it
  const wave = (q) => {
    const then = q.then.bind(q);
    q.then = (res, rej) => new Promise((go) => {
      if (!batch) { batch = []; setTimeout(() => { const b = batch; batch = null; waves += 1; b.forEach((f) => f()); }, 2); }
      batch.push(go);
    }).then(() => then(res, rej));
    return q;
  };
  Object.assign(supabase, { from: (t) => wave(fake.from(t)), rpc: fake.rpc });
  Hub._resetCache(); Play._resetCache(); Home._resetCache(); Stories._reset();
}
async function warmWaves(settings, halfRead) {
  seed(settings, halfRead);
  await Hub.hub(T.signHub([KID]), A);
  waves = 0;
  const out = await Hub.hub(T.signHub([KID]), A);
  return { waves, out };
}

beforeEach(() => { process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-stories-waves-secret'; });

test.each([['the v3 home', HOME], ['today\'s hub', HUB]])('Stories on adds no serial wave to a warm hub (%s), a half-read book included', async (_, base) => {
  const off = await warmWaves(base, true);
  const on = await warmWaves([...base, TRUE('web_quiz_stories')], false);
  const half = await warmWaves([...base, TRUE('web_quiz_stories')], true);
  expect(off.out).not.toHaveProperty('stories');
  expect(on.out.stories).toEqual({ on: 1 });
  expect(half.out.stories.resume).toEqual(expect.objectContaining({ book_id: BOOK, page_n: 2 }));
  expect(on.waves).toBe(off.waves);
  expect(half.waves).toBe(off.waves);
});
