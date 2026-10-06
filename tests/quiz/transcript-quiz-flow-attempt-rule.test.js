'use strict';
/**
 * The /quiz Flow's lesson screen must count each child's attempt by the SAME rule
 * as the class report and the teacher's web report: per class code, a code its
 * children played on the web page keeps each child's FIRST finish (a replay is
 * practice); any other code keeps the latest. Counting the whole quiz with the
 * default "latest" rule let a web replay move the Flow's average while the
 * report's stayed put — two averages for one quiz.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Flow = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const row = (id, code, correct, h, extra = {}) => ({
  id, quiz_id: 'q1', share_code_id: code, user_id: null, student_id: 'kid-1', student_name: 'Kid Testwala', student_class: '4',
  status: 'completed', total_questions_answered: 8, correct_answers: correct, mastery_percentage: Math.round((correct / 8) * 100),
  completed_at: at(h), created_at: at(h - 1), device_ref: null, ...extra,
});

test('a web code keeps the child\'s FIRST finish: a later 8/8 replay does not replace 4/8', async () => {
  installFrom(supabase.from, { quiz_sessions: { data: [
    row('s1', 'web-code', 4, 10, { device_ref: 'dev-a' }),
    row('s2', 'web-code', 8, 12, { device_ref: 'dev-b' }),
  ] } });
  const kids = await Flow.loadStudents('q1', 'teacher-1');
  expect(kids).toHaveLength(1);
  expect(kids[0].mastery_percentage).toBe(50);
});

test('a WhatsApp code keeps the latest finish, as before', async () => {
  installFrom(supabase.from, { quiz_sessions: { data: [
    row('s1', 'wa-code', 4, 10),
    row('s2', 'wa-code', 8, 12),
  ] } });
  const kids = await Flow.loadStudents('q1', 'teacher-1');
  expect(kids).toHaveLength(1);
  expect(kids[0].mastery_percentage).toBe(100);
});
