'use strict';
/**
 * The class round under the sampling ruling: the draw object's columns and windows,
 * a child's "not today" (declined) on the teacher's screen only, pause and resume with the order kept and no
 * self-close, k = 10 counted positions as a server flag, the teacher's "Not this term", the window on every claim,
 * the invitation stub with its template name and rate, no second round run for a child in a term.
 * Real round service, routes, tokens, Challenge; faked: Supabase (in-memory), the event logger, the hashed-key module,
 * WhatsApp and the ledger (virtual stand-ins; asserted never called).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendTextMessage: jest.fn(), sendInteractiveMessage: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/web-quiz-ledger', () => ({ recordSend: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${String(id).slice(-2)})`, cls: (id) => `cls(${String(id).slice(-2)})`, envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}), { virtual: true });

const express = require('express');
const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const CLASS = 'c0000000-0000-4000-8000-0000000000c1';
const SCHOOL = 'd0000000-0000-4000-8000-0000000000d1';
const ROUND = '0123456789abcdef';
const DAY = 86400000;
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const NAMES = ['Asha Testwala', 'Bilal Testwala', 'Chanda Testwala', 'Dawood Testwala', 'Esha Testwala', 'Faraz Testwala'];
const ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_round', value: true },
  { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true },
];
const iso = (ms) => new Date(ms).toISOString();

let DB;
function seed({ settings = ON, n = NAMES.length, draw = {} } = {}) {
  const now = Date.now();
  DB = {
    app_settings: settings.map((s) => ({ ...s })),
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [], quiz_share_codes: [], student_lists: [], quiz_sessions: [], quiz_questions: [], quiz_answers: [],
    schools: [{ id: SCHOOL, name: 'School A', region: 'Sector One', is_active: true, is_probable_test: false }],
    classes: [{ id: CLASS, school_id: SCHOOL, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_teachers: [{ id: 'ct1', class_id: CLASS, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    students: Array.from({ length: n }, (_, i) => ({ id: kid(i + 1), student_name: NAMES[i] || `Kid${i + 1} Testwala`, is_active: true })),
    class_enrollments: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, class_id: CLASS, student_id: kid(i + 1), roll_number: i + 1, is_active: true })),
    class_round_draws: [{ id: 'e0000000-0000-4000-8000-0000000000e1', round: ROUND, term_code: require('../../../shared/services/quiz/web-quiz-class-round-sampler').termCode(now),
      class_id: CLASS, stratum: 'Sector One|G23', N_h: 10, n_h: 2, p_incl: 0.2, seed: 7, weights_version: 'v1', roster_k: n,
      window_start: iso(now - 2 * DAY), window_end: iso(now + 26 * DAY), k_counted: 10, order_arm: 'round_first', week_start: null, week_end: null,
      drawn_at: iso(now - 9 * DAY), accepted_at: null, declined_at: null, started_at: null, ran_at: null, finished_at: null,
      children_present: null, children_played: null, state: null, ...draw }],
    child_identity: [],
    web_quiz_challenge_runs: [],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
}

let server; let base; let Token; let logEvent; let Round; let Page;
beforeEach(async () => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed();
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Round = require('../../../shared/services/quiz/web-quiz-class-round');
  Page = require('../../../shared/templates/class-round.page');
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

const tok = () => Token.signTeacherReport({ teacherId: TEACHER });
const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const post = (p, body = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === `web_quiz.${name}`).map((c) => c[1]);
const draw = () => DB.class_round_draws[0];
const HOLD = { act: 'hold', hold: '700' };
const first = (id) => NAMES[Number(id.slice(-2)) - 1].split(' ')[0];

describe('§6(a) declined: a child\'s "not today", on the teacher\'s screen only', () => {
  test('the control renders only when its copy key exists (jg.round.t_declined)', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    expect(await (await get(`/round/${tok()}`)).text()).not.toMatch(/\/round\/[^"]+\/declined/);
    Page.T.en.tDeclined = 'Not today';
    expect(await (await get(`/round/${tok()}`)).text()).toMatch(/action="\/r\/[^"]+\/round\/declined/);
  });

  test('declined: marked, kept in place, never asked twice, never called; class_round_declined{round, cls, pos} once', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/declined`, { pos: '0' });
    await post(`/round/${tok()}/declined`, { pos: '0' });
    await post(`/round/${tok()}/absent`, { pos: '0' });
    expect(draw().state.order.map((p) => p.id)).toEqual(order);
    expect(draw().state.order[0].s).toBe('declined');
    expect(events('class_round_declined')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)', pos: 0 }]);
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(1);
  });
});

describe('§6(c) absent and declined never on the child\'s screens', () => {
  test('the child view and the hand-back list neither an absent nor a declined child, and strike nothing', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/absent`, { pos: '1' });
    await post(`/round/${tok()}/declined`, { pos: '2' });
    await post(`/round/${tok()}/next`, HOLD);
    for (const html of [await (await get(`/round/${tok()}`)).text(), (await Round.childFinished(ROUND, order[0], 'run-0')) && await (await get(`/round/${tok()}`)).text()]) {
      expect(html).not.toContain(first(order[1]));
      expect(html).not.toContain(first(order[2]));
      expect(html).not.toMatch(/class="[^"]*(absent|declined)/);
      expect(html).not.toMatch(/line-through/);
    }
  });
});

describe('§6(b) pause and resume; no self-close', () => {
  test('every position settled does not close the round; the long-press with nobody left does: finished gains declined_k, counted_k', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/absent`, { pos: '4' });
    await post(`/round/${tok()}/declined`, { pos: '5' });
    for (let i = 0; i < 4; i += 1) {
      await post(`/round/${tok()}/next`, HOLD);
      await Round.childFinished(ROUND, order[i], `run-${i}`);
      await post(`/round/${tok()}/teacher`, HOLD);
    }
    expect(draw().finished_at).toBeNull();
    expect(events('class_round_finished')).toEqual([]);
    expect((await get(`/round/${tok()}`)).status).toBe(200);
    await post(`/round/${tok()}/next`, { act: 'tap' });
    expect(draw().finished_at).toBeNull();
    const res = await post(`/round/${tok()}/next`, HOLD);
    expect(res.status).toBe(303);
    expect(draw().finished_at).toBeTruthy();
    const fin = events('class_round_finished');
    expect(fin).toHaveLength(1);
    expect(Object.keys(fin[0]).sort()).toEqual(['absent_k', 'cls', 'counted_k', 'declined_k', 'done_k', 'ev_v', 'mins', 'present_k', 'roster_k', 'round', 'w']);
    expect(fin[0]).toMatchObject({ roster_k: 6, present_k: 5, done_k: 4, absent_k: 1, declined_k: 1, counted_k: 4 });
    expect(draw().children_present).toBe(5);
    expect(draw().children_played).toBe(4);
  });

  test('pause keeps the order and refuses "next"; resume continues; class_round_paused{round, cls, done_k}; the controls render only with their keys', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    await Round.childFinished(ROUND, order[0], 'run-0');
    await post(`/round/${tok()}/teacher`, HOLD);
    let html = await (await get(`/round/${tok()}`)).text();
    expect(html).not.toMatch(/round\/pause|round\/resume/);
    Page.T.en.tPause = 'Pause for today';
    Page.T.en.tResume = 'Carry on';
    html = await (await get(`/round/${tok()}`)).text();
    expect(html).toMatch(/action="\/r\/[^"]+\/round\/pause/);
    await post(`/round/${tok()}/pause`);
    expect(draw().state.paused).toBe(true);
    expect(events('class_round_paused')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)', done_k: 1 }]);
    expect(await (await get(`/round/${tok()}`)).text()).toMatch(/action="\/r\/[^"]+\/round\/resume/);
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.turn).toBeNull();
    await post(`/round/${tok()}/resume`);
    expect(draw().state.paused).toBe(false);
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(1);
    expect(draw().state.order.map((p) => p.id)).toEqual(order);
  });
});

describe('§6(g) the window: closed or outside it, nothing opens', () => {
  test('after window_end the round is closed as it stands (finished written once) and every claim is refused', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    await post(`/round/${tok()}/next`, HOLD);
    const id = draw().state.order[0].id;
    const t = Round.turnToken(ROUND, id);
    expect(await Round.entryOf(require('../../../shared/services/quiz/web-quiz-token').verify(t, 'r'))).toBeTruthy();
    draw().window_end = iso(Date.now() - 1000);
    expect(await Round.entryOf(require('../../../shared/services/quiz/web-quiz-token').verify(t, 'r'))).toBeNull();
    expect(await Round.runColumns(ROUND, id, 'bigger')).toBeNull();
    expect((await get(`/round/${tok()}`)).status).toBe(404);
    expect(draw().finished_at).toBeTruthy();
    expect(events('class_round_finished')).toHaveLength(1);
    await get(`/round/${tok()}`);
    expect(events('class_round_finished')).toHaveLength(1);
  });

  test('before window_start: no card, no round page, no start', async () => {
    seed({ draw: { window_start: iso(Date.now() + DAY), window_end: iso(Date.now() + 29 * DAY) } });
    expect(await Round.cardFor(TEACHER, { lang: 'en', token: 'x' })).toBe('');
    expect((await get(`/round/${tok()}`)).status).toBe(404);
    expect(await Round.start(TEACHER)).toBeNull();
  });
});

describe('§6(e) k = 10 counted positions, decided by the server', () => {
  test('positions 1–10 are class_round, later ones practice; via class_round on all; no position on the row', async () => {
    seed({ n: 12 });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    expect(order).toHaveLength(12);
    for (let i = 0; i < 12; i += 1) {
      await post(`/round/${tok()}/next`, HOLD);
      const cols = await Round.runColumns(ROUND, order[i], 'bigger');
      expect(cols).toMatchObject({ mode: i < 10 ? 'class_round' : 'practice', via: 'class_round' });
      expect(Object.keys(cols)).not.toEqual(expect.arrayContaining(['pos']));
      expect(JSON.stringify(cols)).not.toMatch(/"pos"|"position"/);
      await Round.childFinished(ROUND, order[i], `run-${i}`);
      await post(`/round/${tok()}/teacher`, HOLD);
    }
    await post(`/round/${tok()}/next`, HOLD);
    expect(events('class_round_finished')[0]).toMatchObject({ done_k: 12, counted_k: 10 });
  });

  test('k comes from the draw row (k_counted)', async () => {
    seed({ draw: { k_counted: 2 } });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/absent`, { pos: '0' });
    await post(`/round/${tok()}/next`, HOLD);
    expect((await Round.runColumns(ROUND, order[1], 'bigger')).mode).toBe('class_round');
    await Round.childFinished(ROUND, order[1], 'r1');
    await post(`/round/${tok()}/teacher`, HOLD);
    await post(`/round/${tok()}/next`, HOLD);
    expect((await Round.runColumns(ROUND, order[2], 'bigger')).mode).toBe('practice');
  });
});

describe('§6(f) "Not this term" on the card', () => {
  test('the control renders only when jg.round.t_not_this_term exists; one tap sets declined_at, one event, no message, no card after', async () => {
    expect(await Round.cardFor(TEACHER, { lang: 'en', token: 'tk' })).not.toMatch(/not-this-term/);
    Page.T.en.tNotThisTerm = 'Not this term';
    expect(await Round.cardFor(TEACHER, { lang: 'en', token: 'tk' })).toMatch(/action="\/r\/tk\/round\/not-this-term/);
    const res = await post(`/round/${tok()}/not-this-term`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/r\/[^/?]+\?tab=class/);
    expect(draw().declined_at).toBeTruthy();
    expect(draw().state).toBeNull();
    expect(events('class_round_class_declined')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)' }]);
    expect(await Round.cardFor(TEACHER, { lang: 'en', token: 'tk' })).toBe('');
    expect((await get(`/round/${tok()}`)).status).toBe(404);
    Object.values(require('../../../shared/services/whatsapp.service')).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(require('../../../shared/services/quiz/web-quiz-ledger').recordSend).not.toHaveBeenCalled();
  });

  test('once started, "Not this term" changes nothing', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    await post(`/round/${tok()}/not-this-term`);
    expect(draw().declined_at).toBeNull();
    expect(events('class_round_class_declined')).toEqual([]);
  });
});
