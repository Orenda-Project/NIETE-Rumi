'use strict';
/**
 * The Jugnu card on the scorecard (web-quiz-card.js): finish() tells the card it may offer Jugnu's challenge
 * (jugnu_card) for a class child's own finished run in grades 2-5, with app_settings web_quiz_challenge_card on
 * (and its parents web_quiz_challenge and web_quiz_hub); POST /hubdoor {st, jugnu:1} mints the challenge link for
 * THIS session's child, bound to the phone that played. Supabase and Redis are the boundaries and are faked; the
 * token signer, the hub's device binding, the challenge's grade rule and finish() run for real.
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
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), logError: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');

const cardModule = () => require('../../../shared/services/quiz/web-quiz-card');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const FRIEND = '44444444-4444-4444-8444-555555555555';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const D2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ALL_ON = { web_quiz_hub: true, web_quiz_challenge: true, web_quiz_challenge_card: true, web_quiz_events_v2: true };

function seed({ on = ALL_ON, sess = {}, grade = '3' } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, ...Object.entries(on).map(([key, value]) => ({ key, value }))],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', user_id: null,
      invited_by_student_id: null, created_at: ago(0.1), completed_at: ago(0.05), device_ref: D1, ...sess }],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's1', question_id: Q(n), selected_option: 'A', is_correct: true })),
    class_enrollments: [],
    students: [{ id: KID, student_name: 'Zara Testwala', self_reported_class: grade }, { id: FRIEND, student_name: 'Omar Testwala', self_reported_class: '3' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const st = (over = {}) => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC, ...over });
const sess = (over = {}) => ({ id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, status: 'completed', share_code_id: SC, ...over });
const err = async (p) => { try { await p; } catch (e) { return { status: e.status, ...(e.body || {}) }; } return null; };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'card-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  Flags._resetCache();
  try { cardModule()._resetCache(); } catch (_) { /* not there yet on the base */ }
});
afterAll(() => { process.env = SAVED; });

