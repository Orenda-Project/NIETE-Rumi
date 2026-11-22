'use strict';
/**
 * The class report's "Remind the class" (GET /api/internal/tr/remind/:token → 302 wa.me) is the report's one tap to the
 * class group, so it is the forward meter's `wa_report` surface: quiz_forward_tap { surface: wa_report, share_code_id }
 * next to teacher_report.reminder, which stays as it is. Never switched (a switched meter is a blind meter).
 * The route runs for real over the real data core and token; faked: Supabase (in memory), the PDF renderer, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));

const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function seed() {
  const DB = {
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript', status: 'report_sent',
      list_id: null, created_at: ago(30), meta: { share_code_id: SC, student_message: 'Our quiz is ready! Tap: https://portal.example.test/q/AB12CD' } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, active: true, expires_at: null, language: 'en', created_at: ago(30) }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: TEACHER, is_active: true }],
    students: [1, 2, 3].map((r) => ({ id: kid(r), list_id: LIST, roll_number: r, student_name: `Kid${r} Testwala`, student_name_urdu: null, is_active: true })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: kid(1), student_name: 'Kid1 Testwala', user_id: null, status: 'completed',
      correct_answers: 3, total_questions_answered: 4, completed_at: ago(20), created_at: ago(20.1), invited_by_student_id: null, device_ref: 'd1' }],
    quiz_questions: [],
    quiz_answers: [],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
}

let server;
let base;
let Token;
let logEvent;
beforeEach(async () => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed();
  Token = require('../../shared/services/quiz/teacher-report-token');
  ({ logEvent } = require('../../shared/utils/structured-logger'));
  const app = express();
  app.use('/api/internal/tr', require('../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

const get = (path) => fetch(`${base}${path}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('the report\'s "Remind the class" is the wa_report forward', () => {
  test('302 wa.me as before, teacher_report.reminder as before, AND quiz_forward_tap { surface: wa_report, share_code_id, method wa_me }', async () => {
    const res = await get(`/remind/${Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ })}?quiz=${QUIZ}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location').startsWith('https://wa.me/?text=')).toBe(true);
    expect(events('teacher_report.reminder')).toHaveLength(1);
    expect(events('quiz_forward_tap')).toEqual([expect.objectContaining({ surface: 'wa_report', share_code_id: SC, method: 'wa_me', origin: 'coaching', stale: false })]);
    expect(JSON.stringify(events('quiz_forward_tap')[0])).not.toMatch(/Kid\d|Plants|portal\.example/);
  });

  test('a quiz that is not the token\'s: 404 and no tap', async () => {
    const other = '22222222-2222-4222-8222-2222222222ff';
    const res = await get(`/remind/${Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ })}?quiz=${other}`);
    expect(res.status).toBe(404);
    expect(events('quiz_forward_tap')).toEqual([]);
  });
});
