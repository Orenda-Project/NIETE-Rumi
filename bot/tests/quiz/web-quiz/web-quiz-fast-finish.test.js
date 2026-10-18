'use strict';
/**
 * Fast finish (app_settings web_quiz_fast, default off): finishSession reads the questions and the answers together,
 * and the scorecard's lookups that need only the session (the earlier finish, the shown name, the class code, the best
 * earlier score, a friend's score, the next lesson, the hub door, the Jugnu card) run beside the completion write;
 * the reads that see the completed row (the class's finishers today) and the challenge code (it may write) start only
 * after the write. Supabase is the boundary and is faked with a fixed delay per read; every first-party module runs.
 *
 * Off: the scorecard is exactly today's (golden recorded before the change). On: the same scorecard, more reads at once.
 * Volatile fields: a friend's own challenge code is a random code made at the finish; it (and the invite picture id
 * built from it) is checked against the row written, then replaced by a placeholder. Nothing else is stripped.
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

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');

const GOLDEN = path.join(__dirname, 'web-quiz-fast-finish.golden.json');
const READ_MS = 25;
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const CH = '33333333-3333-4333-8333-3333333333cc';
const KID = '44444444-4444-4444-8444-444444444444';
const FRIEND = '44444444-4444-4444-8444-555555555555';
const MATE = (n) => `44444444-4444-4444-8444-66666666666${n}`;
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

let fake;
let inflight = 0;
let maxInflight = 0;
let WQ;
let T;

const slow = (p) => {
  inflight += 1; maxInflight = Math.max(maxInflight, inflight);
  return new Promise((r) => setTimeout(r, READ_MS)).then(() => { inflight -= 1; return p(); });
};
const done = (id, studentId, c, h, extra = {}) => ({ id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, status: 'completed', user_id: null,
  invited_by_student_id: null, correct_answers: c, total_questions_answered: 4, completed_at: ago(h), created_at: ago(h + 0.1), device_ref: `dev-${id}`, ...extra });

function seed({ fast = false, lang = 'ur', sess = {}, sessions = [], answers = [true, true, false, true], settings = [] } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_hub_door', value: true },
      { key: 'web_quiz_challenge_card', value: true }, { key: 'web_quiz_challenge', value: true }, ...settings,
      ...(fast ? [{ key: 'web_quiz_fast', value: true }] : [])],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null }],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: lang, active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30) },
      // The challenge code each child forwards is reused once made: seeded, so the scorecard's code is known.
      { id: CH, code: 'KIDCH1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: lang, active: true,
        expires_at: future, invited_by_student_id: KID, parent_share_code_id: SC, created_at: ago(1) },
    ],
    quiz_questions: [1, 2, 3, 4].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: n === 1 ? 'Because A.' : null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, student_name: 'Zara Khan', status: 'in_progress', user_id: null,
      invited_by_student_id: null, created_at: ago(0.1), device_ref: D1, ...sess }, ...sessions],
    quiz_answers: answers.map((ok, i) => ({ session_id: 's1', question_id: Q(i + 1), selected_option: ok ? 'A' : 'B', is_correct: ok })),
    students: [{ id: KID, student_name: 'Zara Khan', student_name_urdu: 'زارا خان', self_reported_class: '3' },
      { id: FRIEND, student_name: 'Omar Ali', student_name_urdu: 'عمر علی', self_reported_class: '3' },
      ...[1, 2, 3, 4, 5].map((n) => ({ id: MATE(n), student_name: `Mate${n} Testwala` }))],
  });
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => slow(() => then.call(b, (x) => x)).then(res, rej);
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: (n, a) => slow(() => fake.rpc(n, a)) });
}

const SAVED = { ...process.env };
async function fresh(opts) {
  jest.resetModules();
  seed(opts);
  WQ = require('../../../shared/services/quiz/web-quiz.service');
  T = require('../../../shared/services/quiz/web-quiz-token');
  require('../../../shared/services/quiz/web-quiz-fast').on();
  await new Promise((r) => setTimeout(r, 3 * READ_MS));
}
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'fast-finish-secret' };
  inflight = 0; maxInflight = 0;
});
afterAll(() => { process.env = SAVED; });

const st = () => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC });
const finish = async () => {
  try { return JSON.parse(JSON.stringify(await WQ.finishSession({ st: st() }))); } catch (e) { return { status: e.status, body: e.body }; }
};

/** The scorecards this file pins. */
async function cards(fast) {
  const out = {};
  // A class child's first finish, fifth in the class today (Urdu code): counted, class line, challenge code, door, card.
  await fresh({ fast, sessions: [1, 2, 3, 4].map((n) => done(`m${n}`, MATE(n), 3, 0.01 * n)) });
  out.first = await finish();
  // A practice round: an earlier finish on another phone keeps the record; the best earlier score is the goal.
  await fresh({ fast, lang: 'en', sessions: [done('e1', KID, 2, 5), done('e2', KID, 3, 4)] });
  out.practice = await finish();
  // A friend's challenge: the friend plays the code the child forwarded (their session is on the class code, invited by the child).
  await fresh({ fast, sess: { invited_by_student_id: KID, student_id: FRIEND, student_name: 'Omar Ali' }, sessions: [done('k1', KID, 3, 2)] });
  out.versus = await finish();
  // The friend's own challenge code is made here (a random code): checked against the row written, then named.
  const made = fake.db.quiz_share_codes.filter((c) => c.invited_by_student_id === FRIEND && c.parent_share_code_id === SC);
  expect(made).toHaveLength(1);
  expect(out.versus.challenge_code).toBe(made[0].code);
  expect(out.versus.art.invite).toBe(require('../../../shared/services/quiz/web-quiz-art').artId('i', made[0].code));
  out.versus.challenge_code = '<the new code>';
  out.versus.art.invite = '<the new code>';
  // A repeat finish of a completed session (the page asked twice).
  await fresh({ fast, sess: { status: 'completed', completed_at: ago(0.02), correct_answers: 3, total_questions_answered: 4 } });
  out.again = await finish();
  // Too few answered: refused before anything is written.
  await fresh({ fast, answers: [true] });
  out.too_few = await finish();
  out.too_few_status = fake.db.quiz_sessions[0].status;
  return out;
}

