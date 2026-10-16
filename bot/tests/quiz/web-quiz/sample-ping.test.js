'use strict';
/**
 * The direct ping to a sampled family phone, built OFF: four locks (the switch with its parents, the operator's dated
 * go token, the copy key, the ledger), the run guards (quiet hours, an open class window, a failed read), the frame and
 * its exclusions, the caps, the per-send order, the dry run, and the events (never a phone, an id, a kid or a ukey).
 * Real flags, real binding store, real door rules; faked: Supabase (in-memory tables that apply filters), Redis, the
 * loggers, WhatsApp, the send ledger (record, capAllows), and the transport (injected).
 */
process.env.WQ_TOMB_SALT = 'test-tomb-salt-not-a-secret-000000000000';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-not-a-secret-0000000000000000';
process.env.WEB_QUIZ_KID_KEY_V = '2026';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async () => true),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
    redis: { get: jest.fn(async () => null) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendTemplate: jest.fn(async () => true), sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/quiz/message-ledger', () => ({
  record: jest.fn(async () => false), capAllows: jest.fn(async () => true), pktDay: (n) => new Date(new Date(n).getTime() + 18e6).toISOString().slice(0, 10),
  TRIGGERS: [], USD_PER_SEND: 0.015,
}));

const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');

// 16 Oct 2026, 10:00 PKT (term 2026-27b)
const T0 = Date.parse('2026-10-16T05:00:00Z');
const PKT = (hhmm, day = '2026-10-16') => Date.parse(`${day}T${hhmm}:00+05:00`);
const FUTURE = '2027-03-31T18:59:59.000Z';
const PAST = '2026-09-01T00:00:00.000Z';
const GO = { by: 'operator', date: '2026-10-15', term: '2026-27b', template: 'jugnu_sample_ping', category: 'utility', max_sends: 100, consent_v: 1 };
const ALL_ON = {
  web_quiz_sample_ping: true, web_quiz_challenge: true, web_quiz_challenge_v2: true, web_quiz_hub: true, web_quiz_events_v2: true,
  web_quiz_identity_canon: true, web_quiz_phone_bind: true,
};
const uuid = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLASS = (n) => uuid('c', n);
const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PHONE_RX = /92000\d{7}|\d{10,15}/;
const HEX16_RX = /[0-9a-f]{16,}/i;

let DB; let fake; let seq; let failing; let order;
let Ping; let Ledger; let logEvent; let logToFile; let logError; let Repo; let Ux;

function world({ settings = ALL_ON, go = GO } = {}) {
  seq = 0;
  failing = new Set();
  order = [];
  const app = Object.entries(settings).map(([key, value]) => ({ key, value }));
  if (go !== null) app.push({ key: 'web_quiz_sample_ping_go', value: go });
  DB = {
    app_settings: app, child_phone_bindings: [], class_enrollments: [], class_round_draws: [], sample_ping_consents: [],
    sample_pings: [], users: [], quizzes: [],
  };
  fake = makeFake(DB, { uniques: { sample_pings: ['term_code', 'phone_tomb'] } });
  const supabase = require('../../../shared/config/supabase');
  supabase.from = (t) => {
    if (failing.has(`throw:${t}`)) throw new Error('client exploded');
    const b = fake.from(t);
    b.or = () => b;
    if (failing.has(t)) b.then = (res, rej) => Promise.resolve({ data: null, count: null, error: { code: 'XX000', message: 'read failed' } }).then(res, rej);
    if (t === 'sample_pings') {
      const ins = b.insert; const upd = b.update;
      b.insert = (row) => { order.push('reserve'); return ins(row); };
      b.update = (patch) => { order.push(`row:${patch.state}`); return upd(patch); };
    }
    return b;
  };
  supabase.rpc = fake.rpc;
}

