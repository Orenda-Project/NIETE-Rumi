'use strict';
/**
 * The teacher's "All my classes" tab lists a storybook send next to the quizzes: its row says how many children
 * OPENED the story, never "played". A page of stories only heads its list "Your stories". The PDF of a story's own
 * report is named story-report-<day>.pdf. Quiz rows, quiz headings and the quiz PDF name are unchanged.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));

const express = require('express');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const page = (cls, lang) => require('../../../shared/templates/teacher-report.page')
  .renderPage({ class: { cells: [], weeks: [], ...cls } }, { lang, tab: 'class', tokens: { self: TOKEN } });
const row = (html, topic) => (html.match(/<li>[\s\S]*?<\/li>/g) || []).find((li) => li.includes(`>${topic}<`)) || '';
const n = (x) => `<b class="num"><span class="ltr">${x}</span></b>`; // an Urdu page wraps its numbers left-to-right
const story = (over = {}) => ({ id: 's-1', date: '2026-10-05T09:00:00Z', topic: 'The Kite', source: 'story', played: 3, of: 12, avg: null, ...over });
const quiz = (over = {}) => ({ id: 'q-1', date: '2026-10-05T09:00:00Z', topic: 'Magnets', source: 'transcript', played: 5, of: 12, avg: 80, ...over });

describe('a story row on the All my classes tab', () => {
  test('EN: "N of M opened", or "N opened" with no class list', () => {
    const html = page({ quizzes: [story(), story({ id: 's-2', topic: 'The Moon', of: null })] }, 'en');
    expect(row(html, 'The Kite')).toContain('· <b class="num">3</b> of <b class="num">12</b> opened</span>');
    expect(row(html, 'The Moon')).toContain('· <b class="num">3</b> opened</span>');
    expect(row(html, 'The Kite') + row(html, 'The Moon')).not.toMatch(/played/);
  });
  test('UR: «M میں سے N نے کھولی», or «N نے کھولی» with no class list', () => {
    const html = page({ quizzes: [story(), story({ id: 's-2', topic: 'The Moon', of: null })] }, 'ur');
    expect(row(html, 'The Kite')).toContain(`${n(12)} میں سے ${n(3)} نے کھولی</span>`);
    expect(row(html, 'The Moon')).toContain(`· ${n(3)} نے کھولی</span>`);
    expect(row(html, 'The Kite') + row(html, 'The Moon')).not.toMatch(/کھیلا/);
  });
  test('nobody opened it yet: never "played"', () => {
    expect(row(page({ quizzes: [story({ played: 0 })] }, 'en'), 'The Kite')).toContain('No one has opened it yet');
    expect(row(page({ quizzes: [story({ played: 0 })] }, 'ur'), 'The Kite')).toContain('ابھی کسی نے نہیں کھولی');
  });
  test('a page of stories only heads its list and its subtitle with stories', () => {
    const en = page({ quizzes: [story()] }, 'en');
    expect(en).toContain('<h2>Your stories</h2>');
    expect(en).toContain('Your stories from the last 60 days');
    expect(en).not.toContain('Your quizzes');
    const ur = page({ quizzes: [story()] }, 'ur');
    expect(ur).toContain('آپ کی کہانیاں');
    expect(ur).not.toContain('آپ کے کوئز');
  });
});

describe('quiz rows are unchanged', () => {
  test('EN and UR quiz rows, next to a story row, keep their words and their headings', () => {
    const en = page({ quizzes: [quiz(), quiz({ id: 'q-2', topic: 'Plants', of: null }), quiz({ id: 'q-3', topic: 'Rocks', played: 0, avg: null }), story()] }, 'en');
    expect(row(en, 'Magnets')).toContain('· <b class="num">5</b> of <b class="num">12</b> played · <span class="num">80%</span></span>');
    expect(row(en, 'Plants')).toContain('· <b class="num">5</b> played · <span class="num">80%</span></span>');
    expect(row(en, 'Rocks')).toContain('No one has played yet');
    expect(en).toContain('<h2>Your quizzes</h2>');
    expect(en).toContain('Your quizzes from the last 60 days');
    const ur = page({ quizzes: [quiz(), story()] }, 'ur');
    expect(row(ur, 'Magnets')).toContain(`· ${n(12)} میں سے ${n(5)} نے کھیلا · <span class="num">80%</span></span>`);
    expect(ur).toContain('آپ کے کوئز');
  });
});

describe('the PDF file name', () => {
  let server; let base; let Token; let Data;
  beforeEach(async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'test-key';
    delete process.env.WEB_QUIZ_TOKEN_SECRET;
    Token = require('../../../shared/services/quiz/teacher-report-token');
    Data = require('../../../shared/services/quiz/teacher-report.data');
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });
  const T = '11111111-1111-4111-8111-111111111111';
  const Q = '22222222-2222-4222-8222-222222222222';
  const report = (extra) => ({
    quiz: { id: Q, topic: 'The Kite', grade: '2', language: 'en', date: '2026-10-05T09:00:00Z' },
    roster: { state: 'none', lists: [] }, summary: { played: 0, of: null, avg: null }, played: [], notPlayed: [], questions: [], ...extra,
  });
  const pdf = (tok) => fetch(`${base}/pdf/${tok}?lang=en`, { headers: { 'x-api-key': 'test-key' } });
  test('a story report downloads as story-report-<day>.pdf', async () => {
    jest.spyOn(Data, 'quizReport').mockResolvedValue(report({ story: { children: [], counts: { opened: 0, listened: 0, read: 0, questions: 0 }, kinds: [], words: [] } }));
    const res = await pdf(Token.signTeacherReport({ teacherId: T, quizId: Q }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="story-report-\d{4}-\d{2}-\d{2}\.pdf"$/);
  });
  test('a quiz report still downloads as quiz-report-<day>.pdf', async () => {
    jest.spyOn(Data, 'quizReport').mockResolvedValue(report({}));
    const res = await pdf(Token.signTeacherReport({ teacherId: T, quizId: Q }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="quiz-report-\d{4}-\d{2}-\d{2}\.pdf"$/);
  });
});
