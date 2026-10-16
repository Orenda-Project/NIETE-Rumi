'use strict';
/**
 * The teacher's "same child?" decision is answered after it is saved, the report page has a time budget on its base
 * read, and the page's opened event carries how long the page took (events v2 only).
 *
 *   - a 'same' / 'no' / 'undo' POST answers 303 only after decide() has written (merge_log + merged_into), so the
 *     tab the redirect reads never offers the decided pair again
 *   - a refused decision (another teacher's pair, a pair of one child, a failed write) → 303 ?e=1, nothing written
 *   - a class report slower than the page's budget: the page (and the Jugnu tab) answers within the budget, with the
 *     retry line instead of the quiz sections — never "no quizzes"
 *   - teacher_report.opened: with web_quiz_events_v2 on, the v2 envelope plus render_ms and (when the queue service
 *     has queueAge) queue_age_s; with it off, today's object byte for byte
 *   - goldens: with a fast base the class page and the Jugnu tab are byte for byte today's (snapshots written by
 *     today's code)
 *
 * The routes, the report and tab data modules, the page templates, the token and the join-queue service all run for
 * real on an ephemeral port. Faked: Supabase (in-memory, filters applied; a test can slow the class report's base
 * read), Redis (a Map), the loggers and the event-key module's keys. Children are invented "Testwala" fixtures.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-kid'),
  kidOf: (x) => (x ? `k_${String(x).slice(-2)}` : null),
  kid: (x) => (x ? `k_${String(x).slice(-2)}` : null),
}));

const express = require('express');
const { makeFake } = require('./fake-supabase');

const NOW = Date.parse('2026-10-15T09:30:00Z');
const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L2 = 'a0000000-0000-4000-8000-000000000002';
const SC1 = '30000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const at = (iso) => new Date(Date.parse(iso)).toISOString();
const roster = (id, name, list = L1) => ({ id, list_id: list, roll_number: Number(id.slice(-2)), student_name: name, student_name_urdu: null, father_name: null, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, status: 'started', ...extra });

let fake;
let slowBase = 0; // ms: the class report's base read (quizzes with its topic) answers this much later
function seed() {
  fake = makeFake({
    app_settings: [
      { key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' },
      { key: 'web_quiz_identity_canon', value: 'true' }, { key: 'web_quiz_hub', value: 'true' },
    ],
    users: [{ id: T1, preferred_language: 'en' }, { id: T2, preferred_language: 'en' }],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [
      { id: L1, user_id: T1, class_name: 'Grade 3', section: 'B', class_id: C1, is_active: true },
      { id: L2, user_id: T2, class_name: 'Grade 4', section: 'A', class_id: null, is_active: true },
    ],
    class_enrollments: [5, 6].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [roster(r(5), 'Hamza Testwala'), roster(r(6), 'Omar Testwala'), roster(r(9), 'Bilal Testwala', L2),
      loose(c(3), 'Omar Testwala'), loose(c(33), 'Omar  Testwala'), loose(c(7), 'Hamza')],
    quizzes: [{ id: Q1, teacher_id: T1, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at('2026-10-14T03:00:00Z'), meta: { share_code_id: SC1 } }],
    quiz_share_codes: [{ id: SC1, code: 'AB12CD', quiz_id: Q1, teacher_user_id: T1, class_id: null, active: true, expires_at: null, language: 'en', created_at: at('2026-10-14T03:00:00Z') }],
    quiz_sessions: [sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }), sess('s33', c(33), { device_ref: 'dev-9' }), sess('s7', c(7), { parent_phone: P(7) })],
    quiz_questions: [], quiz_answers: [],
    web_quiz_challenge_runs: [], child_rungs: [], child_phone_bindings: [],
    merge_log: [],
  });
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    if (slowBase && t === 'quizzes') {
      // the class report's base read (its quizzes select names the topic); the queue's own quizzes read stays fast
      const select = b.select;
      let cols = '';
      b.select = (x, o) => { cols = String(x || ''); return select.call(b, x, o); };
      b.then = (res, rej) => (/topic/.test(cols) ? later(slowBase) : Promise.resolve()).then(() => then.call(b, res, rej));
    }
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}

let server;
let base;
let Token;
let Routes;
let logger;
async function boot() {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  slowBase = 0;
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
  seed();
  Token = require('../../../shared/services/quiz/teacher-report-token');
  logger = require('../../../shared/utils/logger');
  Routes = require('../../../shared/routes/teacher-report-internal.routes');
  const app = express();
  app.use('/api/internal/tr', Routes);
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}

const tok = (teacherId = T1) => Token.signTeacherReport({ teacherId });
const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const later = (ms, v) => new Promise((ok) => { setTimeout(() => ok(v), ms); });
const student = (x) => fake.db.students.find((s) => s.id === x);
const writes = () => fake.calls.filter((x) => x.op !== 'select').map((x) => `${x.op}:${x.table}`);
const SAME = { loose_id: c(3), candidate_id: r(6), decision: 'same', class: L1 };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterEach(async () => {
  jest.useRealTimers();
  if (server) await new Promise((ok) => server.close(ok));
  server = null;
});

/** The tab's queue rows for this loose child: 'open' (Same / Different / Not sure), 'undo' (decided), or null (none). */
function rowOf(html, looseId) {
  const row = html.split('<div class="jq-r">').slice(1).find((x) => x.includes(`name="loose_id" value="${looseId}"`));
  if (!row) return null;
  return /value="undo"/.test(row) ? 'undo' : (/value="same"/.test(row) ? 'open' : '?');
}
const tabHtml = async () => { const res = await get(`/page/${tok()}?tab=jugnu&class=${L1}`); expect(res.status).toBe(200); return res.text(); };

