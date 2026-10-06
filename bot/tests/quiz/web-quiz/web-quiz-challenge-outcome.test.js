'use strict';
/**
 * A friend's challenge has an outcome: the friend learns at once whether they beat the
 * challenger's first score, and the challenger sees it for each friend. Supabase, SQS, Redis
 * and WhatsApp are faked; the web-quiz service runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The figure engine pulls in openchemlib (ESM); the repo's CJS stand-in lets a figure really draw here.
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
// E2 asks for the quiz's read-aloud clips in the background; publishing has its own suite
// (web-quiz-publish.test.js, network mocked at its edge), so here only the ask is observed.
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const SQS = require('../../../shared/services/queue/sqs-queue.service');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const KID_B = '55555555-5555-4555-8555-555555555555';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// A moment that is always "today" in Pakistan, never in the future: the live counts are per PKT day,
// so a fixed "N hours ago" seed stops counting as today for part of every day.
const todayPkt = () => new Date(Math.max(Date.parse(WQ.pktMidnightIso()) + 1000, Date.now() - 60000)).toISOString();

let fake;
function seed() {
  const questions = [1, 2, 3, 4].map((n) => ({
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null,
    correct_option: 'B', explanation: `Because ${n}`,
    option_feedback: { wrong: { 0: 'Roots hold the plant.' } },
    media: n === 1 ? { question_image: 'https://example.org/q1.png', option_images: [{ b64: Buffer.from('jpegbytes').toString('base64') }] } : {},
    render_pattern: 'P1',
  }));
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: 'sc-old', code: 'OLD111', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: ago(1), invited_by_student_id: null, parent_share_code_id: null, created_at: ago(800) },
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [
      // KID_A played on WhatsApp earlier today (has a phone row): a chip, and today's one finisher.
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Example', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75,
        completed_at: todayPkt(), created_at: todayPkt(), invited_by_student_id: null, device_ref: null, parent_phone: '0000', source: 'share_link' },
      // The teacher's own run — never a chip, never on the board.
      { id: 's-t', quiz_id: QUIZ, share_code_id: SC, student_id: null, student_name: 'Ms Example Teacher', user_id: TEACHER,
        status: 'completed', correct_answers: 4, total_questions_answered: 4, mastery_percentage: 100,
        completed_at: ago(19), created_at: ago(19), invited_by_student_id: null },
    ],
    students: [{ id: KID_A, student_name: 'Zara Example', self_reported_class: '3', phone: '0000' }],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  seed();
});
afterAll(() => { process.env = SAVED; });

const chipOf = (studentId) => T.chipId(SC, studentId);

// ─── a friend's challenge: who won, told to both sides ─────────────────────
const CH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function addChallengeCode() {
  fake.db.quiz_share_codes.push({ id: CH, code: 'CH12AB', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
    topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: KID_A,
    parent_share_code_id: SC, uses_count: 0, created_at: ago(2) });
}
async function friendPlays(name, picks, code = 'CH12AB') {
  const s = await WQ.startSession({ code, new: { name, force: true } });
  await WQ.recordAnswers({ st: s.st, a: picks.map((slot, i) => ({ qid: qid(i + 1), slot, ms: 2000, seq: i + 1 })) });
  return WQ.finishSession({ st: s.st });
}

describe('challengeOutcome (pure): compares the two scores as fractions', () => {
  test('higher share wins, equal share ties, lower loses, whatever the totals', () => {
    expect(WQ.challengeOutcome({ correct: 4, total: 4 }, { correct: 3, total: 4 })).toBe('win');
    expect(WQ.challengeOutcome({ correct: 6, total: 8 }, { correct: 3, total: 4 })).toBe('tie');
    expect(WQ.challengeOutcome({ correct: 2, total: 4 }, { correct: 3, total: 4 })).toBe('lose');
    expect(WQ.challengeOutcome({ correct: 0, total: 0 }, { correct: 3, total: 4 })).toBe('lose');
  });
});

describe('E5 finish on a challenge code tells the friend who won', () => {
  beforeEach(addChallengeCode);
  test('beat the challenger: vs carries the challenger\'s first name, first score and win', async () => {
    const out = await friendPlays('Omar Testwala', ['B', 'B', 'B', 'B']);
    expect(out.vs).toEqual({ first: 'Zara', correct: 3, total: 4, outcome: 'win' });
  });
  test('same score is a tie, a lower one a loss', async () => {
    expect((await friendPlays('Hina Testwala', ['B', 'B', 'B', 'A'])).vs.outcome).toBe('tie');
    expect((await friendPlays('Bilal Testwala', ['B', 'A', 'A', 'B'])).vs.outcome).toBe('lose');
  });
  test('a class finish (no challenge) has no vs', async () => {
    const out = await friendPlays('Sana Testwala', ['B', 'B', 'B', 'B'], 'AB12CD');
    expect(out.vs).toBeUndefined();
  });
});

describe('E7 me tells the challenger how each friend did against them', () => {
  test('friends_finished carries the outcome from the friend\'s side', async () => {
    fake.db.quiz_sessions.push(
      { id: 'fr1', quiz_id: QUIZ, share_code_id: SC, student_id: 'kid-f1', student_name: 'Rida Friend', status: 'completed',
        correct_answers: 4, total_questions_answered: 4, completed_at: ago(1), created_at: ago(1.1), invited_by_student_id: KID_A },
      { id: 'fr2', quiz_id: QUIZ, share_code_id: SC, student_id: 'kid-f2', student_name: 'Ayan Friend', status: 'completed',
        correct_answers: 1, total_questions_answered: 4, completed_at: ago(2), created_at: ago(2.1), invited_by_student_id: KID_A },
    );
    const out = await WQ.me({ code: 'AB12CD', chips: [chipOf(KID_A)] });
    expect(out.friends_finished.map((f) => [f.first, f.outcome])).toEqual([['Rida', 'win'], ['Ayan', 'lose']]);
  });
});

describe('a child who opens their own challenge link is never their own challenger', () => {
  test('a session whose child IS the inviter gets no vs', async () => {
    addChallengeCode();
    const s = await WQ.startSession({ code: 'CH12AB', new: { name: 'Omar Testwala', force: true } });
    const sid = T.verify(s.st, 's').sid;
    // The identity layer resolved this run to the challenger themselves (their own card on their own phone).
    fake.db.quiz_sessions.find((r) => r.id === sid).student_id = KID_A;
    await WQ.recordAnswers({ st: s.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
    const out = await WQ.finishSession({ st: s.st });
    expect(out.vs).toBeUndefined();
  });
});

describe('E2 on a challenge code ships none of the challenger\'s class context', () => {
  test('no teacher, no class label, no class chips, no class count; the challenge itself is there', async () => {
    addChallengeCode();
    const q = await WQ.getQuiz('CH12AB');
    expect(q.challenge).toMatchObject({ first: 'Zara' });
    expect(q.cls.teacher).toBeNull();
    expect(q.cls.label).toBeNull();
    expect(q.cls.chips).toEqual([]);
    expect(q.live.class_today).toBe(0);
    expect(q.live.now).toBeUndefined();
    // the class code itself is unchanged
    const c = await WQ.getQuiz('AB12CD');
    expect(c.cls.teacher).toBeTruthy();
    expect(c.live.class_today).toBe(1);
  });
});
