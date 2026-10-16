'use strict';
/**
 * A child called in the class round plays the existing Challenge with a round turn token: the Challenge's serve
 * writes the run row (mode = the mode the round chose for the position, via 'class_round', the round's class, and its
 * own admin_mode / sample_arm); the round passes the mode and writes nothing on the row. The claim is honoured ONLY with
 * the switch on, the round open (started, not finished) and THIS child's turn open. A teacher's phone outside the
 * round keeps today's behaviour (no round columns on any run). The real Challenge service, tokens, item bank and
 * round service run; faked: Supabase (in-memory), the logger, R2 and speech/LLM clients, the hashed-key module.
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
];
const RECORD_MISSING = [{ key: 'web_quiz_challenge_record', value: true }, { key: 'web_quiz_challenge_missing', value: true }];

let DB; let T; let Ch; let Round; let logEvent;
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
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  Ch.__reset();
});

const draw = () => DB.class_round_draws[0];
const HOLD = { act: 'hold', hold: 700 };
async function openTurn() {
  await Round.start(TEACHER, { rng: () => 0 });
  await Round.next(TEACHER, HOLD);
  const st = draw().state;
  const id = st.order[st.cur].id;
  return { id, token: Round.turnToken(ROUND, id) };
}
async function playBigger(token) {
  const out = await Ch.exercise(token, 'bigger', { lang: 'en' });
  const taps = out.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2000 }));
  await Ch.submit({ ct: out.ct, taps, ms: 20000 }, { now: Date.now() + 30000 });
  return out;
}

test('a round run: the serve writes mode and via class_round, the round\'s class, teacher_present and the class_round arm', async () => {
  const { id, token } = await openTurn();
  await playBigger(token);
  expect(DB.web_quiz_challenge_runs).toHaveLength(1);
  const row = DB.web_quiz_challenge_runs[0];
  expect(row).toMatchObject({ student_id: id, status: 'scored', mode: 'class_round', via: 'class_round', class_id: CLASS, canonical_id: id,
    admin_mode: 'teacher_present', sample_arm: 'class_round' });
});

test('a round turn\'s page: no practice banner and no mode at any position, and the same warm line after every item', async () => {
  seed([...ON, { key: 'web_quiz_challenge_record', value: true }, { key: 'web_quiz_challenge_trail', value: true }]);
  Object.assign(draw(), { k_counted: 1 });
  // the child has a home run of the game already (a second home play would be a practice round)
  DB.web_quiz_challenge_runs.push({ id: 'home', student_id: kid(1), exercise: 'bigger', status: 'scored', score: { correct: 5, n: 10 }, mode: 'check', via: 'hub', created_at: new Date(Date.now() - 86400000).toISOString() });
  await Round.start(TEACHER, { rng: () => 0 });
  for (let i = 0; i < 2; i += 1) {
    await Round.next(TEACHER, HOLD);
    const st = draw().state;
    const out = await Ch.exercise(Round.turnToken(ROUND, st.order[st.cur].id), 'bigger', { lang: i ? 'ur' : 'en' });
    expect(out).not.toHaveProperty('practice_round');
    expect(out).not.toHaveProperty('mode');
    expect(out.round_say).toBe(require('../../../shared/templates/class-round.page').T[i ? 'ur' : 'en'].cNextSay);
    await Round.childFinished(ROUND, st.order[st.cur].id, `r${i}`);
    await Round.toTeacher(TEACHER, HOLD);
  }
  // a home play keeps its payload: no round line
  const st = T.signSession({ sessionId: SESSION, deviceRef: 'DeviceRefGolden_000001', shareCodeId: SC });
  expect(await Ch.exercise(st, 'bigger', { lang: 'en' })).not.toHaveProperty('round_say');
});

test('the menu offers the round\'s tap games only; the read-aloud is refused on a round token', async () => {
  const { token } = await openTurn();
  const menu = await Ch.menu(token, { lang: 'en' });
  expect(menu.exercises.map((e) => e.id)).toEqual(['bigger']);
  await expect(Ch.exercise(token, 'read', { lang: 'en' })).rejects.toMatchObject({ status: 404 });
});

test('with "Missing number" on, the child is done after both tap games: one class_round_child_done{round, cls, run}+kid, no pos', async () => {
  seed([...ON, ...RECORD_MISSING]);
  const { id, token } = await openTurn();
  await playBigger(token);
  expect(draw().state.order[draw().state.cur].s).toBe('todo');
  const m = await Ch.exercise(token, 'missing', { lang: 'en' });
  await Ch.submit({ ct: m.ct, answers: m.items.map((it, i) => ({ i, value: String(it.answer), ms: 3000 })), ms: 30000 }, { now: Date.now() + 60000 });
  const pos = draw().state.order.find((p) => p.id === id);
  expect(pos.s).toBe('done');
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_round_child_done').map((c) => c[1]);
  expect(ev).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: `kid(${id.slice(-2)})`, round: ROUND, cls: 'cls(c1)', run: m.ct && T.verify(m.ct, 'c').r }]);
});

test('the claim is refused: switch off, round not started, round finished, another child\'s turn, turn closed', async () => {
  const { id, token } = await openTurn();
  // another child (not the open turn)
  const other = [kid(1), kid(2), kid(3)].find((x) => x !== id);
  await expect(Ch.menu(Round.turnToken(ROUND, other), { lang: 'en' })).rejects.toMatchObject({ status: 401 });
  // turn closed by the teacher's long-press
  await Round.toTeacher(TEACHER, HOLD);
  await expect(Ch.menu(token, { lang: 'en' })).rejects.toMatchObject({ status: 401 });
  // a challenge token minted in the turn is refused at submit once the turn is closed: no row
  await Round.next(TEACHER, HOLD);
  const st = draw().state;
  const t2 = Round.turnToken(ROUND, st.order[st.cur].id);
  const out = await Ch.exercise(t2, 'bigger', { lang: 'en' });
  await Round.toTeacher(TEACHER, HOLD);
  await expect(Ch.submit({ ct: out.ct, taps: [], ms: 1 }, { now: Date.now() + 1000 })).rejects.toMatchObject({ status: 401 });
  // only the serve's own row, never finished
  expect(DB.web_quiz_challenge_runs.map((r) => r.status)).toEqual(['served']);
  // the switch off
  await Round.next(TEACHER, HOLD);
  const st2 = draw().state;
  const t3 = Round.turnToken(ROUND, st2.order[st2.cur].id);
  DB.app_settings.find((s) => s.key === 'web_quiz_class_round').value = false;
  require('../../../shared/services/quiz/web-quiz-class-round-flags')._resetCache();
  await expect(Ch.menu(t3, { lang: 'en' })).rejects.toMatchObject({ status: 401 });
  // finished
  DB.app_settings.find((s) => s.key === 'web_quiz_class_round').value = true;
  require('../../../shared/services/quiz/web-quiz-class-round-flags')._resetCache();
  draw().finished_at = new Date().toISOString();
  await expect(Ch.menu(t3, { lang: 'en' })).rejects.toMatchObject({ status: 401 });
});

test('not started: no turn token works', async () => {
  await expect(Ch.menu(Round.turnToken(ROUND, kid(1)), { lang: 'en' })).rejects.toMatchObject({ status: 401 });
});

test('the teacher\'s phone outside the round: a session run carries no round column, whatever the switches say', async () => {
  await openTurn();
  const st = T.signSession({ sessionId: SESSION, deviceRef: 'DeviceRefGolden_000001', shareCodeId: SC });
  await playBigger(st);
  const row = DB.web_quiz_challenge_runs[0];
  expect(row).toMatchObject({ mode: 'check', via: 'quiz_card', admin_mode: 'self_run', sample_arm: null });
  expect(T.verify((await Ch.exercise(st, 'bigger', { lang: 'en' })).ct, 'c')).not.toHaveProperty('cr');
});

test('a forged claim on a challenge token (cr without a valid turn) stores nothing', async () => {
  await openTurn();
  const ct = T.sign({ k: 'c', sid: kid(3), ex: 'bigger', r: '77777777-7777-4777-8777-777777777777', cr: 'ffffffffffffffff', exp: Math.floor(Date.now() / 1000) + 600 });
  await expect(Ch.submit({ ct, taps: [], ms: 1 })).rejects.toMatchObject({ status: 401 });
  expect(DB.web_quiz_challenge_runs).toEqual([]);
});

describe('the sampling ruling on the Challenge side', () => {
  const later = (ms) => new Date(Date.now() + ms).toISOString();
  beforeEach(() => {
    Object.assign(draw(), { window_start: later(-86400000), window_end: later(20 * 86400000), k_counted: 1 });
  });

  test('§6(e) the challenge token carries the mode the server chose; after k the run is practice, via class_round; no position stored', async () => {
    await Round.start(TEACHER, { rng: () => 0 });
    for (let i = 0; i < 2; i += 1) {
      await Round.next(TEACHER, HOLD);
      const st = draw().state;
      const id = st.order[st.cur].id;
      const out = await playBigger(Round.turnToken(ROUND, id));
      expect(T.verify(out.ct, 'c').cm).toBe(i === 0 ? 'class_round' : 'practice');
      const row = DB.web_quiz_challenge_runs[i];
      expect(row).toMatchObject({ student_id: id, mode: i === 0 ? 'class_round' : 'practice', via: 'class_round' });
      expect(JSON.stringify(row)).not.toMatch(/"pos"|"position"/);
      await Round.toTeacher(TEACHER, HOLD);
    }
  });

  test('a challenge token whose mode disagrees with the server stores nothing', async () => {
    await Round.start(TEACHER, { rng: () => 0 });
    await Round.next(TEACHER, HOLD);
    const st = draw().state;
    const id = st.order[st.cur].id;
    const ct = T.sign({ k: 'c', sid: id, ex: 'bigger', r: '77777777-7777-4777-8777-777777777777', cr: ROUND, cm: 'practice', exp: Math.floor(Date.now() / 1000) + 600 });
    await expect(Ch.submit({ ct, taps: [], ms: 1 })).rejects.toMatchObject({ status: 401 });
    expect(DB.web_quiz_challenge_runs).toEqual([]);
  });

  test('NC4: a second round run for the same child and game in the same term is refused by the server', async () => {
    await Round.start(TEACHER, { rng: () => 0 });
    await Round.next(TEACHER, HOLD);
    const st = draw().state;
    const id = st.order[st.cur].id;
    DB.web_quiz_challenge_runs.push({ id: 'old', student_id: id, exercise: 'bigger', status: 'scored', via: 'class_round', mode: 'class_round', created_at: later(-3600000) });
    await expect(Ch.exercise(Round.turnToken(ROUND, id), 'bigger', { lang: 'en' })).rejects.toMatchObject({ status: 409 });
    expect(DB.web_quiz_challenge_runs).toHaveLength(1);
    // a finished round run that appears after the serve (another device) refuses the submit too
    DB.web_quiz_challenge_runs.pop();
    const out = await Ch.exercise(Round.turnToken(ROUND, id), 'bigger', { lang: 'en' });
    DB.web_quiz_challenge_runs.push({ id: 'other', student_id: id, exercise: 'bigger', status: 'scored', via: 'class_round', mode: 'class_round', created_at: later(-1000) });
    await expect(Ch.submit({ ct: out.ct, taps: [], ms: 1 }, { now: Date.now() + 1000 })).rejects.toMatchObject({ status: 401 });
  });

  test('§6(g) outside the window the turn token opens nothing', async () => {
    await Round.start(TEACHER, { rng: () => 0 });
    await Round.next(TEACHER, HOLD);
    const st = draw().state;
    const t = Round.turnToken(ROUND, st.order[st.cur].id);
    draw().window_end = later(-1000);
    await expect(Ch.menu(t, { lang: 'en' })).rejects.toMatchObject({ status: 401 });
  });
});
