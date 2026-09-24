'use strict';
/**
 * PLAN_R5 §1 D8 — the nudge's `started` count decides whether a teacher is
 * told "only N children have started". Her own test run of the class link
 * must never count toward NUDGE_BELOW.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');

const QUIZ_ID = 'q1';
const TEACHER_ID = 'u1';

function stub({ sessions, quiz = {} }) {
  return installFrom(supabase.from, {
    quizzes: {
      data: [{
        id: QUIZ_ID, teacher_id: TEACHER_ID, topic: 'Fractions', status: 'sent',
        language: 'en', meta: {}, ...quiz,
      }],
    },
    quiz_sessions: { data: sessions },
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
  });
}

beforeEach(() => jest.clearAllMocks());

describe('PLAN_R5 D8 — the nudge count excludes the teacher self-test', () => {
  test('her self-test run does not count toward NUDGE_BELOW, so the nudge still fires', async () => {
    // 1 real child + her self-test = 2 raw rows, which is < NUDGE_BELOW (5)
    // either way — the real assertion is the REPORTED started count, below.
    stub({
      sessions: [
        { quiz_id: QUIZ_ID, user_id: TEACHER_ID },
        { quiz_id: QUIZ_ID, user_id: null },
      ],
    });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.ok).toBe(true);
    expect(result.started).toBe(1);   // the self-test row must not be counted
  });

  test('her self-test run alone must not read as "started" at all', async () => {
    stub({ sessions: [{ quiz_id: QUIZ_ID, user_id: TEACHER_ID }] });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.started).toBe(0);
    expect(WhatsAppService.sendMessage).toHaveBeenCalled();   // still nudges — nobody real has started
  });

  test('with enough REAL children started, the self-test row cannot push it under the nudge threshold', async () => {
    const sessions = [
      { quiz_id: QUIZ_ID, user_id: TEACHER_ID },
      ...Array.from({ length: 5 }, () => ({ quiz_id: QUIZ_ID, user_id: null })),
    ];
    stub({ sessions });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.skipped).toBe('enough_started');
    expect(result.started).toBe(5);
  });
});

// A child who re-opened the link (after typing STOP, or to try again) has two
// session rows; "only N children have started" counts children, as the class
// report and /quiz do — one attempt per child.
describe('the nudge counts each child once', () => {
  /** quiz_sessions answers only the columns the select asked for, so a count
   *  that needs student_id cannot pass without selecting it. */
  const projected = (rows) => (calls) => {
    const sel = calls.find(([m]) => m === 'select');
    const cols = sel && typeof sel[1] === 'string' ? sel[1].split(',').map((c) => c.trim()) : null;
    return { data: cols ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : rows, error: null };
  };

  test('a child with two attempts is one child started', async () => {
    installFrom(supabase.from, {
      quizzes: { data: [{ id: QUIZ_ID, teacher_id: TEACHER_ID, topic: 'Fractions', status: 'sent', language: 'en', meta: {} }] },
      quiz_sessions: projected([
        { id: 's1', quiz_id: QUIZ_ID, user_id: null, student_id: 'st-a', status: 'incomplete', completed_at: null, created_at: '2026-09-10T08:00:00Z' },
        { id: 's2', quiz_id: QUIZ_ID, user_id: null, student_id: 'st-a', status: 'in_progress', completed_at: null, created_at: '2026-09-11T08:00:00Z' },
        { id: 's3', quiz_id: QUIZ_ID, user_id: null, student_id: 'st-b', status: 'completed', completed_at: '2026-09-10T09:00:00Z', created_at: '2026-09-10T08:30:00Z' },
      ]),
      users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
    });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.started).toBe(2);
  });
});
