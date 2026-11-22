'use strict';
/**
 * The teacher's live report page (class tab) shows the evening rounds of the teacher's classes in their own "Evening
 * rounds" section: the day, the class, the lesson, and who finished (first names, as the teacher's own page shows
 * children). Nothing is sent: the page is read when the teacher opens it. Off (web_quiz_evening_round) or no round:
 * the section is absent and the class tab unchanged. Faked: Supabase (in memory), Redis, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocument: jest.fn() }));

const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Token = require('../../shared/services/quiz/teacher-report-token');

const T1 = '7e000000-0000-4000-8000-0000000000e1';
const T9 = '7e000000-0000-4000-8000-0000000000e9';
const C1 = 'c1a55000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const recent = (h) => new Date(Date.now() - h * 3600000).toISOString();

let db;
function seed(settings = SWITCHES) {
  db = {
    app_settings: settings,
    users: [{ id: T1, name: 'Rifat Test', preferred_language: 'en', school_id: null }],
    classes: [{ id: C1, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    class_enrollments: [],
    class_links: [],
    quizzes: [{ id: 'qr', teacher_id: T9, quiz_source: 'lp_v8', topic: 'Adding with carrying', subject: 'maths', grade: '3', status: 'ready', created_at: recent(30),
      meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', round_code: 'RND234', share_code_id: 'scr', n_items: 7, n_recall: 2 } }],
    quiz_share_codes: [{ id: 'scr', code: 'RND234', quiz_id: 'qr', class_id: C1, teacher_user_id: T9, created_at: recent(30) }],
    quiz_sessions: [
      { id: 's1', quiz_id: 'qr', share_code_id: 'scr', student_id: ZARA, student_name: 'Zara Test', status: 'completed', correct_answers: 6, total_questions_answered: 7, completed_at: recent(28) },
      { id: 's2', quiz_id: 'qr', share_code_id: 'scr', student_id: ALI, student_name: 'Ali Test', status: 'completed', correct_answers: 5, total_questions_answered: 7, completed_at: recent(27) },
      { id: 's3', quiz_id: 'qr', share_code_id: 'scr', student_id: ALI, student_name: 'Ali Test', status: 'completed', correct_answers: 7, total_questions_answered: 7, completed_at: recent(26) },
      { id: 's4', quiz_id: 'qr', share_code_id: 'scr', student_id: 'c0000001-0000-4000-8000-0000000000e3', student_name: 'Sana Test', status: 'in_progress', completed_at: null },
    ],
    students: [{ id: ZARA, student_name: 'Zara Test' }, { id: ALI, student_name: 'Ali Test' }],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache(); } catch (_) { /* not on this build */ }
}

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.WEB_QUIZ_TOKEN_SECRET = 'report-test-secret'; });
beforeEach(() => { jest.clearAllMocks(); seed(); });

async function page(teacherId = T1) {
  const app = express();
  app.use('/api/internal/tr', require('../../shared/routes/teacher-report-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const tok = Token.signTeacherReport({ teacherId });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/tr/page/${encodeURIComponent(tok)}?tab=class&lang=en`, { headers: { 'x-api-key': 'test-internal-key' } });
  const html = await res.text();
  await new Promise((r) => server.close(r));
  return { status: res.status, html };
}

test('the class tab carries an "Evening rounds" section: the class, the lesson, who finished (first finish each)', async () => {
  const { status, html } = await page();
  expect(status).toBe(200);
  expect(html).toContain('Evening rounds');
  expect(html).toContain('Class 3 B');
  expect(html).toContain('Adding with carrying');
  expect(html).toMatch(/2 children played/);
  expect(html).toContain('Zara');
  expect(html).toContain('Ali');
  expect(html).not.toContain('Sana');
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('the data: the teacher\'s classes only; one row per child (first finish)', async () => {
  const R = require('../../shared/services/quiz/web-quiz-evening-round');
  const rounds = await R.forTeacherReport(T1);
  expect(rounds).toEqual([expect.objectContaining({
    round_day: '2026-11-24', class_label: 'Class 3 B', topic: 'Adding with carrying', played: 2, finishers: ['Ali', 'Zara'], avg: 79,
  })]);
  expect(await R.forTeacherReport(T9)).toBeNull();
});

test('off: no section, nothing read for it', async () => {
  seed(SWITCHES.filter((r) => r.key !== 'web_quiz_evening_round'));
  const { html } = await page();
  expect(html).not.toContain('Evening rounds');
});
