'use strict';
/**
 * Where the evening round meets code it does not own, each proven through the real call:
 *   - the report: scheduleForShareCode on a round's code queues NO 12-hour report; an ordinary code still does;
 *   - the teacher's /quiz list never lists a round (it is the class's, nothing for the teacher to send);
 *   - the standing link's open: web_quiz.class_link_open{class_link_code, via, dh} counted at arrive from the landing's
 *     marker (?f=1 forward, ?from=push reminder, ?from=hub hub), else remembered (the phone played in the class) or
 *     forward; never for a link-preview fetch or the teacher's own visit; the edge puts the marker in the boot JSON;
 *     every path through the real routes: class-link-open-every-path.test.js;
 *   - the reminders slot under the chips (an empty #wq-remind mount, data-src class_link);
 *   - the worker schedules the 16:00 tick on main-queue replicas only.
 * Faked boundaries: Supabase (in memory), Redis (a Map), SQS, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const SQS = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');

const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const DEV = 'PlayedInClassDevice_e1';
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];

let db;
function seed(over = {}) {
  db = {
    app_settings: SWITCHES,
    quizzes: [
      { id: 'qr', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready', created_at: '2026-11-24T11:10:00Z', meta: { source: 'evening_round', class_id: CLASS, round_day: '2026-11-24' } },
      { id: 'qn', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-24T09:00:00Z', meta: { source: 'lp_offer' } },
      { id: 'qm', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-23T09:00:00Z', meta: null },
    ],
    quiz_share_codes: [{ id: 'scr', code: 'RND234', quiz_id: 'qr', class_id: CLASS }, { id: 'scn', code: 'NRM234', quiz_id: 'qn', class_id: CLASS }],
    users: [{ id: TEACHER, name: 'Rifat Test', school_id: null, preferred_language: 'en' }],
    classes: [{ id: CLASS, school_id: null, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_links: [{ code: 'K7Q2MXTRAB', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', list_id: null, is_active: true }],
    quiz_sessions: [{ id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'qn' }],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round')._resetCache(); } catch (_) { /* not on this build */ }
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
  seed();
});

describe('the report never fires for a round', () => {
  const Report = () => require('../../shared/services/quiz/video-quiz-report.service');
  test('a round\'s code: no 12 h report queued, the skip logged', async () => {
    await Report().scheduleForShareCode('scr');
    expect(SQS.queueJob).not.toHaveBeenCalled();
    // the report lane's own predicate (isReportableShareCode) recognises a round and logs its own reason
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_schedule_skipped', { shareCodeId: 'scr', why: 'not_reportable' });
  });
  test('an ordinary code is scheduled exactly as today', async () => {
    await Report().scheduleForShareCode('scn');
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob.mock.calls[0][0]).toBe('scn');
  });
});

test('the teacher\'s /quiz list never carries a round; their own lesson-plan quizzes stay', async () => {
  const List = require('../../shared/services/quiz/transcript-quiz-list.service');
  const got = await List.loadLpQuizzes(TEACHER, 10);
  expect(got.map((q) => q.id).sort()).toEqual(['qm', 'qn']);
});

