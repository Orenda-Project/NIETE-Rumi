'use strict';
/**
 * The home's JSON answers as soon as its slowest read allows: the report gate starts with the other reads (it needs the
 * lessons only), the send-again check is asked in two halves, the lessons' quizzes as soon as the lessons are in and the
 * class report's as soon as it is in (never after an unrelated slow read, the lessons' half never after the report), and the class report is held 60 s per teacher, dropped on any send, share or mark made from the page.
 * The JSON is byte-identical to the base's (tests/first-touch/__goldens__/teacher-home-speed.json, RECORDED ON THE BASE).
 * Same harness as teacher-home.routes.test.js: the in-memory Supabase, /quiz's list stood in for, slow reads delayed.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/first-touch/walk-persona', () => ({}));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Cta = require('../../shared/services/first-touch/maker.cta');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const Data = require('../../shared/services/first-touch/teacher-home.data');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('./maker-fixture');

const GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-speed.json');
const OWN_QUIZ = 'c0000000-0000-4000-8000-0000000000a1';
const OWN_CODE = 'f0000000-0000-4000-8000-0000000000a1';
const SESSION = 'e0000000-0000-4000-8000-0000000000c1';
const AT = '2026-01-05T08:00:00.000Z';
const MS = { report: 300, gate: 200, side: 500, sendable: 100 };
const tokenFor = () => HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const realSendableOwn = Data.sendableOwn;

let srv;
let fake;
let t0;
let log;
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H() });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const at = (what) => { log[what] = Date.now() - t0; };

/** One sent quiz of the teacher's, played by 2; every slow read delayed by MS and its start/finish logged. */
function setup({ report = null } = {}) {
  fake = seedMaker(supabase, { on: true, extra: { coaching_sessions: [], quiz_sessions: [] } });
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true }];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
  fake.db.quizzes.push({
    id: OWN_QUIZ, teacher_id: TEACHER.id, quiz_source: 'transcript', status: 'sent', topic: 'Photosynthesis', subject: 'Science',
    coaching_session_id: SESSION, created_at: AT,
    meta: { student_message: 'Class, play this quiz: https://portal.example/q/ABCDEF', share_code_id: OWN_CODE, share_code: 'ABCDEF' },
  });
  fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'ABCDEF', quiz_id: OWN_QUIZ, teacher_user_id: TEACHER.id, active: true, expires_at: '2099-01-01T00:00:00.000Z', created_at: AT, invited_by_student_id: null });
  const quiz = fake.db.quizzes.find((q) => q.id === OWN_QUIZ);
  const classReport = jest.fn(report || (async () => {
    at('reportStart'); await wait(MS.report); at('reportDone');
    return { quizzes: [{ id: OWN_QUIZ, played: 2, of: 5, date: AT, topic: 'Photosynthesis', source: 'transcript' }] };
  }));
  const realSendable = Data.sendableOwn;
  jest.spyOn(Data, 'sendableOwn').mockImplementation(async (...a) => { at('sendableStart'); await wait(MS.sendable); return realSendable(...a); });
  return {
    List: { ...List, loadLessonPage: jest.fn(async () => { at('lessonsDone'); return { sessions: [{ id: SESSION, created_at: AT, transcript_text: 'x'.repeat(5000), analysis_data: { topic: 'Photosynthesis' } }], quizzes: [quiz], counts: {}, lessons: [] }; }) },
    Report: { ...require('../../shared/services/quiz/teacher-report.data'), classReport },
    Gate: {
      ...Gate,
      teacherReportOn: jest.fn(async () => { at('gateStart'); await wait(MS.gate); return true; }),
      reportUrls: ({ quizId }) => ({ live: `/r/${quizId}/live`, remind: `/r/${quizId}/remind` }),
    },
    Cta: { ...Cta, makerUrl: () => 'https://portal.example/m/fixed', prefillOf: jest.fn(async () => { await wait(MS.side); at('sideDone'); return null; }) },
  };
}
async function boot(deps) {
  const app = express();
  app.use('/api/internal/th', createRouter(deps));
  await new Promise((r) => { srv = app.listen(0, r); });
}
async function home(t = tokenFor()) {
  t0 = Date.now(); log = {};
  const res = await get(`/api/th/home?t=${t}`);
  log.total = Date.now() - t0;
  return { status: res.status, text: await res.text() };
}

afterEach(async () => { jest.restoreAllMocks(); await new Promise((r) => (srv ? srv.close(r) : r())); srv = null; });