/** A family phone: one active binding per child; `kids` = class ids (null = no class). */
function family(n, kids, { consentV = 1, user = null } = {}) {
  const phone = fixturePhone(n);
  const tomb = Repo.tombOf(phone);
  const ids = [];
  kids.forEach((cls) => {
    seq += 1;
    const child = uuid('a', seq);
    const bind = uuid('b', seq);
    ids.push(child);
    DB.child_phone_bindings.push({ id: bind, canonical_id: child, phone_norm: phone, phone_tomb: tomb, via: 'save', bound_at: PAST, expires_at: FUTURE, revoked_at: null, revoked_by: null });
    if (cls) DB.class_enrollments.push({ id: `e-${seq}`, student_id: child, class_id: cls, is_active: true });
    if (consentV != null) DB.sample_ping_consents.push({ binding_id: bind, consent_v: consentV, consented_at: PAST });
  });
  if (user) DB.users.push({ id: uuid('d', n), phone_number: phone, role: 'teacher', registration_completed: false, registration_state: 'unregistered', name: null, teacher_uuid: null, school_id: null, portal_activated: false, preferred_language: null, ...user });
  return { phone, tomb, ids };
}

const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const allEventsClean = () => {
  logEvent.mock.calls.forEach(([, f]) => {
    const keys = Object.keys(f || {});
    keys.forEach((k) => expect(k).not.toMatch(/^(phone|kid|ukey|class_id|classId|child|student|tomb|phone_tomb)/i));
    const s = JSON.stringify(f);
    expect(s).not.toMatch(UUID_RX);
    expect(s).not.toMatch(PHONE_RX);
    expect(s).not.toMatch(HEX16_RX);
  });
};
const fakeTransport = () => jest.fn(async () => { order.push('transport'); return true; });

beforeEach(() => {
  jest.resetModules();
  Ledger = require('../../../shared/services/quiz/message-ledger');
  Ledger.record.mockReset().mockImplementation(async () => false);
  Ledger.capAllows.mockReset().mockImplementation(async () => true);
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  ({ logToFile, logError } = require('../../../shared/utils/logger'));
  Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
  Ux = require('../../../shared/config/ux-strings');
  Ux.UX_STRINGS.samplePingInvite = { en: 'Test invite body.', ur: 'ٹیسٹ' };
  Ping = require('../../../shared/services/quiz/web-quiz-sample-ping');
});
afterEach(() => { delete Ux.UX_STRINGS.samplePingInvite; });

// Every lock open in the test only: the copy key set above, the ledger answering true, a fake transport.
function openLedger() {
  Ledger.record.mockImplementation(async () => { order.push('ledger'); return true; });
  Ledger.capAllows.mockImplementation(async () => { order.push('cap'); return true; });
}

describe('the constants and the module surface', () => {
  test('the switches, caps, quiet hours and rates are as designed', () => {
    expect(Ping.SWITCH_KEY).toBe('web_quiz_sample_ping');
    expect(Ping.GO_KEY).toBe('web_quiz_sample_ping_go');
    expect(Ping.TERM_CAP_SENDS).toBe(3200);
    expect(Ping.PER_CLASS_CAP).toBe(10);
    expect(Ping.QUIET_START_H).toBe(22);
    expect(Ping.QUIET_END_H).toBe(7);
    expect(Ping.RATE).toEqual({ utility: 0.015, marketing: 0.0473 });
    ['flags', 'readGo', 'quietHours', 'classWindowOpen', 'plan', 'dryRun', 'send', '_resetCache'].forEach((f) => expect(typeof Ping[f]).toBe('function'));
  });
});

