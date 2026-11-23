'use strict';
/**
 * A child who finished tonight's evening round and opens the round's own link again gets "Done for tonight!" and the
 * landing, never a second sitting and never the old-finished-link short-cut to their hub; the hub never offers a round
 * as "Play again".
 *   (a) web-quiz-link-home: a round's code never names link_home on the quiz payload and never answers a home; a
 *       teacher's own finished code keeps today's way home.
 *   (b) the start: a child with a finished sitting on the round answers round_done_for_tonight with the round's two
 *       codes and opens no sitting (a round with recall items too); a teacher's finished code still opens a practice
 *       sitting; with web_quiz_evening_round off a round plays as an ordinary quiz, as today.
 *   (c) the hub: a finished round is never Play again (the last-quiz card, the Play again list, the next thing); a
 *       teacher's finished quiz still is.
 * Supabase and Redis are faked at the boundary; the quiz service, the link-home module, the round module and the hub
 * run for real.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null)),
    set: jest.fn(async (k, v) => { store.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../shared/services/quiz/web-quiz-publish.service'),
  isCurrent: () => true,
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const T = require('../../shared/services/quiz/web-quiz-token');
const WQ = require('../../shared/services/quiz/web-quiz.service');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Fast = require('../../shared/services/quiz/web-quiz-fast');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');
const Seen = require('../../shared/services/quiz/web-quiz-evening-round-seen');
const LinkHome = require('../../shared/services/quiz/web-quiz-link-home');
const Hub = require('../../shared/services/quiz/web-quiz-hub');
const NO = require('../../shared/services/quiz/web-quiz-next-offer');

const TEACHER = '11111111-1111-4111-8111-1111111111f1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000f1';
const LIST = '55555555-5555-4555-8555-0000000000f1';
const QUIZ = '22222222-2222-4222-8222-2222222222f1';
const SC = '33333333-3333-4333-8333-3333333333f1';
const ROUND_Q = '22222222-2222-4222-8222-2222222222f2';
const SC_R = '33333333-3333-4333-8333-3333333333f2';
const KID = 'c0000001-0000-4000-8000-0000000000f1';
const SIB = 'c0000001-0000-4000-8000-0000000000f2';
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const REF = { cl: 'K7Q2MXTRAB', rc: 'RND234' };
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const KEY = () => `${CLASS}|${today()}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ON = (k) => ({ key: k, value: true });

const opts = { option_a: 'One', option_b: 'Two', option_c: 'Three', option_d: 'Four', correct_option: 'B', explanation: null, option_feedback: {}, render_pattern: 'P1' };
const lesson = (n) => ({ ...opts, id: `4e550000-0000-4000-8000-0000000000f${n}`, quiz_id: ROUND_Q, external_id: `tq:${ROUND_Q}:S1:${n}`, sort_order: n,
  question_text: `Lesson question ${n}?`, media: { round: 'lesson', round_key: KEY(), round_ref: REF } });
const recall = (n) => ({ ...opts, id: `4ec00000-0000-4000-8000-0000000000f${n}`, quiz_id: ROUND_Q, external_id: `tq:rc${n}:recall:0a0b0c0${n}`, sort_order: 100 + n,
  question_text: `Recall question ${n}?`, correct_option: 'A',
  media: { round: 'recall', round_key: KEY(), round_ref: REF, recall: { of: `0f000000-0000-4000-8000-00000000000${n}`, rank: n, kids: [], chips: [] } } });
const plain = (n) => ({ ...opts, id: `91a10000-0000-4000-8000-0000000000f${n}`, quiz_id: QUIZ, external_id: `tq:${QUIZ}:S1:${n}`, sort_order: n,
  question_text: `Plain question ${n}?`, media: {} });

const sitting = (over) => ({ student_name: 'Zara Test', user_id: null, invited_by_student_id: null, device_ref: D1, student_class: '3',
  correct_answers: 4, total_questions_answered: 5, mastery_percentage: 80, ...over });
// Zara finished the teacher's quiz yesterday and tonight's round an hour ago, both on this phone.
const PLAIN_DONE = sitting({ id: '5e550000-0000-4000-8000-0000000000f1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', created_at: ago(30), completed_at: ago(30) });
const ROUND_DONE = sitting({ id: '5e550000-0000-4000-8000-0000000000f2', quiz_id: ROUND_Q, share_code_id: SC_R, student_id: KID, status: 'completed', created_at: ago(1.2), completed_at: ago(1) });

let db;
function world({ settings = [], sessions = [PLAIN_DONE, ROUND_DONE], recallItems = true } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, ON('web_quiz_enabled'), ON('web_quiz_hub'), ON('web_quiz_link_home'), ...settings],
    quizzes: [
      { id: QUIZ, teacher_id: TEACHER, topic: 'Fractions', grade: '3', subject: 'maths', language: 'en', quiz_source: 'transcript', status: 'sent', video_id: null, meta: {} },
      { id: ROUND_Q, teacher_id: TEACHER, topic: 'Reading tonight', grade: '3', subject: 'english', language: 'en', quiz_source: 'lp_v8', status: 'ready', video_id: null,
        meta: { source: 'evening_round', class_id: CLASS, round_day: today(), class_link_code: REF.cl, round_code: REF.rc, share_code_id: SC_R, round_ready_at: ago(3), n_items: recallItems ? 7 : 5, n_recall: recallItems ? 2 : 0 } },
    ],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Fractions', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: null, created_at: ago(48) },
      { id: SC_R, code: 'RND234', quiz_id: ROUND_Q, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Reading tonight', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: CLASS, created_at: ago(3) },
    ],
    quiz_questions: [...[1, 2, 3, 4, 5].map(lesson), ...(recallItems ? [recall(1), recall(2)] : []), ...[1, 2, 3].map(plain)],
    students: [
      { id: KID, student_name: 'Zara Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, created_at: ago(500) },
      { id: SIB, student_name: 'Ali Test', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, created_at: ago(500) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'A', is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: KID, is_active: true }, { class_id: CLASS, student_id: SIB, is_active: true }],
    quiz_sessions: sessions.map((s) => ({ ...s })),
    quiz_answers: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

function resetAll() {
  HubFlags._resetCache();
  Fast._reset();
  Round._resetCache();
  Seen._reset();
  LinkHome._resetCache();
  Hub._resetCache();
  NO._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-play')._resetCache();
  require('../../shared/services/quiz/web-quiz-hub-home')._resetCache();
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'round-reopen-test-secret', PORTAL_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis._store.clear();
  resetAll();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = SAVED; });

const resolve = (c) => WQ.resolveCode(c);
const roundSittings = () => db.quiz_sessions.filter((s) => s.share_code_id === SC_R);

describe('(a) the old-finished-link short-cut: never for a round\'s code', () => {
  test('home(): a round\'s code answers no home (reason round, nothing bound); the teacher\'s finished code keeps its way home', async () => {
    world();
    expect((await LinkHome.home({ code: 'RND234', device_ref: D1 }, resolve)).home).toBeNull();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.link_home', { ok: false, reason: 'round' });
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.door_shown', expect.anything());
    expect(redis.setNX).not.toHaveBeenCalled();
    const out = await LinkHome.home({ code: 'AB12CD', device_ref: D1 }, resolve);
    expect(out.home).toMatch(/^\/h\/[A-Za-z0-9._-]+\?from=link$/);
    expect(T.verify(out.home.slice(3, out.home.indexOf('?')), 'h').ids).toEqual([KID]);
  });

  test('getQuiz(): link_home is never named on a round\'s payload; the teacher\'s code names it as today', async () => {
    world();
    expect((await WQ.getQuiz('RND234')).link_home).toBeUndefined();
    expect((await WQ.getQuiz('AB12CD')).link_home).toBe(true);
  });

  test('field(): a round\'s code is false even with the switch on; the teacher\'s code is true', async () => {
    world();
    expect(await LinkHome.field(await resolve('RND234'))).toBe(false);
    expect(await LinkHome.field(await resolve('AB12CD'))).toBe(true);
  });
});

describe.each([
  ['web_quiz_fast off', []],
  ['web_quiz_fast on', [ON('web_quiz_fast')]],
])('(b) the start, %s', (_label, fast) => {
  const prime = async () => { await Fast.storyBoard(); };

  test('a child who finished tonight\'s round (5 + 2, recall items in it): round_done_for_tonight with its codes, no new sitting', async () => {
    world({ settings: [ON('web_quiz_evening_round'), ...fast] });
    await prime();
    const a = await WQ.startSession({ code: 'RND234', chip: T.chipId(SC_R, KID), device_ref: D1 });
    expect(a).toEqual({ round_done_for_tonight: true, class_link_code: REF.cl, round_code: REF.rc });
    expect(roundSittings()).toHaveLength(1);
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.session_started', expect.anything());
  });

  test('a round with no recall item: the same answer for the finished child', async () => {
    world({ settings: [ON('web_quiz_evening_round'), ...fast], recallItems: false });
    await prime();
    const a = await WQ.startSession({ code: 'RND234', chip: T.chipId(SC_R, KID), device_ref: D1 });
    expect(a).toEqual({ round_done_for_tonight: true, class_link_code: REF.cl, round_code: REF.rc });
    expect(roundSittings()).toHaveLength(1);
  });

  test('a child whose round sitting is not finished still starts (no earlier finish)', async () => {
    world({ settings: [ON('web_quiz_evening_round'), ...fast], sessions: [PLAIN_DONE, { ...ROUND_DONE, status: 'abandoned', completed_at: null }] });
    await prime();
    const a = await WQ.startSession({ code: 'RND234', chip: T.chipId(SC_R, KID), device_ref: D1 });
    expect(typeof a.st).toBe('string');
    expect(a.round_done_for_tonight).toBeUndefined();
    expect(roundSittings()).toHaveLength(2);
  });

  test('the teacher\'s finished quiz opens a practice sitting, as today', async () => {
    world({ settings: [ON('web_quiz_evening_round'), ...fast] });
    await prime();
    const a = await WQ.startSession({ code: 'AB12CD', chip: T.chipId(SC, KID), device_ref: D1 });
    expect(typeof a.st).toBe('string');
    expect(a).toMatchObject({ counted: false, reason: 'already_finished' });
    expect(a.round_done_for_tonight).toBeUndefined();
  });

  test('web_quiz_evening_round off: the round plays as an ordinary quiz, a finished child included (today\'s start)', async () => {
    world({ settings: [...fast] });
    await prime();
    const a = await WQ.startSession({ code: 'RND234', chip: T.chipId(SC_R, KID), device_ref: D1 });
    expect(typeof a.st).toBe('string');
    expect(a.round_done_for_tonight).toBeUndefined();
  });
});

// The class link's pick (from=class_link): the hub token carries the child and the pick's class.
const pickToken = (kid = KID) => T.sign({ k: 'h', ids: [kid], exp: Math.floor(Date.now() / 1000) + 3600, src: 'cl', cl: { c: CLASS, s: 'roster_pick', q: 'high', h: false } });
const HUB = [ON('web_quiz_child_quiz_home'), ON('web_quiz_next_offer'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
// production's hub: the parts side by side, the child's history read with its codes and quizzes embedded, the early kid
const TOGETHER = ['web_quiz_hub_fanout', 'web_quiz_hub_waves2', 'web_quiz_hub_waves3', 'web_quiz_hub_embed', 'web_quiz_hub_early_kid', 'web_quiz_hub_child_memo'].map(ON);
const replayOfRound = (out) => JSON.stringify(out).includes('/q/RND234?again=1');
const replayOf = (out, code) => JSON.stringify(out).includes(`/q/${code}?again=1`);

describe.each([
  ['the hub reading one part after another', []],
  ['the hub with its parts side by side (production\'s fanout + embedded reads)', TOGETHER],
])('(c) %s: a finished round is never Play again', (_label, parts) => {
  beforeEach(() => { jest.spyOn(NO, 'armOf').mockReturnValue('rank'); });
  const hubAs = async (tokenOf, src) => { await HubFlags.flags(); return Hub.hub(tokenOf(), { device: D1, src }); };

  describe.each([
    ['from=link (the old finished link\'s way home)', () => T.signHub([KID]), 'link'],
    ['from=class_link (the class link\'s pick)', () => pickToken(), 'class_link'],
  ])('arriving %s', (_a, tokenOf, src) => {
    test('tonight\'s round finished last: the last-quiz card shows it with no Play again; no Next stop, door or list replays it', async () => {
      world({ settings: [...HUB, ...parts] });
      const out = await hubAs(tokenOf, src);
      expect(replayOfRound(out)).toBe(false);
      expect(out.last).toMatchObject({ code: 'RND234', state: 'done', again: false });
      expect((out.again || []).map((a) => a.code)).not.toContain('RND234');
      expect(replayOf(out, 'AB12CD')).toBe(true);   // the teacher's finished quiz is still offered again, as today
    });

    test('the teacher\'s quiz finished after the round: it is the last card with Play again (as today); the round is never replayed', async () => {
      const plainLater = { ...PLAIN_DONE, created_at: ago(0.5), completed_at: ago(0.4) };
      const roundEarlier = { ...ROUND_DONE, created_at: ago(2), completed_at: ago(1.9) };
      world({ settings: [...HUB, ...parts], sessions: [roundEarlier, plainLater] });
      const out = await hubAs(tokenOf, src);
      expect(out.last).toMatchObject({ code: 'AB12CD', state: 'done', again: true });
      expect((out.again || []).map((a) => a.code)).not.toContain('RND234');
      expect(replayOfRound(out)).toBe(false);
    });
  });

  test('with the home off, Play again lists the teacher\'s finished quiz and never the round', async () => {
    world({ settings: [ON('web_quiz_class_link'), ON('web_quiz_evening_round'), ...parts] });
    const out = await hubAs(() => T.signHub([KID]), 'link');
    expect(out.again.map((a) => a.code)).toEqual(['AB12CD']);
  });
});

describe('(d) the finish card\'s next stop never offers the round just finished as Play again', () => {
  const Result = require('../../shared/services/quiz/web-quiz-next-offer-result');
  const finished = () => ({ score: { correct: 4, total: 5, pct: 80, level: 'high' }, card: { first: 'Zara' } });
  beforeEach(() => { jest.spyOn(NO, 'armOf').mockReturnValue('rank'); });
  const offers = (r) => (r.next_offer ? [r.next_offer, ...(r.next_offer.alts || [])] : []);

  test('a finished round: no again candidate for it; the teacher\'s finished quiz still gets one (as today)', async () => {
    world({ settings: HUB });
    const round = await Result.finishField({ st: T.signSession({ sessionId: ROUND_DONE.id, deviceRef: D1, shareCodeId: SC_R }) }, finished(), { device: D1 });
    expect(offers(round).length).toBeGreaterThan(0);
    expect(offers(round).some((o) => /\/q\/RND234\?again=1/.test(o.href || ''))).toBe(false);
    resetAll(); world({ settings: HUB });
    const plainFinish = await Result.finishField({ st: T.signSession({ sessionId: PLAIN_DONE.id, deviceRef: D1, shareCodeId: SC }) }, finished(), { device: D1 });
    expect(offers(plainFinish).some((o) => /\/q\/AB12CD\?again=1/.test(o.href || ''))).toBe(true);
  });
});
