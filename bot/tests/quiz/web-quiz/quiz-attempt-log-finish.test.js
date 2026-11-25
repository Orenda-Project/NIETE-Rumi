'use strict';
/**
 * Keep every quiz attempt (table quiz_attempts). A finished web quiz appends one row: the child's answers, the score, the
 * answer key that marked them (key_version) and the questions the quiz maker wrote (items_version), so a later change
 * of score can be told apart from a change of marking. The row is written beside the finish and never changes it: the
 * reply the child's page gets is the same with the switch on or off, and a failed write is only a log line.
 * Switch: app_settings web_quiz_keep_attempts, on only for JSON true.
 *
 * Runs the real service; Supabase is the fake at the boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false,
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Pulse = require('../../../shared/services/quiz/web-quiz-pulse');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const AttemptLog = require('../../../shared/services/quiz/quiz-attempt-log');

const TEACHER = '11111111-1111-4111-8111-1111111111f1';
const QUIZ = '22222222-2222-4222-8222-2222222222f1';
const SC = '33333333-3333-4333-8333-3333333333f1';
const MADE = '2026-11-20T08:00:00.000Z';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const qid = (n) => `91a10000-0000-4000-8000-0000000000f${n}`;
const ROWS = [1, 2, 3, 4].map((n) => ({
  id: qid(n), quiz_id: QUIZ, external_id: `tq:${QUIZ}:S1:${n}`, sort_order: n, question_text: `Plain question ${n}?`,
  option_a: 'One', option_b: 'Two', option_c: 'Three', option_d: 'Four', correct_option: 'B', explanation: 'Because.',
  option_feedback: {}, render_pattern: 'P1', media: {},
}));

let db;
function world({ on = true, failInsert = false } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true }, ...(on === null ? [] : [{ key: 'web_quiz_keep_attempts', value: on }])],
    quiz_share_codes: [{ id: SC, code: 'PLAIN1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Plants', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, class_id: null, created_at: MADE }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', quiz_source: 'transcript',
      status: 'sent', meta: {}, created_at: MADE }],
    quiz_questions: ROWS.map((q) => ({ ...q })),
    students: [],
    quiz_sessions: [],
    quiz_answers: [],
    quiz_attempts: [],
  };
  const fake = makeFake(db);
  const from = failInsert
    ? (t) => (t === 'quiz_attempts' ? { insert: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) } : fake.from(t))
    : fake.from;
  Object.assign(supabase, { from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', RAILWAY_GIT_COMMIT_SHA: 'abc1234def' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  HubFlags._resetCache();
  Pulse._reset();
  AttemptLog._reset();
  logToFile.mockClear();
});
afterAll(() => { process.env = SAVED; });

// Zara answers 1-3 right (B) and 4 wrong (C), then finishes.
async function playOnce() {
  const kid = db.quiz_sessions.find((x) => x.student_id);
  const a = await WQ.startSession(kid ? { code: 'PLAIN1', chip: T.chipId(SC, kid.student_id) } : { code: 'PLAIN1', new: { name: 'Zara', force: true } });
  await WQ.recordAnswers({ st: a.st, a: ROWS.map((q, i) => ({ qid: q.id, slot: i === 3 ? 'C' : 'B' })) });
  const fin = await WQ.finishSession({ st: a.st });
  await AttemptLog._settled();
  return fin;
}

test('a finished web quiz appends one attempt row: answers, score, key and maker versions', async () => {
  world();
  const fin = await playOnce();
  expect(fin.score).toEqual(expect.objectContaining({ correct: 3, total: 4 }));
  expect(db.quiz_attempts).toHaveLength(1);
  const row = db.quiz_attempts[0];
  expect(row).toEqual(expect.objectContaining({
    session_id: db.quiz_sessions[0].id, quiz_id: QUIZ, student_id: db.quiz_sessions[0].student_id, share_code_id: SC, channel: 'web', status: 'completed',
    correct: 3, total: 4, quiz_source: 'transcript', quiz_made_at: MADE, marker_commit: 'abc1234def',
  }));
  expect(row.answers).toHaveLength(4);
  expect(row.answers[3]).toEqual({ qid: qid(4), picked: 'C', ok: false, key: 'B', item: expect.stringMatching(/^[0-9a-f]{12}$/) });
  expect(row.key_version).toMatch(/^[0-9a-f]{16}$/);
  expect(row.items_version).toMatch(/^[0-9a-f]{16}$/);
});

test('a second try is a second row; the first is kept as it was', async () => {
  world();
  await playOnce();
  const first = { ...db.quiz_attempts[0] };
  await playOnce();
  expect(db.quiz_attempts).toHaveLength(2);
  expect(db.quiz_attempts[0]).toEqual(first);
  expect(db.quiz_attempts[1].session_id).not.toBe(first.session_id);
});

test('a key fixed after the first try gives the next try a different key_version, same items_version', async () => {
  world();
  await playOnce();
  db.quiz_questions.find((q) => q.id === qid(4)).correct_option = 'C';
  await playOnce();
  const [a, b] = db.quiz_attempts;
  expect(b.key_version).not.toBe(a.key_version);
  expect(b.items_version).toBe(a.items_version);
  expect(b.answers[3]).toEqual(expect.objectContaining({ picked: 'C', ok: true, key: 'C' }));
});

test('switch off (no row, or not JSON true): nothing is written and the child sees the same finish', async () => {
  world({ on: true });
  const onFin = await playOnce();
  for (const off of [null, 'true', false]) {
    world({ on: off });
    AttemptLog._reset();
    const offFin = await playOnce();
    expect(db.quiz_attempts).toHaveLength(0);
    expect(offFin.score).toEqual(onFin.score);
    expect(offFin.review).toEqual(onFin.review);
    expect(Object.keys(offFin).sort()).toEqual(Object.keys(onFin).sort());
  }
});

test('a failed write (table missing) never fails the finish; it is logged', async () => {
  world({ failInsert: true });
  const fin = await playOnce();
  expect(fin.score).toEqual(expect.objectContaining({ correct: 3, total: 4 }));
  expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('quiz attempt log'), expect.anything(), 'warn');
});