describe('the switch off sends nothing and says nothing', () => {
  test.each([
    ['its own switch off', { ...ALL_ON, web_quiz_sample_ping: false }],
    ['the Challenge v2 switch off', { ...ALL_ON, web_quiz_challenge_v2: false }],
    ['the family phone binding switch off', { ...ALL_ON, web_quiz_phone_bind: false }],
  ])('%s: no send, no event, no log line, only the settings read', async (_, settings) => {
    world({ settings });
    family(1, [CLASS(1)]);
    openLedger();                                             // the other three locks open: this one alone holds
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, skipped: 'off' });
    expect(transport).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(logToFile).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(fake.calls.length).toBeGreaterThan(0);
    fake.calls.forEach((c) => expect(c.table).toBe('app_settings'));
    expect(Ledger.record).not.toHaveBeenCalled();
    expect(Ledger.capAllows).not.toHaveBeenCalled();
  });

  test('its own switch off reads app_settings exactly once', async () => {
    world({ settings: { ...ALL_ON, web_quiz_sample_ping: false } });
    await Ping.send({ now: T0, transport: fakeTransport() });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('the operator\'s dated go token', () => {
  test('no go token: nothing sent, exactly one no_go refusal, no ledger, nothing read but the settings', async () => {
    world({ go: null });
    family(1, [CLASS(1)]);
    openLedger();                                             // the other three locks open: this one alone holds
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, refused: 'no_go' });
    allEventsClean();
    expect(transport).not.toHaveBeenCalled();
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason: 'no_go', w: 's' }]);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(Ledger.record).not.toHaveBeenCalled();
    expect(Ledger.capAllows).not.toHaveBeenCalled();
    fake.calls.forEach((c) => expect(c.table).toBe('app_settings'));
  });

  test.each([
    ['not the operator', { ...GO, by: 'someone' }, 'go_bad'],
    ['not a real date', { ...GO, date: '2026-02-30' }, 'go_bad'],
    ['a malformed date', { ...GO, date: '16/10/2026' }, 'go_bad'],
    ['a bad template name', { ...GO, template: 'Bad-Template!' }, 'go_bad'],
    ['an unknown category', { ...GO, category: 'service' }, 'go_bad'],
    ['max sends 0', { ...GO, max_sends: 0 }, 'go_bad'],
    ['max sends over the term ceiling', { ...GO, max_sends: 3201 }, 'go_bad'],
    ['max sends not an integer', { ...GO, max_sends: 2.5 }, 'go_bad'],
    ['the consent version missing', (({ consent_v: _c, ...rest }) => rest)(GO), 'go_bad'],
    ['unparsable text', 'not json at all', 'go_bad'],
    ['another term', { ...GO, term: '2026-27a' }, 'go_term'],
    ['dated in the previous term', { ...GO, date: '2026-09-20' }, 'go_term'],
    ['dated tomorrow', { ...GO, date: '2026-10-17' }, 'go_future'],
  ])('%s → %s, nothing sent, one refusal', async (_, go, reason) => {
    world({ go });
    family(1, [CLASS(1)]);
    openLedger();
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, refused: reason });
    expect(transport).not.toHaveBeenCalled();
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason, w: 's' }]);
    expect(Ledger.record).not.toHaveBeenCalled();
  });

  test('a go token stored as JSON text reads the same as one stored as an object', async () => {
    world({ go: JSON.stringify(GO) });
    const g = await Ping.readGo(T0);
    expect(g.ok).toBe(true);
    expect(g.go).toEqual(expect.objectContaining({ term: '2026-27b', consent_v: 1, max_sends: 100 }));
  });

  test('a valid go token without the copy key → no_copy', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    delete Ux.UX_STRINGS.samplePingInvite;
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, refused: 'no_copy' });
    expect(transport).not.toHaveBeenCalled();
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason: 'no_copy', w: 's' }]);
  });
});

describe('quiet hours', () => {
  test.each([['22:00'], ['03:00'], ['06:59']])('%s PKT refuses quiet_hours', async (hhmm) => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    const transport = fakeTransport();
    const out = await Ping.send({ now: PKT(hhmm), transport });
    expect(out).toEqual({ sent: 0, refused: 'quiet_hours' });
    expect(transport).not.toHaveBeenCalled();
    expect(Ping.quietHours(PKT(hhmm))).toBe(true);
  });

  test.each([['07:00'], ['21:59']])('%s PKT passes the quiet-hours guard', async (hhmm) => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    const out = await Ping.send({ now: PKT(hhmm), transport: fakeTransport() });
    expect(out.refused).toBeUndefined();
    expect(out.sent).toBe(1);
    expect(Ping.quietHours(PKT(hhmm))).toBe(false);
  });

  test('a run that crosses 22:00 between sends stops sending', async () => {
    world();
    family(1, [CLASS(1)]);
    family(2, [CLASS(2)]);
    family(3, [CLASS(3)]);
    openLedger();
    let late = false;
    const transport = jest.fn(async () => { late = true; return true; });
    const out = await Ping.send({ now: () => (late ? PKT('22:00') : PKT('21:59')), transport });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(out).toEqual(expect.objectContaining({ sent: 1, refused: 'quiet_hours' }));
    expect(DB.sample_pings).toHaveLength(1);
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason: 'quiet_hours', w: 's' }]);
  });
});