describe('the reads start together', () => {
  test('the report gate is asked before the class report is in; the send-again check before the slow side read is in', async () => {
    const deps = setup();
    await boot(deps);
    const out = await home();
    expect(out.status).toBe(200);
    expect(deps.Gate.teacherReportOn).toHaveBeenCalledTimes(1);
    expect(log.gateStart).toBeLessThan(log.reportDone);
    expect(log.sendableStart).toBeLessThan(log.sideDone);
    expect(log.sendableStart).toBeGreaterThanOrEqual(log.lessonsDone); // still after its own inputs
    // ≈ max(report + sendable, side) = 500, never report + gate + sendable after the side read (≥ 800)
    expect(log.total).toBeLessThan(MS.side + MS.gate + MS.sendable - 50);
  });

  test('the JSON is byte-identical to the base\'s for the same reads', async () => {
    const deps = setup();
    await boot(deps);
    const out = await home();
    expect(out.status).toBe(200);
    if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN, out.text);
    expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });

  test('no sent quiz: the report gate is never asked (as before)', async () => {
    const deps = setup();
    fake.db.quizzes.find((q) => q.id === OWN_QUIZ).status = 'draft';
    deps.List.loadLessonPage = jest.fn(async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] }));
    await boot(deps);
    expect((await home()).status).toBe(200);
    expect(deps.Gate.teacherReportOn).not.toHaveBeenCalled();
  });
});

describe('the class report is held 60 s per teacher', () => {
  test('a second open within 60 s reads it once; the same JSON', async () => {
    const deps = setup();
    await boot(deps);
    const a = await home();
    const b = await home();
    expect(deps.Report.classReport).toHaveBeenCalledTimes(1);
    expect(b.text).toBe(a.text);
  });

  test('a send from the page (POST send, a share tap) drops it: the next open reads it again', async () => {
    const deps = setup();
    await boot(deps);
    const t = tokenFor();
    await home(t);
    expect((await post('/api/th/send', { t, kind: 'again', id: OWN_QUIZ })).status).toBe(200);
    await home(t);
    expect(deps.Report.classReport).toHaveBeenCalledTimes(2);
    expect((await post('/api/th/step', { t, step: 'share_tap', kind: 'again', id: OWN_QUIZ, origin: 'again' })).status).toBe(204);
    await home(t);
    expect(deps.Report.classReport).toHaveBeenCalledTimes(3);
  });

  test('a read that began before a send\'s drop is never held: the next open reads again', async () => {
    const deps = setup();
    await boot(deps);
    const t = tokenFor();
    const first = home(t); // its class report is in flight for MS.report
    await wait(50);
    expect((await post('/api/th/send', { t, kind: 'again', id: OWN_QUIZ })).status).toBe(200);
    await first;
    await home(t);
    expect(deps.Report.classReport).toHaveBeenCalledTimes(2);
  });

  test('a read that starts while a send is still writing is not held past the write', async () => {
    const deps = setup();
    const Send = require('../../shared/services/first-touch/teacher-home.send');
    const realAgain = Send.againSend;
    jest.spyOn(Send, 'againSend').mockImplementation(async (...a) => { await wait(MS.report + 300); return realAgain(...a); });
    await boot(deps);
    const t = tokenFor();
    const sending = post('/api/th/send', { t, kind: 'again', id: OWN_QUIZ });
    await wait(50);
    await home(t); // starts after the send's first drop, answers before the write lands
    expect((await sending).status).toBe(200);
    await home(t);
    expect(deps.Report.classReport).toHaveBeenCalledTimes(2);
  });

  test('a failed read is never held', async () => {
    let n = 0;
    const deps = setup({ report: async () => { n += 1; if (n === 1) throw new Error('down'); return { quizzes: [] }; } });
    await boot(deps);
    await home();
    await home();
    await home();
    expect(deps.Report.classReport).toHaveBeenCalledTimes(2);
  });

  test('a read past its budget is never held as its fallback', async () => {
    const budget = Data.REPORT_BUDGET_MS;
    Data.REPORT_BUDGET_MS = 100;
    try {
      const deps = setup({ report: async () => { await wait(1000); return { quizzes: [] }; } });
      await boot(deps);
      await home();
      await home();
      expect(deps.Report.classReport).toHaveBeenCalledTimes(2);
    } finally { Data.REPORT_BUDGET_MS = budget; }
  });
});

/** Two more own sent quizzes the class report shows but the lessons list does not: B can be sent again, C's code is expired. */
const QUIZ_B = 'c0000000-0000-4000-8000-0000000000b2';
const QUIZ_C = 'c0000000-0000-4000-8000-0000000000c3';
function seedReportOnly() {
  [[QUIZ_B, 'f0000000-0000-4000-8000-0000000000b2', 'BBBBBB', '2099-01-01T00:00:00.000Z'], [QUIZ_C, 'f0000000-0000-4000-8000-0000000000c3', 'CCCCCC', '2020-01-01T00:00:00.000Z']]
    .forEach(([id, codeId, code, expires]) => {
      fake.db.quizzes.push({
        id, teacher_id: TEACHER.id, quiz_source: 'transcript', status: 'sent', topic: `Topic ${code}`, subject: 'Science', created_at: AT,
        meta: { student_message: `Class, play this quiz: https://portal.example/q/${code}`, share_code_id: codeId, share_code: code },
      });
      fake.db.quiz_share_codes.push({ id: codeId, code, quiz_id: id, teacher_user_id: TEACHER.id, active: true, expires_at: expires, created_at: AT, invited_by_student_id: null });
    });
}
const reportOnly = () => async () => ({ quizzes: [
    { id: OWN_QUIZ, played: 2, of: 5, date: AT, topic: 'Photosynthesis', source: 'transcript' },
    { id: QUIZ_B, played: 1, of: 5, date: '2026-01-04T08:00:00.000Z', topic: 'Topic BBBBBB', source: 'transcript' },
    { id: QUIZ_C, played: 1, of: 5, date: '2026-01-03T08:00:00.000Z', topic: 'Topic CCCCCC', source: 'transcript' },
  ] });