test('switch off: the scorecards are today\'s, byte for byte (golden)', async () => {
  const out = await cards(false);
  expect(out.first.challenge_code).toBe('KIDCH1');
  expect(out.too_few.status).toBe(409);
  if (!fs.existsSync(GOLDEN)) fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
  expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
});

test('switch on: the scorecards are exactly the switch-off scorecards', async () => {
  const off = await cards(false);
  const on = await cards(true);
  expect(on).toEqual(off);
});

test('switch on: the scorecard\'s lookups run together (more reads in flight at once than today)', async () => {
  const peak = async (fast) => {
    await fresh({ fast, sessions: [1, 2, 3, 4].map((n) => done(`m${n}`, MATE(n), 3, 0.01 * n)) });
    await WQ.finishSession({ st: st() }); // warms the switches; the session is completed
    fake.db.quiz_sessions[0].status = 'in_progress';
    maxInflight = 0;
    await WQ.finishSession({ st: st() });
    return maxInflight;
  };
  const off = await peak(false);
  const on = await peak(true);
  expect(on).toBeGreaterThan(off);
  expect(on).toBeGreaterThanOrEqual(5);
});

test('switch on: the completion is written once, before the class\'s finishers are read, and the steps are still timed', async () => {
  await fresh({ fast: true, sessions: [1, 2, 3, 4].map((n) => done(`m${n}`, MATE(n), 3, 0.01 * n)) });
  const { logEvent } = require('../../../shared/utils/structured-logger');
  const out = await WQ.finishSession({ st: st() });
  // Fifth finisher today: the class line counts this child, so the read saw the completed row.
  expect(out.card.nth).toBe(5);
  const updates = fake.calls.filter((c) => c.table === 'quiz_sessions' && c.op === 'update');
  expect(updates).toHaveLength(1);
  expect(logEvent.mock.calls.filter(([n]) => n === 'quiz_funnel.child_completed')).toHaveLength(1);
  const [line] = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.finish_timing').map(([, p]) => p);
  expect(Object.keys(line.steps_ms).sort()).toEqual(['answers', 'best', 'challenge', 'class_code', 'complete', 'hub_door', 'names',
    'next_lesson', 'place', 'prior', 'questions', 'rest', 'session', 'versus'].sort());
});

test('switch on: a failed completion write fails the finish as today, and leaves nothing unhandled', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await fresh({ fast: true });
    await WQ.finishSession({ st: st() });
    fake.db.quiz_sessions[0].status = 'in_progress';
    const supabase = require('../../../shared/config/supabase');
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      const update = b.update;
      b.update = (patch) => { update.call(b, patch); b.then = (res, rej) => slow(() => ({ data: null, error: { message: 'down' } })).then(res, rej); return b; };
      return b;
    };
    expect(await finish()).toEqual({ status: 502, body: { error: 'db_unavailable' } });
    await new Promise((r) => setTimeout(r, 6 * READ_MS));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