describe('web_quiz.class_link_open{class_link_code, via, dh}', () => {
  const CL = () => require('../../shared/services/quiz/web-quiz-class-link');
  const opens = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.class_link_open').map(([, f]) => f);
  const DH = require('../../shared/services/quiz/web-quiz-telemetry').deviceHash(DEV);
  test('the landing\'s marker, posted on arrive: ?f=1 forward, ?from=push reminder, ?from=hub hub', async () => {
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV, via: 'forward' });
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV, via: 'reminder' });
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV, via: 'hub' });
    expect(opens()).toEqual([
      { class_link_code: 'K7Q2MXTRAB', via: 'forward', dh: DH }, { class_link_code: 'K7Q2MXTRAB', via: 'reminder', dh: DH }, { class_link_code: 'K7Q2MXTRAB', via: 'hub', dh: DH },
    ]);
  });
  test('never for a link-preview fetch or the teacher\'s own visit; the landing itself counts nothing', async () => {
    await CL().resolve('K7Q2MXTRAB', { preview: true });
    await CL().resolve('K7Q2MXTRAB', { jt: CL().signTeacherPreview('K7Q2MXTRAB') });
    await CL().resolve('K7Q2MXTRAB', {});
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV, jt: CL().signTeacherPreview('K7Q2MXTRAB'), via: 'forward' });
    expect(opens()).toEqual([]);
  });
  test('an unmarked "Whose turn?" arrival is remembered; an unmarked arrival on another phone is forward', async () => {
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV });
    expect(opens()).toEqual([{ class_link_code: 'K7Q2MXTRAB', via: 'remembered', dh: DH }]);
    logEvent.mockClear();
    await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: 'FreshPhoneDeviceRef_01' });
    expect(opens()).toEqual([{ class_link_code: 'K7Q2MXTRAB', via: 'forward', dh: require('../../shared/services/quiz/web-quiz-telemetry').deviceHash('FreshPhoneDeviceRef_01') }]);
  });
  test('the marker words', () => {
    const R = require('../../shared/services/quiz/web-quiz-evening-round');
    expect(R.viaOf({ f: '1' })).toBe('forward');
    expect(R.viaOf({ from: 'fwd' })).toBe('forward');
    expect(R.viaOf({ from: 'push' })).toBe('reminder');
    expect(R.viaOf({ from: 'hub' })).toBe('hub');
    expect(R.viaOf({})).toBeNull();
    expect(R.classLinkOpen('K7Q2MXTRAB', 'nonsense')).toBe(false);
  });
  test('the bot route passes the arrive body\'s via to arrive()', async () => {
    const express = require('express');
    const router = require('../../shared/routes/web-quiz-class-link.routes');
    const app = express();
    app.use(express.json());
    app.use('/cl', router);
    const server = app.listen(0);
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/cl/arrive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'K7Q2MXTRAB', device_ref: DEV, via: 'reminder' }) });
    server.close();
    expect(r.status).toBe(200);
    expect(opens()).toEqual([{ class_link_code: 'K7Q2MXTRAB', via: 'reminder', dh: DH }]);
  });
});

describe('the edge and the page', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../../dashboard/public/wq/class-link.js'), 'utf8');
  const edge = fs.readFileSync(path.join(__dirname, '../../../dashboard/routes/web-quiz-class-link.js'), 'utf8');
  test('the /j/ edge maps the landing\'s marker into the boot JSON (the page posts it on arrive), not into the landing call', () => {
    const Edge = require('../../../dashboard/routes/web-quiz-class-link');
    expect(Edge.viaOfQuery({ f: '1' })).toBe('forward');
    expect(Edge.viaOfQuery({ from: 'push' })).toBe('reminder');
    expect(Edge.viaOfQuery({ from: 'hub' })).toBe('hub');
    expect(Edge.viaOfQuery({ from: 'x' })).toBeNull();
    expect(edge).not.toMatch(/via=\$\{encodeURIComponent\(via\)\}/);
    const html = Edge.renderClassLinkPage({
      lang: 'en', code: 'K7Q2MXTRAB', jt: null, via: 'reminder', origin: 'https://x', assetV: '1', jsV: '1', brand: null, ui: null,
      head: () => '<!doctype html><html><head>', esc: (s) => s, bootJson: (o) => JSON.stringify(o),
    });
    expect(html).toContain('"via":"reminder"');
  });
  test('the page posts the marker on arrive and holds an empty reminders slot under the chips', () => {
    expect(page).toMatch(/B\.via/);
    expect(page).toContain('<div id="wq-remind" data-src="class_link"></div>');
  });
});

test('the worker schedules the evening round tick on main-queue replicas only', () => {
  const S = require('../../workers/evening-round-schedule');
  const timers = [];
  const setTimeoutFn = (fn, ms) => { timers.push(ms); return { unref() {} }; };
  expect(S.scheduleEveningRound({ hasMainQueue: false, setTimeoutFn })).toBeNull();
  expect(S.scheduleEveningRound({ hasMainQueue: true, setTimeoutFn, setIntervalFn: () => ({ unref() {} }) })).not.toBeNull();
  expect(timers).toEqual([S.FIRST_MS]);
  const worker = fs.readFileSync(path.join(__dirname, '../../workers/sqs-worker.js'), 'utf8');
  expect(worker).toMatch(/require\('\.\/evening-round-schedule'\)\.scheduleEveningRound\(\{ worker: w, hasMainQueue: SQSCoachingWorker\._enabledQueues\(\)\.has\('main'\) \}\)/);
});
