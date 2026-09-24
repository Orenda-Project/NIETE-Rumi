'use strict';
/**
 * PLAN_R5 §1 D8 — `/quiz`'s started/finished counts must exclude the
 * teacher's own test run of her class link. `countsFor` reads `quiz_sessions`
 * directly, so this asserts the JS-level exclusion works AND the Postgres
 * trap the brief calls out: `user_id != teacherId` is NULL (not true) for
 * every row where `user_id IS NULL`, so a `.neq()` filter would silently
 * drop every real child — the filter has to happen in JS.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-report.service', () => ({ generate: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const TEACHER_ID = 'u1';
const QUIZ_ID = 'q1';

beforeEach(() => jest.clearAllMocks());

describe('countsFor excludes the teacher self-test', () => {
  test('with no teacherUserId passed, behaviour is unchanged (every row counts)', async () => {
    installFrom(supabase.from, {
      quiz_sessions: {
        data: [
          { quiz_id: QUIZ_ID, status: 'in_progress', user_id: null },
          { quiz_id: QUIZ_ID, status: 'completed', user_id: null },
        ],
      },
    });
    const counts = await List.countsFor([QUIZ_ID]);
    expect(counts.get(QUIZ_ID)).toEqual({ started: 2, finished: 1 });
  });

  test('with teacherUserId passed, her self-test row is dropped from both counts', async () => {
    installFrom(supabase.from, {
      quiz_sessions: {
        data: [
          { quiz_id: QUIZ_ID, status: 'completed', user_id: TEACHER_ID },  // her own test run
          { quiz_id: QUIZ_ID, status: 'in_progress', user_id: null },
          { quiz_id: QUIZ_ID, status: 'completed', user_id: null },
        ],
      },
    });
    const counts = await List.countsFor([QUIZ_ID], TEACHER_ID);
    expect(counts.get(QUIZ_ID)).toEqual({ started: 2, finished: 1 });
  });

  test('the Postgres trap: children whose user_id is NULL still count when teacherUserId is passed', async () => {
    // A naive `.neq('user_id', teacherUserId)` filter would make Postgres
    // evaluate `NULL != teacherId` as NULL (not true) for every real child
    // row, dropping the entire class. The exclusion must happen in JS.
    installFrom(supabase.from, {
      quiz_sessions: {
        data: [
          { quiz_id: QUIZ_ID, status: 'completed', user_id: null },
          { quiz_id: QUIZ_ID, status: 'completed', user_id: null },
          { quiz_id: QUIZ_ID, status: 'in_progress', user_id: null },
        ],
      },
    });
    const counts = await List.countsFor([QUIZ_ID], TEACHER_ID);
    expect(counts.get(QUIZ_ID)).toEqual({ started: 3, finished: 2 });
  });

  test('the select asks for user_id, so the exclusion has something to filter on', async () => {
    const from = installFrom(supabase.from, { quiz_sessions: { data: [] } });
    await List.countsFor([QUIZ_ID], TEACHER_ID);
    const calls = from.callsFor('quiz_sessions')[0] || [];
    const selectCall = calls.find(([method]) => method === 'select');
    expect(selectCall && selectCall[1]).toEqual(expect.stringContaining('user_id'));
  });
});

// The list's "N started · M done" and the status buttons' counts read one
// attempt per child — the latest completed, else the latest row — exactly as
// the class report does, and per quiz: the same child on two quizzes is a child
// of each.
describe('countsFor counts one attempt per child', () => {
  const projected = (rows) => (calls) => {
    const sel = calls.find(([m]) => m === 'select');
    const cols = sel && typeof sel[1] === 'string' ? sel[1].split(',').map((c) => c.trim()) : null;
    return { data: cols ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : rows, error: null };
  };
  const r = (quizId, studentId, status, created, completed = null) => ({
    quiz_id: quizId, user_id: null, student_id: studentId, status, created_at: created, completed_at: completed,
  });

  test('a stop-then-finish, a retake and a child on two quizzes', async () => {
    installFrom(supabase.from, {
      quiz_sessions: projected([
        r(QUIZ_ID, 'st-a', 'incomplete', '2026-09-10T08:00:00Z'),
        r(QUIZ_ID, 'st-a', 'completed', '2026-09-11T08:00:00Z', '2026-09-11T08:20:00Z'),
        r(QUIZ_ID, 'st-b', 'completed', '2026-09-10T08:00:00Z', '2026-09-10T08:20:00Z'),
        r(QUIZ_ID, 'st-b', 'completed', '2026-09-12T08:00:00Z', '2026-09-12T08:20:00Z'),
        r(QUIZ_ID, 'st-c', 'in_progress', '2026-09-10T08:00:00Z'),
        r('q2', 'st-a', 'in_progress', '2026-09-13T08:00:00Z'),
      ]),
    });
    const counts = await List.countsFor([QUIZ_ID, 'q2'], TEACHER_ID);
    expect(counts.get(QUIZ_ID)).toEqual({ started: 3, finished: 2 });
    expect(counts.get('q2')).toEqual({ started: 1, finished: 0 });
  });
});
