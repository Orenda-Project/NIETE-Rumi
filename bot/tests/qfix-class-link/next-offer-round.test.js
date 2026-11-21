'use strict';
/**
 * "Tonight's round" on the hub: a child of a class with a ready round today (arriving from the class link: the hub token
 * carries the pick's class) gets the round as next.primary — kind quiz, variant evening_round, pinned, 5 minutes,
 * an href to the round's code with the child's chip — ahead of a teacher's pending quiz. round_shown is logged. A child
 * who finished it, another class's child, or the switch off: no round tile (the existing goldens hold the off bytes).
 * Supabase and Redis faked; the hub, the next-offer slot and the round module run for real.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null)),
    set: jest.fn(async (k, v) => { store.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; }),
    delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const T = require('../../shared/services/quiz/web-quiz-token');
const Hub = require('../../shared/services/quiz/web-quiz-hub');
const NO = require('../../shared/services/quiz/web-quiz-next-offer');
const { logEvent } = require('../../shared/utils/structured-logger');

const KID = '44444444-4444-4444-8444-0000000000e1';
const OTHER_KID = '44444444-4444-4444-8444-0000000000e2';
const TEACHER = '11111111-1111-4111-8111-0000000000e1';
const LIST = '55555555-5555-4555-8555-0000000000e1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const ROUND_Q = '22222222-2222-4222-8222-0000000000e9';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: true });
const BASE = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home'), ON('web_quiz_next_offer'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];
const ROUND_ON = [...BASE, ON('web_quiz_evening_round')];
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

let db;
function seed(settings = ROUND_ON, over = {}) {
  db = {
    app_settings: settings,
    students: [
      { id: KID, student_name: 'Zara Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE1', created_at: ago(500) },
      { id: OTHER_KID, student_name: 'Ali Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE2', created_at: ago(500) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: KID, is_active: true }],
    quizzes: [
      { id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null },
      { id: '22222222-2222-4222-8222-000000000002', topic: 'Plants quiz', subject: 'Science', language: 'en', grade: '3', video_id: null },
      { id: ROUND_Q, topic: 'Reading', subject: 'english', language: 'en', grade: '3', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready', video_id: null,
        meta: { source: 'evening_round', class_id: CLASS, round_day: today(), class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', share_code_id: 'sc-r', round_ready_at: ago(2), n_items: 7, n_recall: 2 } },
    ],
    quiz_share_codes: [
      { id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) },
      { id: 'sc-2', code: 'SCI002', quiz_id: '22222222-2222-4222-8222-000000000002', active: true, expires_at: ahead(240), topic: 'Plants quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(1) },
    ],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3', device_ref: A.device }],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-play')._resetCache();
  NO._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-home')._resetCache();
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache(); } catch (_) { /* not on this build */ }
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  jest.spyOn(NO, 'armOf').mockReturnValue('rank');
});
afterEach(() => jest.restoreAllMocks());

// The class-link pick's hub token: the child and the pick (cl.c = the class).
const pickToken = (kid = KID) => T.sign({ k: 'h', ids: [kid], exp: Math.floor(Date.now() / 1000) + 3600, src: 'cl', cl: { c: CLASS, s: 'roster_pick', q: 'high', h: false } });

test('a class child arriving from the class link with a round today: next.primary is Tonight\'s round, ahead of the teacher\'s pending quiz', async () => {
  seed();
  const out = await Hub.hub(pickToken(), A);
  expect(out.next).toMatchObject({ kind: 'quiz', variant: 'evening_round', rank_src: 'pinned', title: "Tonight's quiz", title_ur: 'آج شام کا کوئز', minutes: 5 });
  const k = T.chipId('sc-r', KID);
  expect(out.next.href).toBe(`/q/RND234?k=${k}`);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_shown', { class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', n_items: 7, n_recall: 2 });
});

test('two children of two classes on one phone, both through class A\'s link: each child gets THEIR class\'s round', async () => {
  const CLASS_B = 'c1a55000-0000-4000-8000-0000000000e2';
  const ROUND_B = '22222222-2222-4222-8222-0000000000ea';
  seed(ROUND_ON, {
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }, { id: CLASS_B, grade_code: 'grade_5', section: 'A', is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: KID, is_active: true }, { class_id: CLASS_B, student_id: OTHER_KID, is_active: true }],
  });
  db.quizzes.push({ id: ROUND_B, topic: 'Fractions', subject: 'maths', language: 'en', grade: '5', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready', video_id: null,
    meta: { source: 'evening_round', class_id: CLASS_B, round_day: today(), class_link_code: 'P3W8TTZZAB', round_code: 'RNDB56', share_code_id: 'sc-rb', round_ready_at: ago(2), n_items: 7, n_recall: 2 } });
  const a = await Hub.hub(pickToken(KID), A);
  expect(a.next).toMatchObject({ variant: 'evening_round', href: `/q/RND234?k=${T.chipId('sc-r', KID)}` });
  // the second child picked on class A's link (the pick's class is A), enrolled in class B
  const b = await Hub.hub(pickToken(OTHER_KID), A);
  expect(b.next).toMatchObject({ variant: 'evening_round', href: `/q/RNDB56?k=${T.chipId('sc-rb', OTHER_KID)}` });
});

test('the hub opened any other way: the child\'s own enrollment finds the class\'s round', async () => {
  seed();
  const out = await Hub.hub(T.signHub([KID]), A);
  expect(out.next).toMatchObject({ variant: 'evening_round' });
});

test('a child who finished the round, a child of no class, the switch off: no round tile', async () => {
  seed(ROUND_ON, {
    quiz_share_codes: [...db.quiz_share_codes, { id: 'sc-r', code: 'RND234', quiz_id: ROUND_Q, active: true, expires_at: ahead(240), topic: 'Reading', language: 'en', teacher_user_id: TEACHER, class_id: CLASS, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(2) }],
  });
  db.quiz_sessions.push({ id: 's2', share_code_id: 'sc-r', quiz_id: ROUND_Q, student_id: KID, status: 'completed', correct_answers: 6, total_questions_answered: 7, mastery_percentage: 86, completed_at: ago(0.5), created_at: ago(1), student_class: '3', device_ref: A.device });
  const done = await Hub.hub(T.signHub([KID]), A);
  expect(done.next && done.next.variant).not.toBe('evening_round');

  seed();
  redis._store.clear();
  const other = await Hub.hub(T.signHub([OTHER_KID]), A);
  expect(other.next && other.next.variant).not.toBe('evening_round');

  seed(BASE);
  redis._store.clear();
  const off = await Hub.hub(pickToken(), A);
  expect(off.next && off.next.variant).not.toBe('evening_round');
  expect(logEvent).not.toHaveBeenCalledWith('web_quiz.round_shown', expect.anything());
});

test('rank(): an evening_round candidate is the primary in every arm, its rule named', () => {
  const round = { kind: 'quiz', variant: 'evening_round', id: 'r1', href: '/q/RND234?k=x', title: "Tonight's quiz", rule: 'evening_round', sent_at: new Date().toISOString() };
  const teacher = { kind: 'quiz', variant: 'new', id: 't1', href: '/q/T?k=y', title: 'From your teacher', rule: 'teacher_quiz', sent_at: new Date().toISOString() };
  for (const arm of ['rank', 'rand', 'ctrl']) {
    const r = NO.rank('home', [teacher, round], { arm, seed: 's', now: new Date().toISOString() });
    expect(r.next).toMatchObject({ id: 'r1', rank_src: 'pinned', source: 'pinned' });
    expect(r.meta.rule).toBe('evening_round');
  }
});
