'use strict';
/**
 * The previous school day's class round, ONE row under the hub's Next tile (next.past_round): the child's class round
 * of the school day before today (PKT; Monday -> Friday, a weekend day -> Friday), named by its weekday ("Friday's
 * quiz" / «جمعہ کا کوئز»). Not finished: { done: false } and the round's code with the child's chip; finished:
 * { done: true, stars: {c, t} } from the hub's own history (its latest finished sitting, the hub's score rule). No
 * round that day, a round two school days back, another class's round, or the switch off: no field. A round played on
 * a later day says so on round_started (late: true).
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

const fs = require('fs');
const path = require('path');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const T = require('../../shared/services/quiz/web-quiz-token');
const Hub = require('../../shared/services/quiz/web-quiz-hub');
const NO = require('../../shared/services/quiz/web-quiz-next-offer');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');
const { logEvent } = require('../../shared/utils/structured-logger');

const KID = '44444444-4444-4444-8444-0000000000f1';
const OTHER_KID = '44444444-4444-4444-8444-0000000000f2';
const TEACHER = '11111111-1111-4111-8111-0000000000f1';
const LIST = '55555555-5555-4555-8555-0000000000f1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000f1';
const CLASS_B = 'c1a55000-0000-4000-8000-0000000000f2';
const TONIGHT_Q = '22222222-2222-4222-8222-0000000000f9';
const PAST_Q = '22222222-2222-4222-8222-0000000000f8';
const OLDER_Q = '22222222-2222-4222-8222-0000000000f7';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: true });
const BASE = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home'), ON('web_quiz_next_offer'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];
const ROUND_ON = [...BASE, ON('web_quiz_evening_round')];

// PKT calendar arithmetic of this test's own (never the module's): today, and school days stepped back from it.
const DAY_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date(Date.now() + 5 * 3600000));
const dow = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
function schoolDayBefore(day) {
  let d = new Date(`${day}T00:00:00Z`).getTime();
  do { d -= DAY_MS; } while ([0, 6].includes(new Date(d).getUTCDay()));
  return iso(new Date(d));
}
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UR_DAYS = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
const DECK = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/config/copy.v2.json'), 'utf8'));

const roundQuiz = (id, classId, day, code, sc) => ({
  id, topic: 'Reading', subject: 'english', language: 'en', grade: '3', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready', video_id: null,
  meta: { source: 'evening_round', class_id: classId, round_day: day, class_link_code: 'K7Q2MXTRAB', round_code: code, share_code_id: sc, round_ready_at: ago(30), n_items: 7, n_recall: 2 },
});
const roundCode = (id, code, quizId, classId = CLASS) => ({
  id, code, quiz_id: quizId, class_id: classId, active: true, expires_at: ahead(240), topic: 'Reading', language: 'en', teacher_user_id: TEACHER,
  parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30),
});

let db;
function seed(settings = ROUND_ON, { past = true, tonight = false, extra = {} } = {}) {
  const prev = schoolDayBefore(today());
  db = {
    app_settings: settings,
    students: [
      { id: KID, student_name: 'Zara Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE1', created_at: ago(500) },
      { id: OTHER_KID, student_name: 'Ali Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE2', created_at: ago(500) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }, { id: CLASS_B, grade_code: 'grade_5', section: 'A', is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: KID, is_active: true }, { class_id: CLASS_B, student_id: OTHER_KID, is_active: true }],
    quizzes: [
      { id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null },
      ...(past ? [roundQuiz(PAST_Q, CLASS, prev, 'RND233', 'sc-p')] : []),
      ...(tonight ? [roundQuiz(TONIGHT_Q, CLASS, today(), 'RND234', 'sc-t')] : []),
    ],
    quiz_share_codes: [
      { id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) },
      ...(past ? [roundCode('sc-p', 'RND233', PAST_Q)] : []),
      ...(tonight ? [roundCode('sc-t', 'RND234', TONIGHT_Q)] : []),
    ],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3', device_ref: A.device }],
    ...extra,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-play')._resetCache();
  NO._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-home')._resetCache();
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  return prev;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  jest.spyOn(NO, 'armOf').mockReturnValue('rank');
});
afterEach(() => jest.restoreAllMocks());

const pickToken = (kid = KID) => T.sign({ k: 'h', ids: [kid], exp: Math.floor(Date.now() / 1000) + 3600, src: 'cl', cl: { c: CLASS, s: 'roster_pick', q: 'high', h: false } });
const wordsFor = (day) => ({
  title: DECK['qfix_class_link.past_title'].en.replace('{day}', EN_DAYS[dow(day)]),
  title_ur: DECK['qfix_class_link.past_title'].ur.replace('{day}', UR_DAYS[dow(day)]),
});

describe('the deck and the catalog say the same words', () => {
  test('qfix_class_link.past_title: EN "{day}\'s quiz", UR «{day} کا کوئز», lifted byte for byte; the weekday names are whole words', () => {
    const d = DECK['qfix_class_link.past_title'];
    expect([d.en, d.ur, d.surface, d.switch]).toEqual(["{day}'s quiz", '{day} کا کوئز', 'page.hub.next', 'web_quiz_evening_round']);
    const { UX_STRINGS } = require('../../shared/config/ux-strings');
    expect(UX_STRINGS.qfix_class_link_past_title).toEqual({ en: d.en, ur: d.ur });
    expect(UX_STRINGS.qfix_class_link_weekdays_long).toEqual({ en: EN_DAYS.join('|'), ur: UR_DAYS.join('|') });
  });
});

describe('next.past_round on the hub', () => {
  test('an unfinished round of the previous school day: ONE row, named by its weekday, that plays the round with the child\'s chip', async () => {
    const prev = seed();
    const out = await Hub.hub(pickToken(), A);
    expect(out.next).toBeTruthy();
    expect(out.next.past_round).toEqual({ code: 'RND233', href: `/q/RND233?k=${T.chipId('sc-p', KID)}`, ...wordsFor(prev), done: false });
    // never a candidate: the Next tile itself is not the past round
    expect(out.next.href).not.toContain('RND233');
    expect(JSON.stringify(out.next.alts || [])).not.toContain('RND233');
  });

  test('a finished one: done, with the child\'s stars from their latest finished sitting (the hub\'s score rule)', async () => {
    seed();
    db.quiz_sessions.push(
      { id: 's-p1', share_code_id: 'sc-p', quiz_id: PAST_Q, student_id: KID, status: 'completed', correct_answers: 3, total_questions_answered: 7, mastery_percentage: 43, completed_at: ago(26), created_at: ago(27), student_class: '3', device_ref: A.device },
      { id: 's-p2', share_code_id: 'sc-p', quiz_id: PAST_Q, student_id: KID, status: 'completed', correct_answers: 6, total_questions_answered: 7, mastery_percentage: 86, completed_at: ago(25), created_at: ago(25.5), student_class: '3', device_ref: A.device },
    );
    const out = await Hub.hub(pickToken(), A);
    expect(out.next.past_round).toMatchObject({ code: 'RND233', done: true, stars: { c: 6, t: 7 } });
  });

  test('tonight\'s round and the previous school day\'s: the tile is tonight\'s, the row the earlier day\'s', async () => {
    seed(ROUND_ON, { tonight: true });
    const out = await Hub.hub(pickToken(), A);
    expect(out.next).toMatchObject({ variant: 'evening_round', href: `/q/RND234?k=${T.chipId('sc-t', KID)}` });
    expect(out.next.past_round).toMatchObject({ code: 'RND233', done: false });
  });

  test('no round on the previous school day (only one two school days back): no row, never a week of rows', async () => {
    const prev = seed(ROUND_ON, { past: false });
    const older = schoolDayBefore(prev);
    db.quizzes.push(roundQuiz(OLDER_Q, CLASS, older, 'RND232', 'sc-o'));
    db.quiz_share_codes.push(roundCode('sc-o', 'RND232', OLDER_Q));
    const out = await Hub.hub(pickToken(), A);
    expect(out.next).toBeTruthy();
    expect(out.next.past_round).toBeUndefined();
  });

  test('another class\'s round: not this child\'s row', async () => {
    seed();
    const out = await Hub.hub(T.signHub([OTHER_KID]), A);
    expect((out.next || {}).past_round).toBeUndefined();
  });

  test('the switch off: no row and no round read', async () => {
    seed(BASE);
    const spy = jest.spyOn(Round, 'roundOffers');
    const out = await Hub.hub(pickToken(), A);
    expect(out.next).toBeTruthy();
    expect(out.next.past_round).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the previous school day', () => {
  test('Monday -> Friday, Tuesday -> Monday, a weekend day -> Friday (PKT dates)', () => {
    expect(Round.previousSchoolDay('2026-11-23')).toBe('2026-11-20');
    expect(Round.previousSchoolDay('2026-11-24')).toBe('2026-11-23');
    expect(Round.previousSchoolDay('2026-11-21')).toBe('2026-11-20');
    expect(Round.previousSchoolDay('2026-11-22')).toBe('2026-11-20');
  });

  test('a Monday evening: Friday\'s round is the row (not Thursday\'s), "Friday\'s quiz" / «جمعہ کا کوئز»', async () => {
    seed(ROUND_ON, { past: false });
    db.quizzes.push(roundQuiz(PAST_Q, CLASS, '2026-11-20', 'RND220', 'sc-f'), roundQuiz(OLDER_Q, CLASS, '2026-11-19', 'RND219', 'sc-th'));
    db.quiz_share_codes.push(roundCode('sc-f', 'RND220', PAST_Q), roundCode('sc-th', 'RND219', OLDER_Q));
    const monday1600 = new Date('2026-11-23T11:00:00Z');
    const got = await Round.roundOffers({ token: pickToken(), chosenId: KID, history: [], lang: 'en', now: monday1600 });
    expect(got.past).toEqual({ code: 'RND220', href: `/q/RND220?k=${T.chipId('sc-f', KID)}`, title: "Friday's quiz", title_ur: 'جمعہ کا کوئز', done: false });
    expect(got.tonight).toBeNull();
  });
});

describe('round_started.late: the round\'s day is not today (PKT)', () => {
  const REF = { cl: 'K7Q2MXTRAB', rc: 'RND233' };
  const rows = (day) => [1, 2, 3, 4, 5].map((n) => ({ id: `L${n}`, sort_order: n, external_id: `tq:q:S1:${n}`, media: { round: 'lesson', round_key: `${CLASS}|${day}`, round_ref: REF } }));

  test('a round of an earlier day: late true; today\'s round: late false; round_done carries no late', () => {
    expect(Round.noteRound('started', rows(schoolDayBefore(today())))).toBe(true);
    expect(logEvent).toHaveBeenLastCalledWith('web_quiz.round_started', { class_link_code: REF.cl, round_code: REF.rc, n_items: 5, n_recall: 0, late: true });
    expect(Round.noteRound('started', rows(today()))).toBe(true);
    expect(logEvent).toHaveBeenLastCalledWith('web_quiz.round_started', { class_link_code: REF.cl, round_code: REF.rc, n_items: 5, n_recall: 0, late: false });
    expect(Round.noteRound('done', rows(schoolDayBefore(today())))).toBe(true);
    expect(logEvent).toHaveBeenLastCalledWith('web_quiz.round_done', { class_link_code: REF.cl, round_code: REF.rc, n_items: 5, n_recall: 0 });
  });
});