describe('class windows', () => {
  const draw = (o) => ({ id: uuid('e', 900 + DB.class_round_draws.length), class_id: CLASS(99), term_code: '2026-27b', window_start: null, window_end: null, week_start: null, week_end: null, ...o });

  test('an open class-round window (any term) → class_window', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    DB.class_round_draws.push(draw({ term_code: '2026-27a', window_start: new Date(T0 - 864e5).toISOString(), window_end: new Date(T0 + 864e5).toISOString() }));
    const transport = fakeTransport();
    expect(await Ping.send({ now: T0, transport })).toEqual({ sent: 0, refused: 'class_window' });
    expect(transport).not.toHaveBeenCalled();
    expect(await Ping.classWindowOpen(T0)).toBe(true);
  });

  test('an open class-week window → class_window', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    DB.class_round_draws.push(draw({ window_start: new Date(T0 + 30 * 864e5).toISOString(), window_end: new Date(T0 + 40 * 864e5).toISOString(),
      week_start: new Date(T0 - 3600e3).toISOString(), week_end: new Date(T0 + 6 * 864e5).toISOString() }));
    expect(await Ping.send({ now: T0, transport: fakeTransport() })).toEqual({ sent: 0, refused: 'class_window' });
  });

  test('a window that closed or has not opened does not block', async () => {
    world();
    DB.class_round_draws.push(draw({ window_start: new Date(T0 - 10 * 864e5).toISOString(), window_end: new Date(T0 - 3 * 864e5).toISOString(),
      week_start: new Date(T0 + 3 * 864e5).toISOString(), week_end: new Date(T0 + 10 * 864e5).toISOString() }));
    expect(await Ping.classWindowOpen(T0)).toBe(false);
  });

  test('the draws read fails → read_failed, nothing sent', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    failing.add('class_round_draws');
    const transport = fakeTransport();
    expect(await Ping.send({ now: T0, transport })).toEqual({ sent: 0, refused: 'read_failed' });
    expect(transport).not.toHaveBeenCalled();
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason: 'read_failed', w: 's' }]);
  });
});