const rowOf = (text, key) => JSON.parse(text).timeline.find((r) => r.key === key);

describe('the send-again check: the lessons\' half does not wait for the class report', () => {
  test('a slow class report and a slow check overlap: the home answers well before report + check', async () => {
    const was = { ...MS };
    Object.assign(MS, { report: 400, sendable: 250, gate: 0, side: 0 });
    try {
      const deps = setup();
      await boot(deps);
      const out = await home();
      expect(out.status).toBe(200);
      // ≈ max(report, check) = 400, never report then check (≥ 650)
      expect(log.total).toBeLessThan(MS.report + MS.sendable - 50);
      expect(log.sendableStart).toBeLessThan(log.reportDone); // the lessons' half is asked while the report is still out
      expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    } finally { Object.assign(MS, was); }
  });

  test('the class report held near 4 s and the check near 2.5 s (both inside their budgets), the rest fast: the home answers in at most 4.5 s', async () => {
    const was = { ...MS };
    Object.assign(MS, { report: 3900, sendable: 2400, gate: 0, side: 0 });
    try {
      const deps = setup();
      await boot(deps);
      const out = await home();
      expect(out.status).toBe(200);
      // today's chain asks the check only after the report: ≈ 3.9 + 2.4 = 6.3 s
      expect(log.total).toBeLessThanOrEqual(4500);
      expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    } finally { Object.assign(MS, was); }
  }, 20000);

  test('the two halves\' answers are joined: the lessons\' quiz and the report\'s quiz both offer "Send again"; an expired code does not', async () => {
    const deps = setup({ report: reportOnly() });
    seedReportOnly();
    await boot(deps);
    const out = await home();
    expect(out.status).toBe(200);
    expect(rowOf(out.text, 'e0000000-0000-4000-8000-0000000000c1')).toMatchObject({ verb: 'again', id: OWN_QUIZ, sendKind: 'again' });
    expect(rowOf(out.text, `q_${QUIZ_B}`)).toMatchObject({ verb: 'again', id: QUIZ_B, sendKind: 'again' });
    expect(rowOf(out.text, `q_${QUIZ_C}`)).toMatchObject({ verb: null, id: null, sendKind: null });
  });

  test('the report\'s half fails: offered as before, the same JSON as when the whole check fails', async () => {
    const deps = setup({ report: reportOnly() });
    seedReportOnly();
    await boot(deps);
    jest.spyOn(Data, 'sendableOwn').mockImplementation(async (uid, ids, ...rest) => {
      if ((ids || []).includes(QUIZ_B)) throw new Error('down');
      return realSendableOwn(uid, ids, ...rest);
    });
    const half = await home();
    jest.spyOn(Data, 'sendableOwn').mockImplementation(async () => { throw new Error('down'); });
    const whole = await home();
    expect(half.status).toBe(200);
    expect(rowOf(half.text, `q_${QUIZ_C}`)).toMatchObject({ verb: 'again', id: QUIZ_C, sendKind: 'again' }); // offered as before
    expect(half.text).toBe(whole.text);
  });

  test('the lessons\' half fails: offered as before, the same JSON as when the whole check fails', async () => {
    const open = async (failIf) => { // each open on a fresh server and seed: nothing held from the one before
      jest.restoreAllMocks(); if (srv) { await new Promise((r) => srv.close(r)); srv = null; }
      const deps = setup({ report: reportOnly() });
      seedReportOnly();
      await boot(deps);
      jest.spyOn(Data, 'sendableOwn').mockImplementation(async (uid, ids, ...rest) => {
        if (failIf(ids || [])) throw new Error('down');
        return realSendableOwn(uid, ids, ...rest);
      });
      return home();
    };
    const both = await open(() => false);
    const half = await open((ids) => ids.includes(OWN_QUIZ));
    const whole = await open(() => true);
    expect(rowOf(both.text, `q_${QUIZ_C}`)).toMatchObject({ verb: null }); // both halves answer: the expired code is not offered
    expect(half.status).toBe(200);
    expect(rowOf(half.text, `q_${QUIZ_C}`)).toMatchObject({ verb: 'again', id: QUIZ_C, sendKind: 'again' }); // offered as before
    expect(half.text).toBe(whole.text);
  });
});
