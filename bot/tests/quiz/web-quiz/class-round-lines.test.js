'use strict';
/**
 * The class round's line: "Not this term" from the draw to the window's end; at the close, the counted positions,
 * the present ones among them and the position-only aggregates the term's statement reads, written on the draw row;
 * positions fixed at Start; the ruled copy on the card, the teacher's screens and the child's turn card.
 * Real round service, routes, tokens, Challenge; faked: Supabase (in-memory), the event logger, the hashed-key module,
 * WhatsApp and the ledger (virtual stand-ins; asserted never called).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendTextMessage: jest.fn(), sendInteractiveMessage: jest.fn() }), { virtual: true });
jest.mock('../../../shared/services/quiz/message-ledger', () => ({ record: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${String(id).slice(-2)})`, cls: (id) => `cls(${String(id).slice(-2)})`, envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}), { virtual: true });

const express = require('express');
const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./class-round-strict-fake');

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
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake), rpc: fake.rpc });
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


const ALT = require('./class-round-alt-copy.json');
const later = (ms) => iso(Date.now() + ms);
const PLAY = (pos) => `r0000000-0000-4000-8000-${String(pos).padStart(12, '0')}`;

describe('"Not this term" from the draw to the window\'s end', () => {
  test('before the window opens: one tap declines the class, one event, no message', async () => {
    seed({ draw: { window_start: later(5 * DAY), window_end: later(33 * DAY) } });
    const res = await post(`/round/${tok()}/not-this-term`);
    expect(res.status).toBe(303);
    expect(draw().declined_at).toBeTruthy();
    expect(events('class_round_class_declined')).toEqual([{ w: 's', ev_v: 2, round: ROUND, cls: 'cls(c1)' }]);
    Object.values(require('../../../shared/services/whatsapp.service')).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(require('../../../shared/services/quiz/message-ledger').record).not.toHaveBeenCalled();
  });

  test('after the window has ended: refused, nothing written', async () => {
    seed({ draw: { window_start: later(-30 * DAY), window_end: later(-1000) } });
    const res = await post(`/round/${tok()}/not-this-term`);
    expect(res.status).toBe(404);
    expect(draw().declined_at).toBeNull();
    expect(events('class_round_class_declined')).toEqual([]);
  });
});

describe('the close writes the line the statement reads', () => {
  async function playAll(order, { absent = [], declined = [], zero = [], rapid = [] } = {}) {
    for (const i of absent) await post(`/round/${tok()}/absent`, { pos: String(i) });
    for (const i of declined) await post(`/round/${tok()}/declined`, { pos: String(i) });
    for (let i = 0; i < order.length; i += 1) {
      if (absent.includes(i) || declined.includes(i)) continue;
      await post(`/round/${tok()}/next`, HOLD);
      DB.web_quiz_challenge_runs.push({ id: PLAY(i), student_id: order[i], exercise: 'missing', via: 'class_round', status: 'scored',
        score: { correct: zero.includes(i) ? 0 : 7, n: 10 }, meta: { rapid: rapid.includes(i) }, created_at: iso(Date.now()) });
      await Round.gameStored(ROUND, order[i], 'missing', PLAY(i), { games: ['missing'] });
      await post(`/round/${tok()}/teacher`, HOLD);
    }
    return post(`/round/${tok()}/next`, HOLD);
  }

  test('counted_k = the counted positions, present_counted_k = those not marked absent, aggregates per position bin, no child key', async () => {
    seed({ n: 14 });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    const res = await playAll(order, { absent: [1, 11], declined: [4], zero: [0, 6, 12], rapid: [6, 13] });
    expect(res.status).toBe(200);
    const d = draw();
    expect(d.counted_k).toBe(10);
    expect(d.present_counted_k).toBe(9);
    expect(d.position_aggregates).toEqual([
      { band: 'G23', pos_bin: '1-5', n: 3, zero_k: 1, rapid_k: 0 },
      { band: 'G23', pos_bin: '6-10', n: 5, zero_k: 1, rapid_k: 1 },
      { band: 'G23', pos_bin: '11-20', n: 3, zero_k: 1, rapid_k: 1 },
    ]);
    d.position_aggregates.forEach((a) => expect(Object.keys(a).sort()).toEqual(['band', 'n', 'pos_bin', 'rapid_k', 'zero_k']));
    const text = JSON.stringify(d.position_aggregates);
    order.forEach((id) => expect(text).not.toContain(id));
    NAMES.forEach((nm) => expect(text).not.toContain(nm.split(' ')[0]));
    expect(d.state.k).toEqual({ present: 12, absent: 2, declined: 1, done: 11 });
    expect(events('class_round_finished')[0]).toMatchObject({ counted_k: 10, present_k: 12, done_k: 11, absent_k: 2, declined_k: 1 });
  });

  test('a roster smaller than k: every position is counted; absent counted positions are not present', async () => {
    seed({ n: 6 });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await playAll(order, { absent: [0, 5] });
    expect(draw()).toMatchObject({ counted_k: 6, present_counted_k: 4, children_present: 4, children_played: 4 });
    expect(draw().position_aggregates).toEqual([
      { band: 'G23', pos_bin: '1-5', n: 4, zero_k: 0, rapid_k: 0 },
      { band: 'G23', pos_bin: '6-10', n: 0, zero_k: 0, rapid_k: 0 },
    ]);
  });

  test('closed at the window\'s end: the positions not reached are nonresponse; the aggregates count only who played', async () => {
    seed({ n: 4 });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    DB.web_quiz_challenge_runs.push({ id: PLAY(0), student_id: order[0], exercise: 'missing', via: 'class_round', status: 'scored', score: { correct: 0 }, meta: {}, created_at: iso(Date.now()) });
    await Round.gameStored(ROUND, order[0], 'missing', PLAY(0), { games: ['missing'] });
    draw().window_end = iso(Date.now() - 1000);
    expect((await get(`/round/${tok()}`)).status).toBe(404);
    expect(draw()).toMatchObject({ counted_k: 4, present_counted_k: 4, children_played: 1 });
    expect(draw().position_aggregates).toEqual([{ band: 'G23', pos_bin: '1-5', n: 1, zero_k: 1, rapid_k: 0 }]);
  });

  test('positions are fixed at Start: an absent child at a counted position leaves the slot empty; the next child stays practice', async () => {
    seed({ n: 4, draw: { k_counted: 2 } });
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/absent`, { pos: '1' });
    await post(`/round/${tok()}/next`, HOLD);
    expect((await Round.claimFor(ROUND, order[0], 'missing')).mode).toBe('class_round');
    await Round.childFinished(ROUND, order[0], 'x');
    await post(`/round/${tok()}/teacher`, HOLD);
    await post(`/round/${tok()}/next`, HOLD);
    expect(draw().state.cur).toBe(2);
    expect((await Round.claimFor(ROUND, order[2], 'missing')).mode).toBe('practice');
    expect(draw().state.order.map((p) => p.id)).toEqual(order);
  });
});

describe('the ruled copy, every switch on', () => {
  test('the card\'s sub-line is the ruled wording (EN and UR), with the never-reported line; no "picked", no minutes count', async () => {
    for (const lang of ['en', 'ur']) {
      const card = await Round.cardFor(TEACHER, { lang, token: 'tk' });
      expect(card).toContain(ALT['jg.round.card_sub'][lang]);
      expect(card).toContain(Page.T[lang].tNeverReported);
      expect(card).toMatch(/round\/start/);
      expect(card).toMatch(/round\/not-this-term/);
      expect(card).not.toMatch(/picked|ten minutes|35|چنی|۳۵/i);
    }
    expect(Page.T.en.cardSub).toBe(ALT['jg.round.card_sub'].en);
    expect(Page.T.ur.cardSub).toBe(ALT['jg.round.card_sub'].ur);
  });

  test('the teacher\'s screens: Not today, Pause, then Continue; the intro carries Do Not Disturb', async () => {
    for (const lang of ['en', 'ur']) {
      seed();
      const intro = await (await get(`/round/${tok()}?lang=${lang}`)).text();
      expect(intro).toContain(esc(Page.T[lang].tDnd));
      await Round.start(TEACHER, { rng: () => 0.3 });
      let html = await (await get(`/round/${tok()}?lang=${lang}`)).text();
      expect(html).toContain(`>${esc(Page.T[lang].tDeclined)}</button>`);
      expect(html).toContain(`>${esc(Page.T[lang].tPause)}</button>`);
      await post(`/round/${tok()}/pause?lang=${lang}`);
      html = await (await get(`/round/${tok()}?lang=${lang}`)).text();
      expect(html).toContain(`>${esc(Page.T[lang].tResume)}</button>`);
    }
  });

  test('the child\'s turn card: the turn line, then the assent line under it; "Give the phone back" on the hold; the hand-back card', async () => {
    await Round.start(TEACHER, { rng: () => 0.3 });
    const order = draw().state.order.map((p) => p.id);
    await post(`/round/${tok()}/next`, HOLD);
    for (const lang of ['en', 'ur']) {
      const html = await (await get(`/round/${tok()}?lang=${lang}`)).text();
      expect(html).toMatch(new RegExp(`</a><p class="assent">${esc(Page.T[lang].cAssent)}</p>`));
      expect(html).toContain(`>${esc(Page.T[lang].cBack)}</button>`);
    }
    await Round.childFinished(ROUND, order[0], 'r0');
    const back = await (await get(`/round/${tok()}?lang=en`)).text();
    expect(back).toContain(esc(Page.T.en.cHandback));
    expect(Page.T.en.cHandback).toBe('Thanks for playing! Hand the phone to your teacher.');
  });

  test('the close screen thanks the teacher, with no count', async () => {
    seed({ n: 1 });
    await Round.start(TEACHER, { rng: () => 0.3 });
    await post(`/round/${tok()}/absent`, { pos: '0' });
    const res = await post(`/round/${tok()}/next?lang=ur`, HOLD);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(Page.T.ur.tThanks);
    expect(html).not.toMatch(/class="count"/);
  });
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