describe('the frame and its exclusions (counted in sample_ping_planned)', () => {
  test('one fixture per exclusion; revoked and expired bindings are never in the frame', async () => {
    world();
    family(1, [CLASS(1)]);                                     // eligible
    family(2, [null]);                                         // loose
    family(3, [CLASS(3), CLASS(4)]);                           // one child in a class drawn this term → whole set out
    DB.class_round_draws.push({ id: uuid('e', 1), class_id: CLASS(3), term_code: '2026-27b', window_start: new Date(T0 + 60 * 864e5).toISOString(),
      window_end: new Date(T0 + 70 * 864e5).toISOString(), week_start: null, week_end: null });
    family(4, [CLASS(5)], { user: { registration_completed: true } });      // teacher: identity
    const act = family(5, [CLASS(6)], { user: {} });                        // teacher: activity
    DB.quizzes.push({ id: uuid('f', 1), teacher_id: uuid('d', 5) });
    const stop = family(6, [CLASS(7)]);                                     // a STOP in the tombstone's past
    DB.child_phone_bindings.push({ id: uuid('b', 600), canonical_id: uuid('a', 600), phone_norm: null, phone_tomb: stop.tomb, via: 'save', bound_at: PAST, expires_at: FUTURE, revoked_at: PAST, revoked_by: 'stop' });
    family(7, [CLASS(8)], { consentV: null });                              // no consent row
    family(8, [CLASS(9)], { consentV: 2 });                                 // another consent version
    const done = family(9, [CLASS(10)]);                                    // already pinged this term
    DB.sample_pings.push({ id: uuid('9', 1), term_code: '2026-27b', phone_tomb: done.tomb, class_id: CLASS(10), state: 'sent', created_at: PAST, sent_at: PAST });
    family(10, [CLASS(11)], { user: { preferred_language: 'en' } });        // a plain family user: eligible
    // never in the frame: a revoked binding (phone still on it) and an expired one
    DB.child_phone_bindings.push({ id: uuid('b', 700), canonical_id: uuid('a', 700), phone_norm: fixturePhone(11), phone_tomb: Repo.tombOf(fixturePhone(11)), bound_at: PAST, expires_at: FUTURE, revoked_at: PAST, revoked_by: 'page_undo' });
    DB.child_phone_bindings.push({ id: uuid('b', 701), canonical_id: uuid('a', 701), phone_norm: fixturePhone(12), phone_tomb: Repo.tombOf(fixturePhone(12)), bound_at: PAST, expires_at: PAST, revoked_at: null, revoked_by: null });
    [700, 701].forEach((k) => {
      DB.class_enrollments.push({ id: `e-${k}`, student_id: uuid('a', k), class_id: CLASS(k), is_active: true });
      DB.sample_ping_consents.push({ binding_id: uuid('b', k), consent_v: 1 });
    });
    expect(act.ids).toHaveLength(1);
    const out = await Ping.dryRun({ now: T0 });
    const [p] = events('web_quiz.sample_ping_planned');
    expect(p).toEqual({
      term: '2026-27b', dry: true, frame_n: 10, eligible_n: 2, would_send_n: 2, classes_n: 2,
      excl_loose: 1, excl_drawn: 1, excl_teacher: 2, excl_stop: 1, excl_consent: 2, excl_done: 1, w: 's',
    });
    expect(out).toEqual(expect.objectContaining({ frame_n: 10, eligible_n: 2, would_send_n: 2 }));
    allEventsClean();
  });

  test('a teacher whose activity read fails counts as a teacher (fail closed)', async () => {
    world();
    family(1, [CLASS(1)], { user: {} });
    family(2, [CLASS(2)]);
    failing.add('quizzes');
    await Ping.dryRun({ now: T0 });
    const [p] = events('web_quiz.sample_ping_planned');
    expect(p).toEqual(expect.objectContaining({ frame_n: 2, excl_teacher: 1, eligible_n: 1 }));
  });

  test('a teacher whose users row holds the phone in local form (0…) or with + is still a teacher', async () => {
    world();
    const local = family(1, [CLASS(1)]);
    const plus = family(2, [CLASS(2)]);
    family(3, [CLASS(3)]);
    DB.users.push({ id: uuid('d', 91), phone_number: `0${local.phone.slice(2)}`, registration_completed: true });
    DB.users.push({ id: uuid('d', 92), phone_number: `+${plus.phone}`, registration_completed: true });
    await Ping.dryRun({ now: T0 });
    const [p] = events('web_quiz.sample_ping_planned');
    expect(p).toEqual(expect.objectContaining({ frame_n: 3, excl_teacher: 2, eligible_n: 1 }));
  });

  test('the ping tables missing → read_failed, nothing sent', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    const supabase = require('../../../shared/config/supabase');
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'sample_pings' || t === 'sample_ping_consents') b.then = (res, rej) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res, rej);
      return b;
    };
    const transport = fakeTransport();
    expect(await Ping.send({ now: T0, transport })).toEqual({ sent: 0, refused: 'read_failed' });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('caps', () => {
  test('one child per bound set: three eligible children on one phone → one send', async () => {
    world();
    const f = family(1, [CLASS(1), CLASS(2), CLASS(3)]);
    openLedger();
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out.sent).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(DB.sample_pings).toHaveLength(1);
    expect([CLASS(1), CLASS(2), CLASS(3)]).toContain(DB.sample_pings[0].class_id);
    expect(DB.sample_pings[0].phone_tomb).toBe(f.tomb);
  });

  test('ten per class a term: fifteen eligible phones in one class → ten sends', async () => {
    world();
    for (let i = 1; i <= 15; i += 1) family(i, [CLASS(1)]);
    openLedger();
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out.sent).toBe(10);
    expect(transport).toHaveBeenCalledTimes(10);
    expect(DB.sample_pings.filter((r) => r.state === 'sent')).toHaveLength(10);
  });

  test('the class cap counts pings already sent this term in that class', async () => {
    world();
    for (let i = 1; i <= 5; i += 1) family(i, [CLASS(1)]);
    for (let i = 0; i < 8; i += 1) DB.sample_pings.push({ id: uuid('9', i + 1), term_code: '2026-27b', phone_tomb: `old${i}`, class_id: CLASS(1), state: 'sent' });
    openLedger();
    const out = await Ping.send({ now: T0, transport: fakeTransport() });
    expect(out.sent).toBe(2);
  });

  test('the go token\'s max sends, less what was already sent this term', async () => {
    world({ go: { ...GO, max_sends: 5 } });
    for (let i = 1; i <= 10; i += 1) family(i, [CLASS(i)]);
    DB.sample_pings.push({ id: uuid('9', 1), term_code: '2026-27b', phone_tomb: 'old1', class_id: CLASS(50), state: 'sent' });
    DB.sample_pings.push({ id: uuid('9', 2), term_code: '2026-27b', phone_tomb: 'old2', class_id: CLASS(51), state: 'sent' });
    openLedger();
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out.sent).toBe(3);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  test('the per-phone daily cap: a capped phone is skipped, with no reservation and no ledger row', async () => {
    world();
    const a = family(1, [CLASS(1)]);
    const b = family(2, [CLASS(2)]);
    openLedger();
    Ledger.capAllows.mockImplementation(async (phone) => phone !== a.phone);
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out.sent).toBe(1);
    expect(out.capped).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(b.phone);
    expect(DB.sample_pings.map((r) => r.phone_tomb)).toEqual([b.tomb]);
    expect(Ledger.record).toHaveBeenCalledTimes(1);
    expect(Ledger.capAllows).toHaveBeenCalledWith(a.phone, 'sample_ping', expect.anything());
  });
});

