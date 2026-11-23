'use strict';
/**
 * bd-5j1zaf — the report routes (/api/internal/tr/page and /pdf) and the late-finishers switch
 * (app_settings quiz_teacher_home_reports, report-late-flag: only the JSON true is on).
 *
 *   - on: the quiz tab renders with `late` (the counts line and the row tags); the PDF too
 *   - teacher_report.opened (v1 and the events-v2 envelope) gains late_n (the quiz tab: summary.late || 0; never on
 *     the class tab) and from (?from= exactly home | wa | list; anything else absent) — only while on
 *   - off (no row, or the string "true"): the page has none of it and the event is today's object byte for byte, even
 *     with ?from=home and late rows in the data
 *   - the switch is read once per request
 *
 * The routes, the page template, the token, the flag readers and the event envelope run for real on an ephemeral
 * port. Faked: Supabase (in-memory, filters applied: app_settings + users), the report's data reader
 * (teacher-report.data, whose late fields are the lane manager's contract: summary.late / played[i].late), the PDF
 * printer (captures the HTML) and the loggers, whose calls are the events. Children are invented "Testwala" fixtures.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../shared/services/quiz/teacher-report.data', () => ({
  quizReport: jest.fn(),
  classReport: jest.fn(),
  listLabel: (l) => (l && l.class_name) || '',
}));

const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const KEY = 'quiz_teacher_home_reports';

const lateReport = () => ({
  quiz: { id: QUIZ, topic: 'Plants', subject: 'science', grade: '3', source: 'transcript', language: 'en', date: '2026-11-20T09:00:00Z', code: 'AB12CD' },
  roster: { state: 'known', className: '3-B', of: 3, lists: [] },
  summary: { played: 3, of: 3, avg: 70, total: 4, hardestN: 1, late: 2, reported: true },
  played: [
    { first: 'Amna Testwala', roll: 1, correct: 3, total: 4, pct: 75, onList: true },
    { first: 'Chand Testwala', roll: 2, correct: 2, total: 4, pct: 50, onList: true, late: true },
    { first: 'Dua Testwala', roll: 3, correct: 4, total: 4, pct: 100, onList: true, late: true },
  ],
  notPlayed: [],
  questions: [],
  guidance: null,
  reminder: null,
});

let fake;
let server;
let base;
let Token;
let logEvent;
let htmlToPdf;
let Data;

async function boot({ settings = [] } = {}) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  delete process.env.WEB_QUIZ_KID_KEY_V;
  fake = makeFake({ app_settings: settings, users: [{ id: TEACHER, preferred_language: 'en' }] });
  Object.assign(require('../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  Token = require('../../shared/services/quiz/teacher-report-token');
  ({ logEvent } = require('../../shared/utils/structured-logger'));
  ({ htmlToPdf } = require('../../shared/utils/html-to-pdf'));
  Data = require('../../shared/services/quiz/teacher-report.data');
  Data.quizReport.mockImplementation(async () => lateReport());
  Data.classReport.mockImplementation(async () => ({ cells: [], weeks: [], quizzes: [] }));
  const app = express();
  app.use('/api/internal/tr', require('../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}
afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });

const ON = [{ key: KEY, value: true }];
const V2 = [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_events_v2', value: 'true' }];
const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const opened = () => logEvent.mock.calls.filter((c) => c[0] === 'teacher_report.opened').map((c) => c[1]);
const quizTok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const allTok = () => Token.signTeacherReport({ teacherId: TEACHER });
const TODAY_QUIZ = `{"teacherId":"${TEACHER}","quizId":"${QUIZ}","scope":"quiz","tab":"quiz","iab":false}`;
const TODAY_CLASS = `{"teacherId":"${TEACHER}","quizId":null,"scope":"all","tab":"class","iab":false}`;

describe('switch on: the quiz tab marks the late finishers', () => {
  test('the page carries the counts line and a tag on each late row; opened has late_n and from=home', async () => {
    await boot({ settings: ON });
    const res = await get(`/page/${quizTok()}?from=home`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div class="sub late-line">3 played · 2 after the report was sent</div>');
    expect(html.match(/class="late tag"/g)).toHaveLength(2);
    expect(opened()).toEqual([{ teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: false, late_n: 2, from: 'home' }]);
  });

  test.each(['wa', 'list', 'class'])('from=%s is kept', async (from) => {
    await boot({ settings: ON });
    await (await get(`/page/${quizTok()}?from=${from}`)).text();
    expect(opened()).toEqual([expect.objectContaining({ late_n: 2, from })]);
  });

  test('from= anything else (or twice, or absent) → no from field; late_n stays', async () => {
    await boot({ settings: ON });
    for (const q of ['?from=evil', '?from=HOME', '?from=home&from=wa', '?from=', '']) {
      logEvent.mockClear();
      await (await get(`/page/${quizTok()}${q}`)).text();
      const [ev] = opened();
      expect(ev).toEqual({ teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: false, late_n: 2 });
    }
  });

  test('nobody late: late_n is 0 (the field is there while on), and the page has no line', async () => {
    await boot({ settings: ON });
    Data.quizReport.mockImplementation(async () => {
      const r = lateReport();
      delete r.summary.late;
      r.played = r.played.map(({ late, ...p }) => p);
      return r;
    });
    const html = await (await get(`/page/${quizTok()}?from=wa`)).text();
    expect(html).not.toContain('late-line');
    expect(opened()).toEqual([{ teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: false, late_n: 0, from: 'wa' }]);
  });

  test('the class tab: from is kept, late_n is absent', async () => {
    await boot({ settings: ON });
    const res = await get(`/page/${allTok()}?from=home`);
    expect(res.status).toBe(200);
    await res.text();
    expect(opened()).toEqual([{ teacherId: TEACHER, quizId: null, scope: 'all', tab: 'class', iab: false, from: 'home' }]);
  });

  test('events v2: the envelope carries late_n and from beside render_ms', async () => {
    await boot({ settings: [...ON, ...V2] });
    await (await get(`/page/${quizTok()}?from=list`)).text();
    const [ev] = opened();
    expect(ev).toEqual({
      w: 's', ev_v: 2, kid_v: null, kid: null, teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: false,
      late_n: 2, from: 'list', render_ms: expect.any(Number),
    });
  });

  test('the switch is read once per request', async () => {
    await boot({ settings: ON });
    const Flag = require('../../shared/services/quiz/report-late-flag');
    const spy = jest.spyOn(Flag, 'on');
    await (await get(`/page/${quizTok()}?from=home`)).text();
    expect(spy).toHaveBeenCalledTimes(1);
    await (await get(`/pdf/${quizTok()}`)).arrayBuffer();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('the PDF (print) carries the same line and tags', async () => {
    await boot({ settings: ON });
    const res = await get(`/pdf/${quizTok()}`);
    expect(res.status).toBe(200);
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toContain('<div class="sub late-line">3 played · 2 after the report was sent</div>');
    expect(html.match(/class="late tag"/g)).toHaveLength(2);
  });
});

describe('switch off: today\'s page and today\'s event, byte for byte', () => {
  test.each([
    ['no row', []],
    ['the string "true"', [{ key: KEY, value: 'true' }]],
    ['false', [{ key: KEY, value: false }]],
  ])('%s: no line, no tag, the event is today\'s object even with ?from=home', async (_, settings) => {
    await boot({ settings });
    const html = await (await get(`/page/${quizTok()}?from=home`)).text();
    expect(html).not.toContain('late-line');
    expect(html).not.toContain('class="late tag"');
    expect(opened().map((d) => JSON.stringify(d))).toEqual([TODAY_QUIZ]);
    logEvent.mockClear();
    await (await get(`/page/${allTok()}?from=home`)).text();
    expect(opened().map((d) => JSON.stringify(d))).toEqual([TODAY_CLASS]);
  });

  test('off: the page with ?from=home is the page without it, and the PDF has no line', async () => {
    await boot();
    const a = await (await get(`/page/${quizTok()}?from=home`)).text();
    const b = await (await get(`/page/${quizTok()}`)).text();
    expect(a.replace(/Updated \d\d:\d\d/, '')).toBe(b.replace(/Updated \d\d:\d\d/, ''));
    await (await get(`/pdf/${quizTok()}`)).arrayBuffer();
    expect(htmlToPdf.mock.calls[0][0]).not.toContain('late-line');
  });

  test('off under events v2: the envelope has neither late_n nor from', async () => {
    await boot({ settings: V2 });
    await (await get(`/page/${quizTok()}?from=home`)).text();
    const [ev] = opened();
    expect(ev).toEqual({ w: 's', ev_v: 2, kid_v: null, kid: null, teacherId: TEACHER, quizId: QUIZ, scope: 'quiz', tab: 'quiz', iab: false, render_ms: expect.any(Number) });
  });

  test('an unreadable switch is off', async () => {
    await boot({ settings: ON });
    // this switch's own read fails (the other switches' reads answer as before)
    require('../../shared/config/supabase').from = (t) => {
      const b = fake.from(t);
      if (t !== 'app_settings') return b;
      const { eq } = b;
      b.eq = (c, v) => (c === 'key' && v === KEY ? Promise.resolve({ data: null, error: { message: 'down' } }) : eq(c, v));
      return b;
    };
    const html = await (await get(`/page/${quizTok()}?from=home`)).text();
    expect(html).not.toContain('late-line');
    expect(opened().map((d) => JSON.stringify(d))).toEqual([TODAY_QUIZ]);
  });
});
