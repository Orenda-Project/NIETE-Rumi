'use strict';
/**
 * A round turn's end card and trail, the server side. A round run is not a voluntary counted stop (NC4, RULING #43):
 * its payload says round_turn so the page prints no sticker line and hands the phone back to the round page the
 * teacher opened (the same report token), and the turn's trail marks the games already stored for this turn done.
 * Nothing changes for a home or quiz run. The real Challenge service, tokens, item bank and round service run;
 * faked: Supabase (in-memory), the loggers, R2 and speech/LLM clients, Redis (a Map), the hashed-key module.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(), headObject: jest.fn(), downloadFromR2: jest.fn(), getPresignedUrl: jest.fn(),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`), uploadBuffer: jest.fn(), presignKey: jest.fn(async () => null),
  deleteAudio: jest.fn(), deleteKey: jest.fn(), listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn() }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${String(id).slice(-2)})`, cls: (id) => `cls(${String(id).slice(-2)})`, envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}));

const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./class-round-strict-fake');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const CLASS = 'c0000000-0000-4000-8000-0000000000c1';
const SCHOOL = 'd0000000-0000-4000-8000-0000000000d1';
const ROUND = '0123456789abcdef';
const SC = '33333333-3333-4333-8333-333333333333';
const SESSION = '66666666-6666-4666-8666-666666666666';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_round', value: true },
  { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true },
  { key: 'web_quiz_challenge_record', value: true }, { key: 'web_quiz_challenge_missing', value: true }, { key: 'web_quiz_challenge_trail', value: true },
];

let DB; let T; let Ch; let Round; let Token; let Page;
function seed(settings = ON) {
  DB = {
    app_settings: settings.map((s) => ({ ...s })),
    users: [{ id: TEACHER, preferred_language: 'en' }],
    schools: [{ id: SCHOOL, name: 'School A', region: 'Sector One', is_active: true, is_probable_test: false }],
    classes: [{ id: CLASS, school_id: SCHOOL, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_teachers: [{ id: 'ct1', class_id: CLASS, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    students: [1, 2, 3].map((n) => ({ id: kid(n), student_name: `Kid${n} Testwala`, is_active: true })),
    class_enrollments: [1, 2, 3].map((n) => ({ id: `e${n}`, class_id: CLASS, student_id: kid(n), roll_number: n, is_active: true })),
    class_round_draws: [{ id: 'e0000000-0000-4000-8000-0000000000e1', round: ROUND, term_code: '2026-27b', class_id: CLASS, stratum: 'Sector One|G23', roster_k: 3,
      window_start: new Date(Date.now() - 2 * 86400000).toISOString(), window_end: new Date(Date.now() + 26 * 86400000).toISOString(), k_counted: 10, declined_at: null, accepted_at: null,
      drawn_at: '2026-10-10T05:00:00Z', started_at: null, ran_at: null, finished_at: null, children_present: null, children_played: null, state: null }],
    child_identity: [],
    student_lists: [], quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: kid(1), share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake), rpc: fake.rpc });
}
beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  seed();
  T = require('../../../shared/services/quiz/web-quiz-token');
  Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  Round = require('../../../shared/services/quiz/web-quiz-class-round');
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Page = require('../../../shared/templates/class-round.page');
  Ch.__reset();
});

const draw = () => DB.class_round_draws[0];
const HOLD = { act: 'hold', hold: 700 };
// The teacher opens the round page with their report token, calls the next child, and the child's play link is the
// one the round page renders (as the phone gets it).
async function openTurn(lang = 'en') {
  const rt = Token.signTeacherReport({ teacherId: TEACHER });
  await Round.start(TEACHER, { rng: () => 0 });
  await Round.next(TEACHER, HOLD);
  const html = await Round.screen(TEACHER, { lang, token: rt });
  const m = html.match(/href="\/c\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22})/);
  const st = draw().state;
  return { rt, id: st.order[st.cur].id, token: m[1] };
}
async function playBigger(token) {
  const out = await Ch.exercise(token, 'bigger', { lang: 'en' });
  const taps = out.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2000 }));
  await Ch.submit({ ct: out.ct, taps, ms: 20000 }, { now: Date.now() + 30000 });
  return out;
}

describe('roundPayload: a round run says round_turn and where the phone goes back', () => {
  test.each(['en', 'ur'])('roundPayload carries round_turn:true, the hand-back line and the round page of the same report token (%s)', async (lang) => {
    const { rt, token } = await openTurn(lang);
    const out = await Ch.exercise(token, 'bigger', { lang });
    expect(out.round_turn).toBe(true);
    expect(out.round_handback).toBe(Page.T[lang].cHandback);
    expect(out.round_back).toBe(`/r/${encodeURIComponent(rt)}/round?lang=${lang}`);
    // nothing else about the round payload changes: still no practice banner, no mode, the same warm line
    expect(out).not.toHaveProperty('practice_round');
    expect(out).not.toHaveProperty('mode');
    expect(out.round_say).toBe(Page.T[lang].cNextSay);
  });

  test('the hand-back link opens the round page for that teacher: the hand-back card once the turn is done', async () => {
    const { token } = await openTurn();
    const out = await playBigger(token);
    await Round.childFinished(ROUND, draw().state.order[draw().state.cur].id, 'r0');
    const back = decodeURIComponent(out.round_back.split('/')[2]);
    const v = Token.verifyTeacherReport(back);
    expect(v).toMatchObject({ teacherId: TEACHER });
    expect(await Round.screen(v.teacherId, { lang: 'en', token: back })).toContain(Page.T.en.cHandback);
  });

  test('golden: a home (quiz) run carries no round_turn, no hand-back, no round page', async () => {
    await openTurn();
    const st = T.signSession({ sessionId: SESSION, deviceRef: 'DeviceRefGolden_000001', shareCodeId: SC });
    const out = await Ch.exercise(st, 'bigger', { lang: 'en' });
    for (const k of ['round_turn', 'round_handback', 'round_back', 'round_say']) expect(out).not.toHaveProperty(k);
    expect((await Ch.menu(st, { lang: 'en' }))).not.toHaveProperty('round_turn');
  });
});

describe('the turn\'s trail: the games stored for this turn are done', () => {
  test('a turn resumed after game 1 shows game 1 done (badge), game 2 still to play', async () => {
    const { token } = await openTurn();
    const before = await Ch.menu(token, { lang: 'en' });
    expect(before.round_turn).toBe(true);
    expect(before.exercises.map((e) => [e.id, e.done, e.badge]).sort()).toEqual([['bigger', false, false], ['missing', false, false]]);
    await playBigger(token);
    expect(draw().state.order[draw().state.cur].g).toEqual(['bigger']);
    // the teacher takes the phone back mid-turn and hands it over again: the same turn link, the same trail
    const after = await Ch.menu(token, { lang: 'en' });
    const by = Object.fromEntries(after.exercises.map((e) => [e.id, e]));
    expect(by.bigger).toMatchObject({ done: true, badge: true });
    expect(by.missing).toMatchObject({ done: false, badge: false });
    // ids only: nothing on a stop names a child
    expect(JSON.stringify(after)).not.toMatch(/Testwala|Kid\d/);
    // and the server still refuses a second run of the stored game
    await expect(Ch.exercise(token, 'bigger', { lang: 'en' })).rejects.toMatchObject({ status: 409 });
  });

  test('a game the child played at home is not shown done on the round trail (only this turn\'s stored games)', async () => {
    const { id, token } = await openTurn();
    DB.web_quiz_challenge_runs.push({ id: 'home', student_id: id, exercise: 'bigger', status: 'scored', score: { correct: 5, n: 10 }, mode: 'check', record: true, via: 'hub', created_at: new Date(Date.now() - 86400000).toISOString() });
    const m = await Ch.menu(token, { lang: 'en' });
    expect(m.exercises.find((e) => e.id === 'bigger')).toMatchObject({ done: false, badge: false });
  });
});