/** decide() for real, answering this much later (the queue recomputing on a large class). */
function slowDecide(ms) {
  const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
  const real = Queue.decide;
  return jest.spyOn(Queue, 'decide').mockImplementation(async (args) => { await later(ms); return real(args); });
}
const backTo = (token = tok()) => `/r/${encodeURIComponent(token)}?tab=jugnu&class=${L1}`;

describe('the decision POST answers after it is saved', () => {
  test("same: the 303 arrives after merge_log has the row; the redirect's tab read does not show the pair", async () => {
    await boot();
    expect(rowOf(await tabHtml(), c(3))).toBe('open'); // offered before the tap
    const decide = slowDecide(300);
    const res = await post(`/queue/${tok()}`, SAME);
    // at the moment the 303 is in hand, the decision is already written
    expect(fake.db.merge_log).toEqual([expect.objectContaining({ loose_id: c(3), candidate_id: r(6), teacher_id: T1, decision: 'same', source: 'queue' })]);
    expect(student(c(3))).toMatchObject({ merged_into: r(6), status: 'merged' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(backTo());
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(decide).toHaveBeenCalledWith({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' });
    const html = await tabHtml(); // the redirect's read
    expect(rowOf(html, c(3))).not.toBe('open');
    expect(html.split('<div class="jq-r">').slice(1).filter((x) => x.includes(`value="${c(3)}"`) && /value="same"/.test(x))).toEqual([]);
  }, 10000);

  test("no: the 303 arrives after merge_log has the row; the redirect's tab read does not show the pair", async () => {
    await boot();
    expect(rowOf(await tabHtml(), c(3))).toBe('open');
    slowDecide(300);
    const res = await post(`/queue/${tok()}`, { ...SAME, decision: 'no' });
    expect(fake.db.merge_log).toEqual([expect.objectContaining({ loose_id: c(3), candidate_id: r(6), teacher_id: T1, decision: 'no' })]);
    expect(student(c(3)).merged_into).toBeNull();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(backTo());
    expect(rowOf(await tabHtml(), c(3))).not.toBe('open');
  }, 10000);

  test('undo: the 303 arrives after the undo row is written', async () => {
    await boot();
    expect((await post(`/queue/${tok()}`, SAME)).status).toBe(303);
    expect(student(c(3)).merged_into).toBe(r(6));
    slowDecide(300);
    const res = await post(`/queue/${tok()}`, { ...SAME, decision: 'undo' });
    expect(fake.db.merge_log.map((x) => x.decision)).toEqual(['same', 'undo']);
    expect(student(c(3)).merged_into).toBeNull();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(backTo());
  }, 10000);
});

describe('a refused decision keeps ?e=1', () => {
  test("a refused decision (another teacher's pair; a self pair) → 303 ?e=1, nothing written", async () => {
    await boot();
    const foreign = await post(`/queue/${tok(T2)}`, SAME); // T2's token on T1's pair: decide() says not_your_roster
    expect(foreign.status).toBe(303);
    expect(foreign.headers.get('location')).toBe(`/r/${encodeURIComponent(tok(T2))}?tab=jugnu&class=${L1}&e=1`);
    const self = await post(`/queue/${tok()}`, { ...SAME, candidate_id: c(3) }); // a pair of one child
    expect(self.status).toBe(303);
    expect(self.headers.get('location')).toBe(`${backTo()}&e=1`);
    const nothing = await post(`/queue/${tok()}`, { ...SAME, decision: 'undo' }); // nothing to undo
    expect(nothing.headers.get('location')).toBe(`${backTo()}&e=1`);
    expect(writes()).toEqual([]);
    expect(fake.db.merge_log).toEqual([]);
    expect(student(c(3)).merged_into).toBeNull();
  }, 10000);

  test('a failed write → 303 ?e=1, logged without a name', async () => {
    await boot();
    const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
    jest.spyOn(Queue, 'decide').mockRejectedValue(new Error('connection reset'));
    const res = await post(`/queue/${tok()}`, SAME);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${backTo()}&e=1`);
    expect(writes()).toEqual([]);
    const lines = logger.logToFile.mock.calls.filter((x) => /did not save/.test(String(x[0])));
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).not.toMatch(/Testwala|Omar/);
  }, 10000);
});

describe('teacher_report.opened: render_ms and queue_age_s under events v2', () => {
  const opened = () => require('../../../shared/utils/structured-logger').logEvent.mock.calls.filter(([n]) => n === 'teacher_report.opened').map(([, d]) => d);
  const v2On = () => fake.db.app_settings.push({ key: 'web_quiz_events_v2', value: 'true' });
  beforeEach(() => { delete process.env.WEB_QUIZ_KID_KEY_V; });

  test('with web_quiz_events_v2 off, the event equals today\'s object byte for byte, and no timing headers', async () => {
    await boot();
    const res = await get(`/page/${tok()}`);
    expect(res.status).toBe(200);
    await res.text();
    expect(opened().map((d) => JSON.stringify(d))).toEqual([`{"teacherId":"${T1}","quizId":null,"scope":"all","tab":"class","iab":false}`]);
    expect(res.headers.get('x-render-ms')).toBeNull();
    expect(res.headers.get('x-queue-age')).toBeNull();
  }, 10000);

  test('with web_quiz_events_v2 on, teacher_report.opened carries render_ms (integer ≥ 0) and, when the queue service has queueAge, queue_age_s', async () => {
    await boot();
    v2On();
    const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
    expect(typeof Queue.queueAge).not.toBe('function'); // not exported today: the field is absent
    let res = await get(`/page/${tok()}?tab=jugnu&class=${L1}`);
    expect(res.status).toBe(200);
    await res.text();
    let [ev] = opened();
    expect(ev).toEqual({ w: 's', ev_v: 2, kid_v: null, kid: null, teacherId: T1, quizId: null, scope: 'all', tab: 'jugnu', iab: false, render_ms: expect.any(Number) });
    expect(Number.isInteger(ev.render_ms) && ev.render_ms >= 0).toBe(true);
    expect('queue_age_s' in ev).toBe(false);
    expect(res.headers.get('x-render-ms')).toBe(String(ev.render_ms));
    expect(res.headers.get('x-queue-age')).toBeNull();

    // the queue service with queueAge: its answer, as an integer, in the event and the header
    Queue.queueAge = jest.fn(async () => 86400.6);
    require('../../../shared/utils/structured-logger').logEvent.mockClear();
    res = await get(`/page/${tok()}`);
    await res.text();
    [ev] = opened();
    expect(Queue.queueAge).toHaveBeenCalledWith(T1);
    expect(ev).toEqual({ w: 's', ev_v: 2, kid_v: null, kid: null, teacherId: T1, quizId: null, scope: 'all', tab: 'class', iab: false, render_ms: expect.any(Number), queue_age_s: 86401 });
    expect(Number.isInteger(ev.render_ms) && ev.render_ms >= 0).toBe(true);
    expect(res.headers.get('x-queue-age')).toBe('86401');

    // queueAge answering null (an empty queue): the field is absent
    Queue.queueAge = jest.fn(async () => null);
    require('../../../shared/utils/structured-logger').logEvent.mockClear();
    res = await get(`/page/${tok()}`);
    await res.text();
    [ev] = opened();
    expect('queue_age_s' in ev).toBe(false);
    expect(res.headers.get('x-queue-age')).toBeNull();
    delete Queue.queueAge;
  }, 10000);

  test('render_ms counts the slow base read (the route start to just before the send)', async () => {
    await boot();
    v2On();
    Routes.BASE_BUDGET_MS = 400;
    slowBase = 250; // inside the budget: the page waits for it
    const res = await get(`/page/${tok()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Plants');
    const [ev] = opened();
    expect(ev.render_ms).toBeGreaterThanOrEqual(240);
    expect(ev.render_ms).toBeLessThan(3000);
  }, 10000);
});

describe('the report base has a budget', () => {
  test('a report base slower than the budget → the page answers within the budget, with the retry line', async () => {
    await boot();
    Routes.BASE_BUDGET_MS = 100;
    slowBase = 2500; // the class report's first read
    const t0 = performance.now();
    const res = await get(`/page/${tok()}`);
    const html = await res.text();
    const took = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(took).toBeLessThan(1500);
    expect(html).toContain('All my classes');
    expect(html).toContain('Please try again in a little while.');
    expect(html).not.toContain('No quizzes sent in the last 60 days');
    expect(html).not.toContain('Plants');
    await later(2600); // the late read settles; nothing unhandled
  }, 10000);

  test('the Jugnu tab with a slow base answers within the budget and draws the tab', async () => {
    await boot();
    Routes.BASE_BUDGET_MS = 100;
    slowBase = 2500;
    const t0 = performance.now();
    const res = await get(`/page/${tok()}?tab=jugnu&class=${L1}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(html).toContain('Sorted by name. No scores, no positions.');
    await later(2600);
  }, 10000);

  test('the budget is 5000 ms, inside the edge\'s 10 s', async () => {
    await boot();
    expect(Routes.BASE_BUDGET_MS).toBe(5000);
  });
});

describe('goldens: a fast base renders today\'s page byte for byte', () => {
  test('the class page', async () => {
    await boot();
    const res = await get(`/page/${tok()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatchSnapshot();
  });

  test('the Jugnu tab', async () => {
    await boot();
    const res = await get(`/page/${tok()}?tab=jugnu&class=${L1}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatchSnapshot();
  });
});
