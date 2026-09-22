'use strict';
/**
 * R8 lane D task 3.3 — "resend the link" on a quiz that has no coaching session.
 *
 * `load()` read the lesson date from `coaching_sessions` by the row's
 * `coaching_session_id`. An lp_v8 row has none, so the date came back empty
 * and the resent student message said nothing about WHICH lesson — or, with a
 * stale row, the wrong one. Its date is `meta.lesson_date`.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');

const LP_ROW = {
  id: 'q-lp', teacher_id: 'u-1', topic: 'Carrying', subject: 'maths', language: 'en', grade: '2', status: 'sent',
  coaching_session_id: null, quiz_source: 'lp_v8', meta: { lesson_date: '2026-09-18', share_code_id: 'sc', student_message: 'hi' },
};

function wire(row) {
  installFrom(supabase.from, ({
    quizzes: { data: [row] },
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    users: { data: [{ preferred_language: 'en', name: 'Rifat Noor' }] },
    quiz_questions: { data: [] },
  }));
}

test('load() for an lp_v8 row returns the lesson date as the session, without querying coaching_sessions', async () => {
  wire(LP_ROW);
  const b = await Handoff.load('q-lp');
  expect(supabase.from.callsFor('coaching_sessions')).toHaveLength(0);
  expect(b.session.created_at).toBeTruthy();
  // Noon PKT on the lesson day — no offset can move it onto the 17th or the 19th.
  expect(new Date(b.session.created_at).toISOString()).toBe('2026-09-18T07:00:00.000Z');
});

test('lessonSessionFor pins a bare date to noon PKT and passes a full timestamp through', () => {
  expect(Handoff.lessonSessionFor({ meta: { lesson_date: '2026-09-22' } })).toEqual({ created_at: '2026-09-22T12:00:00+05:00' });
  expect(Handoff.lessonSessionFor({ meta: { lesson_date: '2026-09-22T04:00:00Z' } })).toEqual({ created_at: '2026-09-22T04:00:00Z' });
  expect(Handoff.lessonSessionFor({ meta: {} })).toEqual({});
});

test('load() for a transcript row still reads the coaching session', async () => {
  installFrom(supabase.from, ({
    quizzes: { data: [{ ...LP_ROW, quiz_source: 'transcript', coaching_session_id: 's-1' }] },
    coaching_sessions: { data: [{ created_at: '2026-09-05T05:00:00Z' }] },
    users: { data: [{ preferred_language: 'en', name: 'Rifat Noor' }] },
    quiz_questions: { data: [] },
  }));
  const b = await Handoff.load('q-lp');
  expect(supabase.from.callsFor('coaching_sessions')).toHaveLength(1);
  expect(b.session.created_at).toBe('2026-09-05T05:00:00Z');
});
