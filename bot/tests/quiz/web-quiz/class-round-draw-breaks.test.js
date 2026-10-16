'use strict';
/**
 * The class round's term draw against the school calendar, and the teacher invitation's dated go.
 *   runTermDraw: the stored break list (app_settings web_quiz_term_breaks = [{from, to}], PKT dates, `to` inclusive) is required; a
 *     round window or either order arm's class week inside a break refuses the whole draw; an arm whose class week
 *     cannot be placed refuses the whole draw (no silent switch to the other arm). Nothing is written on a refusal;
 *     each refusal is logged once and counted as web_quiz.sample_drawn{drawn: 0, skipped}.
 *   inviteTeacher: needs the operator's dated go (app_settings web_quiz_class_round_go); with a valid go and an
 *     injected sender it counts the send on the ledger's strict phone-less path and sends only when that write held.
 * The real sampler and the real message ledger on the in-memory Supabase; faked: the loggers, the hashed-key module.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendTextMessage: jest.fn(), sendInteractiveMessage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${id})`, cls: (id) => `cls(${String(id).slice(-4)})`, envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}));

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./class-round-strict-fake');

const ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_round', value: true },
  { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true },
];
const NOW = Date.parse('2026-10-15T06:00:00Z');   // 15 Oct 2026 PKT, term 2026-27b
const PLAN = 'c971d4d956f5b0f1e0cc297b04696b20e1985a0a4b7161ddbefac40e4079c2bb';
const WINTER = { from: '2026-12-20', to: '2026-12-31' };   // the winter break, last day inclusive
const WIN_FEB = { start: '2027-02-01T00:00:00+05:00', end: '2027-02-15T00:00:00+05:00' };     // weeks 4–11 Jan, 8–15 Mar
const WIN_JAN = { start: '2027-01-18T00:00:00+05:00', end: '2027-02-15T00:00:00+05:00' };     // week_first week 21–28 Dec
const WIN_FEB_MAR = { start: '2027-02-01T00:00:00+05:00', end: '2027-03-01T00:00:00+05:00' }; // round_first week 22–29 Mar: past 18 Mar
const uuid = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GO = { by: 'operator', date: '2026-10-15', term: '2026-27b', template: 'jugnu_round_invite', category: 'utility', max_sends: 40, consent_v: 1 };

let DB; let fake;
function seed({ breaks = [WINTER], go = null } = {}) {
  const schools = []; const classes = []; const enr = [];
  let c = 0;
  ['Sector A', 'Sector B'].forEach((sec, si) => {
    const school = uuid('d', si + 1);
    schools.push({ id: school, name: `Testwala School ${si}`, region: sec, is_active: true, is_probable_test: false });
    ['grade_2', 'grade_5'].forEach((g) => {
      for (let i = 0; i < 15; i += 1) {
        c += 1;
        const id = uuid('c', c);
        classes.push({ id, school_id: school, grade_code: g, section: 'A', is_active: true });
        for (let k = 0; k < 6; k += 1) enr.push({ id: `e${c}-${k}`, class_id: id, student_id: uuid('b', c * 100 + k), is_active: true });
      }
    });
  });
  const app = ON.map((s) => ({ ...s }));
  if (breaks !== null) app.push({ key: 'web_quiz_term_breaks', value: breaks });
  if (go !== null) app.push({ key: 'web_quiz_class_round_go', value: go });
  DB = { app_settings: app, schools, classes, class_enrollments: enr, class_round_draws: [], message_ledger: [] };
  fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake), rpc: fake.rpc.bind(fake) });
}

let Sampler; let Ledger; let logToFile; let logEvent;
beforeEach(() => {
  jest.resetModules();
  Sampler = require('../../../shared/services/quiz/web-quiz-class-round-sampler');
  Ledger = require('../../../shared/services/quiz/message-ledger');
  ({ logToFile } = require('../../../shared/utils/logger'));
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
});

// a refusal is counted: exactly one web_quiz.sample_drawn{drawn: 0, skipped}, codes only, and no class_round_drawn
function expectCounted(skipped) {
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_drawn').map((c) => c[1]);
  expect(ev).toEqual([{ w: 's', ev_v: 2, arm: 'class_round', unit: 'class', term: '2026-27b', seed_version: 'cr-2026-27b.1', drawn: 0, skipped }]);
  expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_round_drawn')).toEqual([]);
  const lines = logToFile.mock.calls.filter((c) => /draw refused/.test(String(c[0])));
  expect(lines).toHaveLength(1);
  expect(lines[0][1]).toEqual(expect.objectContaining({ term: '2026-27b', skipped }));
}

// the frozen draw object for a seed, less the per-row random ids
const fingerprint = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.class_id, r.stratum, r.N_h, r.n_h, r.p_incl, r.seed,
  r.weights_version, r.plan_sha256, r.window_start, r.window_end, r.k_counted, r.order_arm, r.week_start, r.week_end, r.roster_k, r.drawn_at]))).digest('hex');

describe('the draw and the school calendar', () => {
  test('a week_first week inside a stored break → the whole draw is refused, 0 rows, one log line with the dates', async () => {
    seed();
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_JAN });
    expect(out).toEqual({ drawn: 0, skipped: 'week_in_break' });
    expect(DB.class_round_draws).toEqual([]);
    const lines = logToFile.mock.calls.filter((c) => /break/.test(String(c[0])));
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0][1])).toMatch(/2026-12-21/);
    expect(JSON.stringify(lines[0][1])).toMatch(/2026-12-20/);
    expectCounted('week_in_break');
  });

  test('the break\'s `to` day is inclusive: a break ending on the week_first week\'s first day (4 Jan) refuses the 1–15 Feb draw', async () => {
    seed({ breaks: [{ from: '2026-12-20', to: '2027-01-04' }] });
    expect(await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_FEB })).toEqual({ drawn: 0, skipped: 'week_in_break' });
    expect(DB.class_round_draws).toEqual([]);
    expectCounted('week_in_break');
  });

  test('the round window itself inside a break → window_in_break, 0 rows', async () => {
    seed({ breaks: [WINTER, { from: '2027-02-05', to: '2027-02-05' }] });
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_FEB });
    expect(out).toEqual({ drawn: 0, skipped: 'window_in_break' });
    expect(DB.class_round_draws).toEqual([]);
    expectCounted('window_in_break');
  });

  test('the break list absent or unreadable → no_breaks, 0 rows (a draw is once a term: fail closed)', async () => {
    for (const breaks of [null, 'not json', [{ from: '2026-12-20' }], [{ from: '2027-01-01', to: '2026-12-20' }], [{ from: '2026-02-30', to: '2026-03-02' }],
      { from: '2026-12-20', to: '2026-12-31' }, [{ start: '2026-12-20', end: '2027-01-01' }]]) {
      jest.resetModules();
      Sampler = require('../../../shared/services/quiz/web-quiz-class-round-sampler');
      ({ logToFile } = require('../../../shared/utils/logger'));
      ({ logEvent } = require('../../../shared/utils/structured-logger'));
      seed({ breaks });
      const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_FEB });
      expect(out).toEqual({ drawn: 0, skipped: 'no_breaks' });
      expect(DB.class_round_draws).toEqual([]);
      expectCounted('no_breaks');
    }
  });

  test('the break list stored as JSON text reads the same as an array', async () => {
    seed({ breaks: JSON.stringify([WINTER]) });
    expect(await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_JAN })).toEqual({ drawn: 0, skipped: 'week_in_break' });
  });

  test('a 1 Feb–1 Mar 2027 window → arm_unplaceable (the round_first week would end past 18 Mar), 0 rows', async () => {
    seed();
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_FEB_MAR });
    expect(out).toEqual({ drawn: 0, skipped: 'arm_unplaceable' });
    expect(DB.class_round_draws).toEqual([]);
    const lines = logToFile.mock.calls.filter((c) => /placed/.test(String(c[0])));
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0][1])).toMatch(/2027-02-01/);
    expectCounted('arm_unplaceable');
  });

  test('the pilot: a 1–15 Feb 2027 window with the winter break stored → both arms placed (week_first 4–11 Jan, round_first 8–15 Mar), the draw as today (golden for a fixed seed)', async () => {
    seed();
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN_FEB });
    expect(out).toEqual({ drawn: 40 });
    const rows = DB.class_round_draws;
    expect(rows).toHaveLength(40);
    const weeks = new Set(rows.map((r) => `${r.order_arm} ${r.week_start} ${r.week_end}`));
    expect([...weeks].sort()).toEqual([
      'round_first 2027-03-07T19:00:00.000Z 2027-03-14T19:00:00.000Z',
      'week_first 2027-01-03T19:00:00.000Z 2027-01-10T19:00:00.000Z',
    ]);
    expect(fingerprint(rows)).toBe('4a5a027f4920efd14377f4e4e89851bab43c7fcc25b75044e9959bd50553ddce');
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_drawn')).toEqual([]);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_round_drawn')).toHaveLength(40);
  });

  test('the earlier refusals keep their order: off, no_plan, bad_window come before the calendar checks', async () => {
    seed({ breaks: null });
    expect(await Sampler.runTermDraw({ now: NOW, seed: 1, window: WIN_FEB })).toEqual({ drawn: 0, skipped: 'no_plan' });
    expect(await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 1, window: null })).toEqual({ drawn: 0, skipped: 'bad_window' });
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_drawn')).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /draw refused/.test(String(c[0])))).toEqual([]);
    DB.app_settings = DB.app_settings.filter((s) => s.key !== 'web_quiz_class_round');
    jest.resetModules();
    Sampler = require('../../../shared/services/quiz/web-quiz-class-round-sampler');
    ({ logToFile } = require('../../../shared/utils/logger'));
    ({ logEvent } = require('../../../shared/utils/structured-logger'));
    expect(await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 1, window: WIN_FEB })).toEqual({ drawn: 0, skipped: 'off' });
    expect(DB.class_round_draws).toEqual([]);
    // the earlier refusals stay as they were: returned only, no new log line or event
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_drawn')).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /draw refused/.test(String(c[0])))).toEqual([]);
  });
});

describe('the teacher invitation and its dated go', () => {
  const DRAW = { class_id: uuid('c', 1), round: '0123456789abcdef', term_code: '2026-27b' };
  const sender = () => jest.fn(async () => true);

  test('no go → 0 sends, 0 ledger writes', async () => {
    seed();
    const send = sender();
    const spy = jest.spyOn(Ledger, 'record');
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: false, reason: 'no_go' }));
    expect(send).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(fake.rpcs).toEqual([]);
    const refusals = logToFile.mock.calls.filter((c) => /invitation refused/.test(String(c[0])));
    expect(refusals).toHaveLength(1);
    expect(refusals[0][1]).toEqual({ reason: 'no_go', round: DRAW.round });
  });

  test.each([
    ['dated tomorrow', 'go_future', { ...GO, date: '2026-10-16' }],
    ['for last term', 'wrong_term', { ...GO, term: '2026-27a', date: '2026-09-20' }],
    ['dated in last term', 'stale_go', { ...GO, date: '2026-09-20' }],
    ['not the operator', 'go_bad', { ...GO, by: 'someone' }],
    ['another template', 'wrong_template', { ...GO, template: 'jugnu_sample_ping' }],
    ['an unknown category', 'go_bad', { ...GO, category: 'service' }],
    ['max sends over the term ceiling', 'go_bad', { ...GO, max_sends: 41 }],
    ['max sends 0', 'go_bad', { ...GO, max_sends: 0 }],
    ['a consent version that is not a version', 'go_bad', { ...GO, consent_v: 'v1' }],
    ['unparsable text', 'go_bad', 'not json'],
  ])('a go %s → refused (%s), 0 sends, 0 ledger writes', async (_, reason, go) => {
    seed({ go });
    const send = sender();
    const spy = jest.spyOn(Ledger, 'record');
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: false, reason }));
    expect(send).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(fake.rpcs).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /invitation refused/.test(String(c[0])))).toHaveLength(1);
  });

  test('a go for another draw\'s term → wrong_term', async () => {
    seed({ go: GO });
    const send = sender();
    expect(await Sampler.inviteTeacher({ ...DRAW, term_code: '2026-27a' }, { now: NOW, send })).toEqual(expect.objectContaining({ sent: false, reason: 'wrong_term' }));
    expect(send).not.toHaveBeenCalled();
  });

  test('a go without consent_v (the SPEC §1 shape) is valid: with a sender, one send', async () => {
    seed({ go: (({ consent_v: _c, ...rest }) => rest)(GO) });
    const send = sender();
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('a valid go but no sender (production today) → the stub result, 0 ledger writes', async () => {
    seed({ go: GO });
    const spy = jest.spyOn(Ledger, 'record');
    const { UX_STRINGS } = require('../../../shared/config/ux-strings');
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, lang: 'ur' })).toEqual({ sent: false, reason: 'stub', template: 'jugnu_round_invite_ur', body: UX_STRINGS.roundInvite.ur, trigger: 'class_round', usd_each: 0.015 });
    expect(spy).not.toHaveBeenCalled();
    expect(fake.rpcs).toEqual([]);
  });

  test('a valid go, record() false (the ledger write failed) → no send, ledger_refused', async () => {
    seed({ go: GO });
    fake.rpcResult = { data: null, error: { code: '42P01', message: 'relation "message_ledger" does not exist' } };
    const send = sender();
    const spy = jest.spyOn(Ledger, 'record');
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: false, reason: 'ledger_refused' }));
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(spy.mock.results[0].value).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  test('a valid go, record() true → exactly one send, the strict phone-less ledger path (bot → teacher, class_round)', async () => {
    seed({ go: { ...GO, category: 'marketing' } });
    const send = sender();
    const spy = jest.spyOn(Ledger, 'record');
    const out = await Sampler.inviteTeacher(DRAW, { now: NOW, send, lang: 'en' });
    expect(out).toEqual(expect.objectContaining({ sent: true, template: 'jugnu_round_invite_en', trigger: 'class_round', usd_each: 0.0473 }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({ template: 'jugnu_round_invite_en', lang: 'en', round: DRAW.round, class_id: DRAW.class_id }));
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg).not.toHaveProperty('phone');
    expect(arg).toEqual(expect.objectContaining({ trigger: 'class_round', initiated: 'bot', recipient: 'teacher', classId: DRAW.class_id, usdEach: 0.0473 }));
    expect(fake.rpcs).toHaveLength(1);
    expect(fake.rpcs[0]).toEqual({ name: 'message_ledger_add', args: expect.objectContaining({ p_trigger: 'class_round', p_initiated: 'bot', p_recipient: 'teacher', p_n: 1, p_day: '2026-10-15' }) });
    // the ledger is written before the send
    expect(spy.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  test('never more than the go\'s max_sends invitations a term: the term\'s class_round ledger count is the guard', async () => {
    seed({ go: { ...GO, max_sends: 3 } });
    DB.message_ledger.push(
      { day: '2026-10-02', trigger: 'class_round', class_id: uuid('c', 2), initiated: 'bot', recipient: 'teacher', count: 2, usd: 0.03 },
      { day: '2026-10-10', trigger: 'class_round', class_id: uuid('c', 3), initiated: 'bot', recipient: 'teacher', count: 1, usd: 0.015 },
      // last term's sends and other triggers do not count
      { day: '2026-09-20', trigger: 'class_round', class_id: uuid('c', 4), initiated: 'bot', recipient: 'teacher', count: 5, usd: 0.075 },
      { day: '2026-10-10', trigger: 'teacher_queue', class_id: uuid('c', 5), initiated: 'bot', recipient: 'teacher', count: 9, usd: 0.135 },
    );
    const send = sender();
    const spy = jest.spyOn(Ledger, 'record');
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: false, reason: 'term_cap' }));
    expect(send).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    DB.message_ledger.splice(1, 1);   // 2 used of 3 → one more may go
    expect(await Sampler.inviteTeacher(DRAW, { now: NOW, send })).toEqual(expect.objectContaining({ sent: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