describe('field(): the scorecard is told it may offer Jugnu\'s card', () => {
  test('an own grade-3 completed run, every switch on: jugnu_card (and the door events, events v2 on)', async () => {
    seed();
    expect(await cardModule().field(sess())).toEqual({ jugnu_card: true, jugnu_ev: true });
  });
  test('a loose child (no class enrolment, a self-reported grade 3) gets the card and its link: no roster gate', async () => {
    seed();
    expect(supabase.from('class_enrollments')).toBeDefined();
    expect(await cardModule().field(sess())).toEqual({ jugnu_card: true, jugnu_ev: true });
    expect((await cardModule().go({ st: st() }, WQ.WqError)).href).toMatch(/^\/c\//);
  });
  test('events v2 off: the card, no door events', async () => {
    seed({ on: { ...ALL_ON, web_quiz_events_v2: false } });
    expect(await cardModule().field(sess())).toEqual({ jugnu_card: true });
  });
  test('the card switch off, or a parent off: {}', async () => {
    for (const off of ['web_quiz_challenge_card', 'web_quiz_challenge', 'web_quiz_hub']) {
      cardModule()._resetCache(); seed({ on: { ...ALL_ON, [off]: false } });
      expect(await cardModule().field(sess())).toEqual({});
    }
  });
  test('grade 1, grade 6, a friend\'s run, a teacher\'s run: {}', async () => {
    seed({ grade: '1' });
    expect(await cardModule().field(sess())).toEqual({});
    cardModule()._resetCache(); seed({ grade: '6' });
    expect(await cardModule().field(sess())).toEqual({});
    cardModule()._resetCache(); seed();
    expect(await cardModule().field(sess({ invited_by_student_id: FRIEND }))).toEqual({});
    expect(await cardModule().field(sess({ user_id: TEACHER, student_id: null }))).toEqual({});
  });
  test('app_settings unreadable: fail closed', async () => {
    seed();
    supabase.from = () => { throw new Error('down'); };
    expect(await cardModule().field(sess())).toEqual({});
  });
  test('finish() carries it beside hub_door', async () => {
    seed();
    const out = await WQ.finishSession({ st: st() });
    expect(out.jugnu_card).toBe(true);
    expect(out.jugnu_ev).toBe(true);
  });
});

describe('POST /hubdoor {st, jugnu:1}: the Jugnu card\'s link', () => {
  test('a challenge link for this session\'s child, with the hub\'s chip and via=quiz_card, never a name; bound to the phone that played', async () => {
    seed();
    const out = await cardModule().go({ st: st(), jugnu: 1, device_ref: D2 }, WQ.WqError);
    const m = /^\/c\/([A-Za-z0-9._-]+)\?kid=([A-Za-z0-9_-]+)&via=quiz_card$/.exec(out.href);
    expect(m).not.toBeNull();
    expect(T.verify(m[1], 'h').ids).toEqual([KID]);
    expect(m[2]).toBe(T.chipId('h', KID));
    expect(out.href).not.toMatch(/Zara|Testwala/);
    expect(out.animal).toBe(T.animalFor(KID));
    const Device = require('../../../shared/services/quiz/web-quiz-hub-device');
    expect((await Device.deviceTrusted(m[1], D1)).ok).toBe(true);
    expect((await Device.deviceTrusted(m[1], D2)).ok).toBe(false);
  });
  test('the link carries the child\'s one folded id (identity roster); no fold: the same href as the raw id', async () => {
    const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
    const FOLDED = '44444444-4444-4444-8444-666666666666';
    seed();
    const raw = await cardModule().go({ st: st() }, WQ.WqError);
    expect(raw.href).toBe(`/c/${T.signHub([KID])}?kid=${T.chipId('h', KID)}&via=quiz_card`);
    redis._store.clear(); cardModule()._resetCache(); seed();
    const spy = jest.spyOn(Roster, 'canonicalStudentId').mockResolvedValue(FOLDED);
    const out = await cardModule().go({ st: st() }, WQ.WqError);
    spy.mockRestore();
    const m = /^\/c\/([A-Za-z0-9._-]+)\?kid=([A-Za-z0-9_-]+)&via=quiz_card$/.exec(out.href);
    expect(T.verify(m[1], 'h').ids).toEqual([FOLDED]);
    expect(m[2]).toBe(T.chipId('h', FOLDED));
    expect(out.animal).toBe(T.animalFor(FOLDED));
  });
  test('refuses an in-progress run, a teacher\'s run, a friend\'s run, a foreign phone, the card switched off', async () => {
    const go = (body) => err(cardModule().go({ st: st(), ...body }, WQ.WqError));
    seed({ sess: { status: 'in_progress' } });
    expect(await go()).toMatchObject({ status: 404, error: 'no_door' });
    cardModule()._resetCache(); seed({ sess: { user_id: TEACHER, student_id: null } });
    expect(await go()).toMatchObject({ status: 404, error: 'no_door' });
    cardModule()._resetCache(); seed({ sess: { invited_by_student_id: FRIEND } });
    expect(await go()).toMatchObject({ status: 404, error: 'no_door' });
    cardModule()._resetCache(); seed({ on: { ...ALL_ON, web_quiz_challenge_card: false } });
    expect(await go()).toMatchObject({ status: 404, error: 'no_door' });
    expect(redis.setNX).not.toHaveBeenCalled();
    // A phone that never played this run: the challenge link is already some other phone's.
    cardModule()._resetCache(); seed({ sess: { device_ref: D2 } });
    redis.setNX.mockImplementationOnce(async (k) => { redis._store.set(k, D2); return false; });
    expect(await go()).toMatchObject({ status: 404, error: 'no_door' });
    expect(await err(cardModule().go({ st: 'nope' }, WQ.WqError))).toMatchObject({ status: 401, error: 'bad_token' });
  });
});

// A play opened from the card has no quiz session on its hub token: the challenge's serve reads the pick from the hub
// key, whose one builder is the identity pick module's hubPickKey(canonical id, device). go() copies THIS quiz
// session's pick there for the same child and phone; no pick, or the module throwing, writes nothing and never throws.
describe('go() carries the quiz session\'s pick to the hub key', () => {
  const Bind = require('../../../shared/services/quiz/web-quiz-bind-page');
  const REC = { id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, canonical_id: KID };
  const picks = () => redis.set.mock.calls.filter(([k]) => String(k).startsWith('wq:idpick:'));
  afterEach(() => jest.restoreAllMocks());
  test('the session\'s pick is written under hubPickKey(canonical id, the session token\'s phone)', async () => {
    const pickFor = jest.spyOn(Bind, 'pickFor').mockImplementation(async (arg) => (arg === 's1' ? REC : null));
    const keyOf = jest.spyOn(Bind, 'hubPickKey');
    seed();
    await cardModule().go({ st: st(), device_ref: D2 }, WQ.WqError);
    expect(pickFor).toHaveBeenCalledWith('s1');
    expect(keyOf).toHaveBeenCalledWith(KID, D1);
    const key = keyOf.mock.results[0].value;
    expect(key).toMatch(/^wq:idpick:h:/);
    expect(redis._store.get(key)).toEqual(REC);
    expect(redis.set).toHaveBeenCalledWith(key, REC, 24 * 3600);
  });
  test('no pick for the session (switch off), or the module throws: nothing written, the link still opens', async () => {
    jest.spyOn(Bind, 'pickFor').mockImplementation(async () => null);
    seed();
    expect((await cardModule().go({ st: st() }, WQ.WqError)).href).toMatch(/^\/c\//);
    jest.spyOn(Bind, 'pickFor').mockImplementation(async () => { throw new Error('down'); });
    redis._store.clear(); cardModule()._resetCache(); seed();
    expect((await cardModule().go({ st: st() }, WQ.WqError)).href).toMatch(/^\/c\//);
    expect(picks()).toEqual([]);
  });
});

// The doors' props live in the relay's one name-scoped map (NAME_PROPS, web_quiz_events_v2): with v2 off the
// relay is today's; a page door is kept as w:'p' and the server-written doors are dropped (RULING #34).
describe('the allow-list carries the doors (door_shown / door_tap, NAME_PROPS)', () => {
  const v2 = { v2: true };
  test('NAME_PROPS is the one home for the door props', () => {
    expect(Object.keys(WQ.NAME_PROPS)).toEqual(expect.arrayContaining(['door_shown', 'door_tap']));
    expect(Object.keys(WQ.NAME_PROPS.door_shown).sort()).toEqual(['door', 'nx', 'pid', 'slot', 'surface']);
  });
  test('door, surface, a numeric slot, pid, nx are kept on the two door names with v2 on', () => {
    expect(WQ.cleanEvent({ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }, v2)).toEqual({ name: 'door_shown', props: { door: 'card', surface: 'scorecard', slot: 1, w: 'p' } });
    expect(WQ.cleanEvent({ n: 'door_tap', door: 'shelf', surface: 'hub', slot: 3, pid: 'p.1-a', nx: 'new' }, v2).props).toEqual({ door: 'shelf', surface: 'hub', slot: 3, pid: 'p.1-a', nx: 'new', w: 'p' });
    expect(WQ.cleanEvent({ n: 'door_tap', door: 'elsewhere', surface: 'moon', slot: 'x', nx: 'old' }, v2).props).toEqual({ w: 'p' });
  });
  test('RULING #34: a page door is kept; quiz_reply, class_link and link_home-shown are the server\'s and dropped', () => {
    expect(WQ.cleanEvent({ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }, v2).props.w).toBe('p');
    expect(WQ.cleanEvent({ n: 'door_tap', door: 'card', surface: 'scorecard' }, v2).props.door).toBe('card');
    expect(WQ.cleanEvent({ n: 'door_tap', door: 'link_home', surface: 'landing' }, v2).props.door).toBe('link_home');
    for (const door of ['quiz_reply', 'class_link']) {
      expect(WQ.cleanEvent({ n: 'door_shown', door }, v2)).toBeNull();
      expect(WQ.cleanEvent({ n: 'door_tap', door }, v2)).toBeNull();
    }
    expect(WQ.cleanEvent({ n: 'door_shown', door: 'link_home' }, v2)).toBeNull();
  });
  test('v2 off: the relay is today\'s (no door props); every other name keeps slot as the answer letter', () => {
    expect(WQ.cleanEvent({ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }).props).toEqual({});
    expect(WQ.cleanEvent({ n: 'answer', slot: 'B', door: 'card', surface: 'hub' }, v2).props).toEqual({ slot: 'B', w: 'p' });
    expect(WQ.cleanEvent({ n: 'answer', slot: 'B', door: 'card', surface: 'hub' }).props).toEqual({ slot: 'B' });
    expect(WQ.cleanEvent({ n: 'answer', slot: 2 }).props).toEqual({});
  });
});

// Golden (SPEC §5.1): with the card switch off the finish payload is the base's, byte for byte. The base payload was
// written from origin/sandbox (CARD_GOLDEN_WRITE=1) with the same seed; the random challenge code is masked.
describe('golden: the card switch off', () => {
  const FIX = path.join(__dirname, 'fixtures', 'card-finish-golden.json');
  // The challenge code is minted at random per finish: masked wherever it appears (the code and the invite picture's id).
  const mask = (o) => JSON.parse(JSON.stringify(o).split(o.challenge_code || '\u0000').join('<code>'), (k, v) => (k === 'invite' ? '<invite>' : v));
  test('finish() payload is deep-equal to the base\'s', async () => {
    seed({ on: { web_quiz_hub: true, web_quiz_challenge: true, web_quiz_challenge_card: false, web_quiz_events_v2: true, web_quiz_hub_door: true } });
    const out = mask(await WQ.finishSession({ st: st() }));
    if (process.env.CARD_GOLDEN_WRITE === '1') { fs.mkdirSync(path.dirname(FIX), { recursive: true }); fs.writeFileSync(FIX, JSON.stringify(out, null, 2)); }
    expect(out).toEqual(JSON.parse(fs.readFileSync(FIX, 'utf8')));
  });
});
