'use strict';
/**
 * GOLDEN: with the teacher's Jugnu tab switched off (or its parent off), the teacher report is today's page
 * byte for byte — the quiz tab and the class tab, asked for with or without ?tab=jugnu.
 *
 * The baselines in __goldens__/teacher-report-pages.json were written by THIS test from the code BEFORE the Jugnu tab existed
 * (GOLDEN_WRITE=1 on origin/sandbox); every later run compares against them. The routes run for real over
 * the real data core, page and token; faked: Supabase (in-memory, filters applied), the logger, the event
 * logger. Date is pinned so "Updated hh:mm", the dates and the 60-day window never drift.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { makeFake } = require('./fake-supabase');

const NOW = Date.parse('2026-10-15T09:30:00Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
// The baselines are sha256 + byte length of each whole page (the page embeds ~95 KB of font per render).
const FILE = path.join(__dirname, '__goldens__', 'teacher-report-pages.json');
const digest = (html) => ({ sha256: crypto.createHash('sha256').update(html, 'utf8').digest('hex'), bytes: Buffer.byteLength(html, 'utf8') });

function seed(settings) {
  const DB = {
    app_settings: settings,
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at(30), meta: { share_code_id: SC, student_message: 'Our quiz is ready! Tap: https://portal.example.test/q/AB12CD' } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, active: true, expires_at: null, language: 'en', created_at: at(30) }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    students: [1, 2, 3].map((r) => ({ id: kid(r), list_id: LIST, roll_number: r, student_name: `Kid${r} Testwala`, student_name_urdu: null, father_name: null, is_active: true })),
    class_enrollments: [1, 2, 3].map((r) => ({ class_id: CLASS, student_id: kid(r), is_active: true })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: kid(1), student_name: 'Kid1 Testwala', user_id: null, status: 'completed',
      correct_answers: 3, total_questions_answered: 4, completed_at: at(20), created_at: at(20.1), invited_by_student_id: null, device_ref: 'd1' }],
    quiz_questions: [],
    quiz_answers: [],
    web_quiz_challenge_runs: [{ id: 'r1', student_id: kid(2), canonical_id: kid(2), exercise: 'read', status: 'scored', mode: 'check', record: true,
      period_id: '2026-10', class_id: null, wcpm: 31, created_at: at(3), scored_at: at(3), meta: {} }],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
}

let server;
let base;
let Token;
async function boot(settings) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed(settings);
  Token = require('../../../shared/services/quiz/teacher-report-token');
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}

beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
afterEach(async () => { jest.useRealTimers(); if (server) await new Promise((r) => server.close(r)); server = null; });

const page = async (p) => {
  const res = await fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
  return { status: res.status, html: await res.text() };
};
const quizTok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const allTok = () => Token.signTeacherReport({ teacherId: TEACHER });

const STATES = {
  'no switch rows': [],
  'jugnu on, challenge_v2 off': [{ key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'false' }],
  'jugnu on, challenge off': [{ key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }],
  'jugnu off, both parents on': [{ key: 'web_quiz_teacher_jugnu', value: 'false' }, { key: 'web_quiz_challenge_v2', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' }],
};

const PAGES = [
  ['quiz', () => `/page/${quizTok()}`],
  ['quiz-ur', () => `/page/${quizTok()}?lang=ur`],
  ['class', () => `/page/${allTok()}`],
  ['quiz-class-tab', () => `/page/${quizTok()}?tab=class`],
];

if (process.env.GOLDEN_WRITE === '1') {
  test('write the baselines from the current code', async () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    await boot([]);
    const out = {};
    for (const [name, url] of PAGES) {
      const { status, html } = await page(url());
      expect(status).toBe(200);
      out[name] = digest(html);
    }
    fs.writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
  });
} else {
  describe.each(Object.keys(STATES))('switch state: %s', (state) => {
    test.each(PAGES.map(([n]) => n))('%s page is byte-identical to the baseline, with and without ?tab=jugnu', async (name) => {
      await boot(STATES[state]);
      const url = PAGES.find(([n]) => n === name)[1]();
      const want = JSON.parse(fs.readFileSync(FILE, 'utf8'))[name];
      const plain = await page(url);
      expect(plain.status).toBe(200);
      expect(digest(plain.html)).toEqual(want);
      // The same page asked for as ?tab=jugnu (a URL that already names a tab is not doubled).
      if (url.includes('tab=')) return;
      const asked = await page(`${url}${url.includes('?') ? '&' : '?'}tab=jugnu`);
      expect(digest(asked.html)).toEqual(want);
      expect(asked.html).not.toMatch(/Jugnu|جگنو|tab=jugnu/);
    });
  });
}