describe('the ledger', () => {
  test('the ledger refuses (as today\'s database does) → nothing sent, reservation failed, the run stops, one ledger refusal', async () => {
    world();
    family(1, [CLASS(1)]);
    family(2, [CLASS(2)]);
    Ledger.record.mockImplementation(async () => false);
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual(expect.objectContaining({ sent: 0, refused: 'ledger' }));
    expect(transport).not.toHaveBeenCalled();
    expect(Ledger.record).toHaveBeenCalledTimes(1);
    expect(DB.sample_pings).toHaveLength(1);
    expect(DB.sample_pings[0].state).toBe('failed');
    expect(events('web_quiz.sample_ping_refused')).toEqual([{ reason: 'ledger', w: 's' }]);
    expect(events('web_quiz.sample_ping_sent')).toEqual([]);
  });
});

describe('a send, every lock open in the test only', () => {
  test('per send: cap → reserve → ledger → transport → row sent → event; no phone or id on any event', async () => {
    world();
    const f = family(1, [CLASS(1)]);
    openLedger();
    logEvent.mockImplementation((name) => { if (name !== 'web_quiz.sample_ping_planned') order.push(name); });
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual(expect.objectContaining({ sent: 1 }));
    expect(order).toEqual(['cap', 'reserve', 'ledger', 'transport', 'row:sent', 'web_quiz.sample_ping_sent']);
    const rec = Ledger.record.mock.calls[0][0];
    expect(rec).toEqual(expect.objectContaining({ trigger: 'sample_ping', initiated: 'bot', recipient: 'family', classId: CLASS(1), usdEach: 0.015 }));
    expect(rec.phone).toBeUndefined();
    expect(transport).toHaveBeenCalledWith(f.phone, 'jugnu_sample_ping_ur', 'ur', []);
    const row = DB.sample_pings[0];
    expect(row).toEqual(expect.objectContaining({ term_code: '2026-27b', phone_tomb: f.tomb, class_id: CLASS(1), state: 'sent' }));
    expect(row.sent_at).toEqual(expect.any(String));
    Object.keys(row).forEach((k) => expect(k).not.toMatch(/phone_norm|phone_number|canonical|student|child/));
    const [sent] = events('web_quiz.sample_ping_sent');
    expect(Object.keys(sent).sort()).toEqual(['cls', 'term', 'usd', 'w']);
    expect(sent).toEqual({ term: '2026-27b', cls: expect.stringMatching(/^[0-9a-f]{12}$/), usd: 0.015, w: 's' });
    expect(events('web_quiz.sample_ping_planned')).toHaveLength(1);
    expect(events('web_quiz.sample_ping_planned')[0].dry).toBe(false);
    allEventsClean();
  });

  test('a marketing template is recorded at the marketing rate; the family\'s language picks the template', async () => {
    world({ go: { ...GO, category: 'marketing' } });
    const f = family(1, [CLASS(1)], { user: { preferred_language: 'en' } });
    openLedger();
    const transport = fakeTransport();
    await Ping.send({ now: T0, transport });
    expect(Ledger.record.mock.calls[0][0].usdEach).toBe(0.0473);
    expect(transport).toHaveBeenCalledWith(f.phone, 'jugnu_sample_ping_en', 'en', []);
    expect(events('web_quiz.sample_ping_sent')[0].usd).toBe(0.0473);
  });

  test('a second run in the same term pings no phone twice', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    const transport = fakeTransport();
    await Ping.send({ now: T0, transport });
    Ping._resetCache();
    await Ping.send({ now: T0 + 3600e3, transport });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(DB.sample_pings).toHaveLength(1);
  });

  test('a failed transport marks the row failed and is not counted as sent', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    const out = await Ping.send({ now: T0, transport: jest.fn(async () => false) });
    expect(out.sent).toBe(0);
    expect(DB.sample_pings[0].state).toBe('failed');
    expect(events('web_quiz.sample_ping_sent')).toEqual([]);
  });

  test('never throws: an unexpected error → read_failed and one logError', async () => {
    world();
    family(1, [CLASS(1)]);
    openLedger();
    failing.add('throw:child_phone_bindings');
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, refused: 'read_failed' });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('the dry run', () => {
  const scan = (v) => {
    const s = JSON.stringify(v);
    expect(s).not.toMatch(UUID_RX);
    expect(s).not.toMatch(PHONE_RX);
    expect(s).not.toMatch(HEX16_RX);
  };

  test('switch off: counts returned, nothing written, no event', async () => {
    world({ settings: { ...ALL_ON, web_quiz_sample_ping: false } });
    for (let i = 1; i <= 3; i += 1) family(i, [CLASS(1)]);
    family(4, [null]);
    const before = JSON.stringify(DB);
    const out = await Ping.dryRun({ now: T0 });
    expect(JSON.stringify(DB)).toBe(before);
    expect(logEvent).not.toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ switch_on: false, go_present: true, frame_n: 4, excl_loose: 1, eligible_n: 3, would_send_n: 3, classes_n: 1, max_per_class: 3 }));
    expect(out.usd_utility).toBeCloseTo(0.045, 6);
    expect(out.usd_marketing).toBeCloseTo(0.1419, 6);
    fake.calls.forEach((c) => expect(c.op).toBe('select'));
    expect(Ledger.record).not.toHaveBeenCalled();
    scan(out);
  });

  test('switch and events on: exactly one planned{dry:true}, nothing written, no id in the return value', async () => {
    world();
    for (let i = 1; i <= 3; i += 1) family(i, [CLASS(i)]);
    const before = JSON.stringify(DB);
    const out = await Ping.dryRun({ now: T0 });
    expect(JSON.stringify(DB)).toBe(before);
    const planned = events('web_quiz.sample_ping_planned');
    expect(planned).toHaveLength(1);
    expect(planned[0].dry).toBe(true);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(out.switch_on).toBe(true);
    scan(out);
    allEventsClean();
  });

  test('frameCounts: no event, no settings write, counts equal to dryRun\'s', async () => {
    world({ go: null });
    for (let i = 1; i <= 3; i += 1) family(i, [CLASS(i)]);
    family(4, [null]);
    family(5, [CLASS(5)], { consentV: null });
    family(6, [CLASS(6)], { consentV: 2 });
    const before = JSON.stringify(DB);
    const counts = await Ping.frameCounts({ now: T0 });
    expect(JSON.stringify(DB)).toBe(before);
    expect(logEvent).not.toHaveBeenCalled();
    expect(logToFile).not.toHaveBeenCalled();
    fake.calls.forEach((c) => expect(c.op).toBe('select'));
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(0);
    expect(Ledger.record).not.toHaveBeenCalled();
    scan(counts);
    const out = await Ping.dryRun({ now: T0 });
    expect(events('web_quiz.sample_ping_planned')).toHaveLength(1);
    expect(counts).toEqual({
      term: '2026-27b', frame_n: 6, eligible_n: 4, would_send_n: 4, classes_n: 4, max_per_class: 1,
      excl_loose: 1, excl_drawn: 0, excl_teacher: 0, excl_stop: 0, excl_consent: 1, excl_done: 0,
    });
    Object.keys(counts).forEach((k) => expect(out[k]).toEqual(counts[k]));
  });
});

describe('events off', () => {
  test('switch on, events off, no go: nothing sent and the refusal goes to the log file, not an event', async () => {
    world({ settings: { ...ALL_ON, web_quiz_events_v2: false }, go: null });
    family(1, [CLASS(1)]);
    const transport = fakeTransport();
    const out = await Ping.send({ now: T0, transport });
    expect(out).toEqual({ sent: 0, refused: 'no_go' });
    expect(transport).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    const lines = logToFile.mock.calls.filter((c) => JSON.stringify(c).includes('no_go'));
    expect(lines).toHaveLength(1);
  });
});
