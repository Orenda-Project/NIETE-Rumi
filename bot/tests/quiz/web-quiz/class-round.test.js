'use strict';
/**
 * The once-a-term class round in a locked mode on the teacher's phone (switch web_quiz_class_round, parent
 * web_quiz_challenge_v2, its parent web_quiz_challenge). The real report routes on an ephemeral port, the real round
 * service, the real tokens and pages. Faked: Supabase (an in-memory client that applies filters), the event logger,
 * and the hashed-key module (not on this base yet; a virtual stand-in that marks what it hashed).
 *
 * The rules: the roster order is server-random and fixed at start; absent is marked, never skipped; done children
 * stay ticked on the child's screen; "next child" and the way back to the teacher's screen need a long-press; the
 * child's screen never leads back to the teacher's; nothing is written to the teacher's browser; every event carries
 * exactly the contract's fields; off, every round route is the report's own 404.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${String(id).slice(-2)})`,
  cls: (id) => `cls(${String(id).slice(-2)})`,
  envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./class-round-strict-fake');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER_TEACHER = '11111111-1111-4111-8111-1111111111ff';
const CLASS = 'c0000000-0000-4000-8000-0000000000c1';
const SCHOOL = 'd0000000-0000-4000-8000-0000000000d1';
const DRAW = 'e0000000-0000-4000-8000-0000000000e1';
const ROUND = '0123456789abcdef';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const NAMES = ['Asha Testwala', 'Bilal Testwala', 'Chanda Testwala', 'Dawood Testwala', 'Esha Testwala', 'Faraz Testwala'];
const ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_round', value: true },
  { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true },
];

let DB;
function seed(settings = ON, { drawState = null, started = null } = {}) {
  DB = {
    app_settings: settings.map((s) => ({ ...s })),
    users: [{ id: TEACHER, preferred_language: 'en' }, { id: OTHER_TEACHER, preferred_language: 'en' }],
    quizzes: [], quiz_share_codes: [], student_lists: [], quiz_sessions: [], quiz_questions: [], quiz_answers: [],
    schools: [{ id: SCHOOL, name: 'School A', region: 'Sector One', is_active: true, is_probable_test: false }],
    classes: [{ id: CLASS, school_id: SCHOOL, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_teachers: [{ id: 'ct1', class_id: CLASS, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    students: NAMES.map((n, i) => ({ id: kid(i + 1), student_name: n, is_active: true })),
    class_enrollments: NAMES.map((_, i) => ({ id: `e${i}`, class_id: CLASS, student_id: kid(i + 1), roll_number: i + 1, is_active: true })),
    class_round_draws: [{ id: DRAW, round: ROUND, term_code: '2026-27b', class_id: CLASS, stratum: 'Sector One|G23', roster_k: NAMES.length,
      window_start: new Date(Date.now() - 2 * 86400000).toISOString(), window_end: new Date(Date.now() + 26 * 86400000).toISOString(), k_counted: 10, declined_at: null, accepted_at: null,
      drawn_at: '2026-10-10T05:00:00Z', started_at: started, ran_at: null, finished_at: null, children_present: null, children_played: null, state: drawState }],
    child_identity: [],
    web_quiz_challenge_runs: [],
  };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake), rpc: fake.rpc });
}

let server; let base; let Token; let logEvent; let Round;
async function boot() {
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Round = require('../../../shared/services/quiz/web-quiz-class-round');
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}
beforeEach(async () => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed();
  await boot();
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

const tok = (teacherId = TEACHER) => Token.signTeacherReport({ teacherId });
const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const post = (p, body = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === `web_quiz.${name}`).map((c) => c[1]);
const draw = () => DB.class_round_draws[0];
const HOLD = { act: 'hold', hold: '700' };
// A seeded generator, so a test can pin an order (mulberry32).
const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('server-random order', () => {
  test('the order is a shuffle of the active roster from the injected generator; two starts of two rounds are independent; fixed after start', async () => {
    const ids = NAMES.map((_, i) => kid(i + 1));
    const a = Round.shuffle(ids, seeded(1));
    const b = Round.shuffle(ids, seeded(2));
    expect([...a].sort()).toEqual([...ids].sort());
    expect(a).not.toEqual(b);
    expect(Round.shuffle(ids, seeded(1))).toEqual(a);

    await Round.start(TEACHER, { rng: seeded(1) });
    const first = draw().state.order.map((p) => p.id);
    expect(first).toEqual(a);
    await Round.start(TEACHER, { rng: seeded(2) }); // a second Start never reshuffles
    expect(draw().state.order.map((p) => p.id)).toEqual(first);
    expect(draw().started_at).toBeTruthy();
  });

  test('without an injected generator the order comes from crypto (no Math.random)', async () => {
    const spy = jest.spyOn(Math, 'random');
    await Round.start(TEACHER);
    expect(spy).not.toHaveBeenCalled();
    expect(draw().state.order).toHaveLength(NAMES.length);
    spy.mockRestore();
  });

  test('POST start through the route: 303 back to the round page, class_round_started{round, cls, present_k} exactly', async () => {
    const res = await post(`/round/${tok()}/start`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/r\/[^/]+\/round/);
    expect(events('class_round_started')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)', present_k: NAMES.length }]);
  });
});

describe('absent is marked, never skipped', () => {
  test('absent → status absent, the position kept, the child still on the list; class_round_absent{round, cls, pos}', async () => {
    await Round.start(TEACHER, { rng: seeded(3) });
    const order = draw().state.order.map((p) => p.id);
    const res = await post(`/round/${tok()}/absent`, { pos: '1' });
    expect(res.status).toBe(303);
    const st = draw().state;
    expect(st.order.map((p) => p.id)).toEqual(order);
    expect(st.order[1].s).toBe('absent');
    expect(st.order).toHaveLength(NAMES.length);
    expect(events('class_round_absent')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)', pos: 1 }]);
    const html = await (await get(`/round/${tok()}`)).text();
    const absentName = NAMES[Number(order[1].slice(-2)) - 1].split(' ')[0];
    expect(html).toContain(absentName);
    expect(html).toMatch(/class="[^"]*absent/);
  });

  test('"next child" passes over an absent position (it stays marked) and calls the next one in the order', async () => {
    await Round.start(TEACHER, { rng: seeded(3) });
    await post(`/round/${tok()}/absent`, { pos: '0' });
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(1);
    expect(draw().state.order[0].s).toBe('absent');
  });
});

describe('the long-press', () => {
  test('"next child" without the long-press action is refused: no turn opens', async () => {
    await Round.start(TEACHER, { rng: seeded(4) });
    for (const body of [{}, { act: 'tap' }, { act: 'hold', hold: '120' }, { act: 'hold', hold: 'x' }]) {
      await post(`/round/${tok()}/next`, body);
      expect(draw().state.cur).toBeNull();
    }
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(0);
  });

  test('during a child turn the teacher view is refused: GET renders the child view, absent/next are refused, only the long-press returns', async () => {
    await Round.start(TEACHER, { rng: seeded(5) });
    await post(`/round/${tok()}/next`, HOLD);
    const html = await (await get(`/round/${tok()}?view=teacher`)).text();
    expect(html).toContain("'s turn");
    expect(html).not.toContain('Mark absent');
    expect(html).not.toMatch(/\d+ of \d+ done/);
    await post(`/round/${tok()}/absent`, { pos: '3' });
    expect(draw().state.order[3].s).toBe('todo');
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(0);
    await post(`/round/${tok()}/teacher`, { act: 'tap' });
    expect(draw().state.turn).toBe('child');
    await post(`/round/${tok()}/teacher`, HOLD);
    expect(draw().state.turn).toBeNull();
    expect(await (await get(`/round/${tok()}`)).text()).toContain('Mark absent');
  });

  test('the child view replaces its history entry and traps Back (the teacher view is never one Back away)', async () => {
    await Round.start(TEACHER, { rng: seeded(5) });
    await post(`/round/${tok()}/next`, HOLD);
    const html = await (await get(`/round/${tok()}`)).text();
    expect(html).toMatch(/history\.replaceState/);
    expect(html).toMatch(/popstate/);
  });
});

describe('the child view', () => {
  // IDENTITY §2 / L11: a screen the child holds never names another child (the list and the ticks are the teacher's).
  const visible = (html) => html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const nameOf = (id) => NAMES[Number(id.slice(-2)) - 1];
  const noOtherChild = (html, self) => {
    const text = visible(html);
    for (const n of NAMES.filter((x) => x !== self)) {
      expect(text).not.toContain(n.split(' ')[0]);
      expect(text).not.toContain(n.split(' ')[1]);
    }
  };

  test.each(['en', 'ur'])('no other child\'s name on a turn screen, only "<name>\'s turn", the assent line and the hand-back hold; no count (%s)', async (lang) => {
    await Round.start(TEACHER, { rng: seeded(6) });
    const order = draw().state.order.map((p) => p.id);
    for (let i = 0; i < 2; i += 1) {
      await post(`/round/${tok()}/next`, HOLD);
      await Round.childFinished(ROUND, order[i], `run-${i}`);
      await post(`/round/${tok()}/teacher`, HOLD);
    }
    await post(`/round/${tok()}/next`, HOLD);
    const html = await (await get(`/round/${tok()}?lang=${lang}`)).text();
    const Page = require('../../../shared/templates/class-round.page');
    const C = Page.T[lang];
    const self = nameOf(order[2]);
    expect(visible(html)).toContain(self.split(' ')[0]);
    expect(html).toContain(C.cAssent);
    expect(html).toContain(C.cBack);
    expect(html).not.toContain(C.cStill);
    expect(html).not.toContain(C.cDone);
    expect(html).not.toMatch(/<li\b/);
    noOtherChild(html, self);
    expect(visible(html)).not.toMatch(/\d/);
  });

  test.each(['en', 'ur'])('no other child\'s name on the hand-back screen: the hand-back line and the hold only (%s)', async (lang) => {
    await Round.start(TEACHER, { rng: seeded(6) });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    await Round.childFinished(ROUND, order[0], 'run-0');
    await post(`/round/${tok()}/teacher`, HOLD);
    await post(`/round/${tok()}/next`, HOLD);
    await Round.childFinished(ROUND, order[1], 'run-1');
    const html = await (await get(`/round/${tok()}?lang=${lang}`)).text();
    const C = require('../../../shared/templates/class-round.page').T[lang];
    expect(html).toContain(C.cHandback);
    expect(html).toContain(C.cBack);
    expect(html).not.toContain(C.cStill);
    expect(html).not.toContain(C.cDone);
    expect(html).not.toMatch(/<li\b/);
    noOtherChild(html, null);
  });

  test('the child-mode input carries no other child: the service hands the turn and hand-back screens no list', async () => {
    const Page = require('../../../shared/templates/class-round.page');
    const spy = jest.spyOn(Page, 'renderRound');
    await Round.start(TEACHER, { rng: seeded(6) });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    await get(`/round/${tok()}`);
    await Round.childFinished(ROUND, order[0], 'run-0');
    await get(`/round/${tok()}`);
    const childCalls = spy.mock.calls.filter(([v]) => v.mode === 'child' || v.mode === 'handback');
    expect(childCalls.map(([v]) => v.mode)).toEqual(['child', 'handback']);
    for (const [v] of childCalls) {
      expect(v.rows).toEqual([]);
      expect(v.current).toEqual({ name: nameOf(order[0]).split(' ')[0] });
    }
    spy.mockRestore();
  });

  test('the list and the ticks live on the teacher\'s screen behind the long-press', async () => {
    await Round.start(TEACHER, { rng: seeded(6) });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    await Round.childFinished(ROUND, order[0], 'run-0');
    await post(`/round/${tok()}/teacher`, HOLD);
    const html = await (await get(`/round/${tok()}`)).text();
    const done = html.match(/<li class="done[^"]*">[\s\S]*?<\/li>/g) || [];
    expect(done.join('')).toContain(nameOf(order[0]).split(' ')[0]);
    expect(done.join('')).toContain('Done ✓');
    for (const id of order.slice(1)) expect(visible(html)).toContain(nameOf(id).split(' ')[0]);
  });

  test('the play button opens the Challenge with a round turn token for exactly this child', async () => {
    await Round.start(TEACHER, { rng: seeded(7) });
    await post(`/round/${tok()}/next`, HOLD);
    const html = await (await get(`/round/${tok()}`)).text();
    const m = html.match(/href="\/c\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22})/);
    expect(m).toBeTruthy();
    const T = require('../../../shared/services/quiz/web-quiz-token');
    const claims = T.verify(m[1], 'r');
    expect(claims).toMatchObject({ k: 'r', rd: ROUND, sid: draw().state.order[0].id });
    expect(Object.keys(claims).sort()).toEqual(['exp', 'k', 'rd', 'sid']);
  });
});

describe('nothing remembered on the teacher\'s browser', () => {
  test('every round screen: no storage write, no cookie, no remembered child, no keep-my-place card', async () => {
    const pages = [];
    pages.push(await get(`/round/${tok()}`));
    await Round.start(TEACHER, { rng: seeded(8) });
    pages.push(await get(`/round/${tok()}`));
    await post(`/round/${tok()}/next`, HOLD);
    pages.push(await get(`/round/${tok()}`));
    await Round.childFinished(ROUND, draw().state.order[0].id, 'run-0');
    pages.push(await get(`/round/${tok()}`));
    for (const res of pages) {
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('cache-control')).toMatch(/no-store/);
      const html = await res.text();
      expect(html).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|wq_kids|serviceWorker/);
      expect(html).not.toMatch(/Keep my place|Keep your place|جگہ محفوظ/i);
    }
  });
});

describe('finish and the events', () => {
  test('the next long-press with nobody left closes the round: class_round_finished exactly, the draw row written; child_done has no pos', async () => {
    await Round.start(TEACHER, { rng: seeded(9), now: Date.parse('2026-10-20T05:00:00Z') });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/absent`, { pos: '5' });
    for (let i = 0; i < 5; i += 1) {
      await post(`/round/${tok()}/next`, HOLD);
      await Round.childFinished(ROUND, order[i], `run-${i}`, { now: Date.parse('2026-10-20T05:40:00Z') });
      await post(`/round/${tok()}/teacher`, HOLD);
    }
    expect(draw().finished_at).toBeNull(); // never closes by itself
    await post(`/round/${tok()}/next`, HOLD); // the long-press with nobody left closes it
    const d = draw();
    expect(d.finished_at).toBeTruthy();
    expect(d.ran_at).toBe(d.started_at);
    expect(d.children_present).toBe(5);
    expect(d.children_played).toBe(5);
    const fin = events('class_round_finished');
    expect(fin).toHaveLength(1);
    expect(Object.keys(fin[0]).sort()).toEqual(['absent_k', 'cls', 'counted_k', 'declined_k', 'done_k', 'ev_v', 'mins', 'present_k', 'roster_k', 'round', 'w']);
    expect(fin[0]).toMatchObject({ round: ROUND, cls: 'cls(c1)', roster_k: 6, present_k: 5, done_k: 5, absent_k: 1 });
    const done = events('class_round_child_done');
    expect(done).toHaveLength(5);
    done.forEach((e) => expect(Object.keys(e).sort()).toEqual(['cls', 'ev_v', 'kid', 'kid_v', 'round', 'run', 'w']));
    const all = JSON.stringify(logEvent.mock.calls);
    NAMES.forEach((n) => expect(all).not.toContain(n.split(' ')[0]));
    order.forEach((id) => expect(all).not.toContain(id));
    expect(all).not.toContain(CLASS);
    // a finished round has no card and no page
    expect((await get(`/round/${tok()}`)).status).toBe(404);
  });

  test('a finished child is promoted: child_identity.confirmed_at/confirmed_by=class_round', async () => {
    NAMES.forEach((_, i) => DB.child_identity.push({ canonical_id: kid(i + 1), year_code: '2026-27', fixed_grade: 3, grade_source: 'roster_class', confirmed_at: null, confirmed_by: null }));
    await Round.start(TEACHER, { rng: seeded(10) });
    const id = draw().state.order[0].id;
    await post(`/round/${tok()}/next`, HOLD);
    await Round.childFinished(ROUND, id, 'run-0');
    const confirmed = DB.child_identity.filter((r) => r.confirmed_by === 'class_round');
    expect(confirmed.map((r) => r.canonical_id)).toEqual([id]);
    expect(confirmed[0].confirmed_at).toBeTruthy();
  });

  test('events_v2 off: the round still works and no class_round event is written', async () => {
    seed(ON.filter((s) => s.key !== 'web_quiz_events_v2'));
    await Round.start(TEACHER, { rng: seeded(1) });
    expect(draw().state.order).toHaveLength(NAMES.length);
    expect(logEvent.mock.calls.filter((c) => /class_round/.test(c[0]))).toEqual([]);
  });
});

describe('who sees it', () => {
  test('a teacher with no open draw this term: no card, the round page is 404', async () => {
    const res = await get(`/round/${tok(OTHER_TEACHER)}`);
    expect(res.status).toBe(404);
    expect(await Round.cardFor(OTHER_TEACHER, { lang: 'en', token: 'x' })).toBe('');
  });

  test('the card shows on the class tab only for the drawn class\'s teacher, above the other cards', async () => {
    const html = await (await get(`/page/${tok()}`)).text();
    expect(html).toContain("This term's class round");
    expect(html).toContain('Start the round');
    expect(html).toMatch(/action="\/r\/[^"]+\/round\/start/);
    const ur = await (await get(`/page/${tok()}?lang=ur`)).text();
    expect(ur).toContain('اس ٹرم کا کلاس راؤنڈ');
  });
});

describe('switch off → every round route is the report\'s own 404', () => {
  const MISSING = (lang) => require('../../../shared/templates/teacher-report.page').renderMessagePage({ kind: 'missing', lang });
  test.each([
    ['own switch off', ON.map((s) => (s.key === 'web_quiz_class_round' ? { ...s, value: false } : s))],
    ['parent off', ON.map((s) => (s.key === 'web_quiz_challenge_v2' ? { ...s, value: false } : s))],
    ['grandparent off', ON.map((s) => (s.key === 'web_quiz_challenge' ? { ...s, value: false } : s))],
    ['no switch rows', []],
  ])('%s', async (_l, settings) => {
    seed(settings);
    for (const [method, p] of [['GET', `/round/${tok()}`], ['POST', `/round/${tok()}/start`], ['POST', `/round/${tok()}/next`], ['POST', `/round/${tok()}/absent`], ['POST', `/round/${tok()}/teacher`]]) {
      const res = method === 'GET' ? await get(p) : await post(p, HOLD);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(MISSING(null));
    }
    expect(draw().state).toBeNull();
    expect(draw().started_at).toBeNull();
    expect(await (await get(`/page/${tok()}`)).text()).not.toContain('class round');
  });

  test('a bad token on a round route: the report\'s own 401', async () => {
    const res = await get(`/round/${tok().slice(0, -3)}xyz`);
    expect(res.status).toBe(401);
  });
});
