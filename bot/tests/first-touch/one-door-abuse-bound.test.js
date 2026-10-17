'use strict';
/**
 * The door's abuse bound (quiz_one_door ON), through the REAL openQuizMenu, role resolver, ledger and token signer;
 * only the edges are faked (supabase as a table double, Redis as a Map, the WhatsApp sends).
 *
 * (a) web_quiz_door_dedupe (JSON true only): the same text from the same phone inside 10 s gets ONE door reply; the
 *     repeat is logged web_quiz.door_dedup{phone_hash, gap_ms} and not answered.
 * (b) web_quiz_door_ceiling (a VALUE: a positive JSON integer, anything else = absent = no ceiling): that many door
 *     replies per phone per PKT day, then ONE web_quiz.reply_capped{trigger:'one_door_reply', counter:'door_ceiling'}
 *     and silence for the rest of that day. A known child's Home reply and a code's answer are never under it.
 *
 * Counters are asserted BY ORDER: uncounted sends are interleaved between counted ones, so a wrong increment moves the
 * cap to a different send number. The clock is pinned (fake Date only) so "3 s apart" and "the next PKT day" are exact.
 */
const { fixturePhone, maskFixturePhones } = require('../quiz/web-quiz/fixture-phone');
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret';
delete process.env.QUIZ_MENU_HANDSET_ROUTING;
delete process.env.QUIZ_MENU_LESSON_ROWS;
delete process.env.WQ_TOMB_SALT;

const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ kind: 'text', to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { mockSent.push({ kind: 'buttons', to, p }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, p) => { mockSent.push({ kind: 'list', to, p }); return true; }),
  sendFlow: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async (to, p) => { mockSent.push({ kind: 'cta', to, p }); return true; }),
  sendTemplate: jest.fn(async () => true),
}));
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/video-quiz.service', () => ({ getActiveState: jest.fn(async () => null) }));
const mockChildOpen = jest.fn(async (phone) => { mockSent.push({ kind: 'child_hub', to: phone }); return true; });
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: (...a) => mockChildOpen(...a) }));

const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const { openQuizMenu } = require('../../shared/services/quiz/quiz-menu-entry.service');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const Ledger = require('../../shared/services/quiz/message-ledger');
const OneDoorFlags = require('../../shared/services/first-touch/one-door.flags');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');

// 11:00 PKT on a fixed day: far from midnight, so only the explicit day jump crosses it
const T0 = Date.parse('2026-10-17T06:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ONLY_DATE = { doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] };
beforeAll(() => { jest.useFakeTimers({ now: T0, ...ONLY_DATE }); });
afterAll(() => { jest.useRealTimers(); });

const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, preferred_language: 'en' };
const PERSONAS = {
  unknown: { user: { id: 'u-unknown', role: null, ...ROW }, phone: fixturePhone(1) },
  child_known: { user: { id: 'u-child', role: null, ...ROW, persona: 'student', personaLanguage: 'en' }, phone: fixturePhone(2) },
  teacher: { user: { id: 'u-teach', role: 'teacher', ...ROW, registration_completed: true, name: 'Asma Testwala' }, phone: fixturePhone(4) },
  other: { user: { id: 'u-other', role: null, ...ROW }, phone: fixturePhone(15) },
};

/** settings: { dedupe, ceiling } are the RAW app_settings values (undefined = no row). */
function world({ oneDoor = true, uncapped = true, dedupe, ceiling, throws = false, extra = [], bindings = [] } = {}) {
  const settings = [...extra];
  if (oneDoor) settings.push({ key: 'quiz_one_door', value: 'true' });
  if (uncapped) settings.push({ key: 'web_quiz_door_uncapped', value: true });
  if (dedupe !== undefined) settings.push({ key: 'web_quiz_door_dedupe', value: dedupe });
  if (ceiling !== undefined) settings.push({ key: 'web_quiz_door_ceiling', value: ceiling });
  mockDb = fakeDb({
    app_settings: settings,
    users: Object.values(PERSONAS).map((p) => ({ ...p.user })),
    lesson_plans: [], coaching_sessions: [], quizzes: [], quiz_sessions: [], quiz_share_codes: [],
    student_lists: [], students: [{ id: 'k-1', student_name: 'Sara Testwala', phone: null, list_id: null, is_active: true, status: 'active' }],
    user_feature_first_use: [], child_phone_bindings: bindings, transcript_quiz_offers: [],
  });
  if (throws) {
    const from = mockDb.from.bind(mockDb);
    mockDb.from = (table) => {
      const b = from(table);
      if (table !== 'app_settings') return b;
      const inner = b.in;
      b.in = (c, v) => { if (Array.isArray(v) && v.includes('quiz_one_door')) throw new Error('app_settings read failed'); return inner(c, v); };
      return b;
    };
  }
  OneDoorFlags._resetCache();
  Gate._resetCache && Gate._resetCache();
  IdFlags._resetCache(); HubFlags._resetCache();
  Ledger._resetCap();
  try { require('../../shared/services/first-touch/door-bound')._reset(); } catch (_) { /* the base: no such module */ }
  redis.__keys.clear();
  jest.setSystemTime(T0);
}

let clock = T0;
const at = (ms) => { clock = ms; jest.setSystemTime(ms); };
async function ask(name, { body = '/quiz', trigger = 'text' } = {}) {
  const p = PERSONAS[name];
  return openQuizMenu({ user: { ...p.user }, from: p.phone, language: 'en', trigger, body: trigger === 'text' ? body : '' });
}
/** n sends `gapMs` apart from `start`; returns the count of door replies (cta or fallback text) they produced. */
async function burst(name, n, gapMs, { start = clock, body } = {}) {
  const before = mockSent.length;
  for (let i = 0; i < n; i += 1) { at(start + i * gapMs); await ask(name, { body }); }
  return mockSent.slice(before).filter((m) => m.kind === 'cta' || m.kind === 'text').length;
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const ceilingCaps = () => events('web_quiz.reply_capped').filter((p) => p.counter === 'door_ceiling');
const stable = (sends) => maskFixturePhones(JSON.parse(JSON.stringify(sends).replace(/\/quiz\/go\/[A-Za-z0-9_.-]+/g, '/quiz/go/<t>')));

beforeEach(() => { mockSent.length = 0; jest.clearAllMocks(); clock = T0; });

// ─────────────────────────────── (a) the repeat-tap dedupe ───────────────────────────────

describe('web_quiz_door_dedupe ON: the same text inside 10 s gets ONE door reply', () => {
  test('two /quiz 3 s apart → 1 reply, 1 door_dedup{phone_hash, gap_ms:3000}', async () => {
    world({ dedupe: true });
    expect(await burst('unknown', 2, 3000)).toBe(1);
    const d = events('web_quiz.door_dedup');
    expect(d).toHaveLength(1);
    expect(d[0]).toEqual(expect.objectContaining({ gap_ms: 3000 }));
    expect(d[0].phone_hash).toMatch(/^[0-9a-f]{16}$/);
    // the log line carries the keyed hash only, never the phone's digits
    expect(JSON.stringify(d[0])).not.toContain(PERSONAS.unknown.phone);
    expect(JSON.stringify(d[0])).not.toContain(PERSONAS.unknown.phone.slice(2));
  });

  test('two /quiz 11 s apart → 2 replies, no door_dedup', async () => {
    world({ dedupe: true });
    expect(await burst('unknown', 2, 11000)).toBe(2);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
  });

  test('a different text inside 10 s → 2 replies', async () => {
    world({ dedupe: true });
    at(T0); await ask('unknown', { body: '/quiz' });
    at(T0 + 3000); await ask('unknown', { body: 'quiz' });
    expect(mockSent.filter((m) => m.kind === 'cta')).toHaveLength(2);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
  });

  test('another phone inside 10 s is its own window → answered', async () => {
    world({ dedupe: true });
    at(T0); await ask('unknown');
    at(T0 + 3000); await ask('other');
    expect(mockSent.filter((m) => m.kind === 'cta')).toHaveLength(2);
  });

  test('the window runs from the ANSWERED send: taps at 0, 3, 6, 9, 12 s → answered at 0 and 12 only', async () => {
    world({ dedupe: true });
    expect(await burst('unknown', 5, 3000)).toBe(2);
    expect(events('web_quiz.door_dedup').map((p) => p.gap_ms)).toEqual([3000, 6000, 9000]);
  });

  test('a repeated menu-row tap inside 10 s → 1 reply', async () => {
    world({ dedupe: true });
    at(T0); await ask('unknown', { trigger: 'menu' });
    at(T0 + 2000); await ask('unknown', { trigger: 'menu' });
    expect(mockSent.filter((m) => m.kind === 'cta')).toHaveLength(1);
  });

  test('a known child\'s /quiz (the Home reply) is never deduped: 2 taps 3 s apart → 2 hub replies', async () => {
    world({ dedupe: true });
    at(T0); await ask('child_known');
    at(T0 + 3000); await ask('child_known');
    expect(mockSent.filter((m) => m.kind === 'child_hub')).toHaveLength(2);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
  });

  test('S02\'s pace: 22 /quiz 12 s apart with the dedupe ON and the ceiling at 100 → 22/22 answered', async () => {
    world({ dedupe: true, ceiling: 100 });
    expect(await burst('unknown', 22, 12000)).toBe(22);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
    expect(events('web_quiz.reply_capped')).toHaveLength(0);
  });

  test('Redis cannot claim the window (setNX fails open) → the door answers: the dedupe never silences on its own failure', async () => {
    world({ dedupe: true });
    redis.setNX.mockImplementation(async () => true);   // the real client's answer with Redis down
    redis.get.mockImplementation(async () => null);
    expect(await burst('unknown', 2, 3000)).toBe(2);
    redis.setNX.mockReset(); redis.get.mockReset();
    const keys = redis.__keys;
    redis.setNX.mockImplementation(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; });
    redis.get.mockImplementation(async (k) => (keys.has(k) ? keys.get(k) : null));
  });

  test('Redis throws on the claim → the door answers both: a thrown dedupe read is never a silence', async () => {
    world({ dedupe: true });
    const real = redis.setNX.getMockImplementation();
    redis.setNX.mockImplementation(async () => { throw new Error('redis down'); });
    try {
      expect(await burst('unknown', 2, 3000)).toBe(2);
      expect(events('web_quiz.door_dedup')).toHaveLength(0);
    } finally { redis.setNX.mockImplementation(real); }
  });
});

describe('web_quiz_door_dedupe OFF: two /quiz 3 s apart → 2 replies, byte for byte as today (golden)', () => {
  const OFF = Object.freeze({ absent: undefined, false: false, string_true: 'true', quoted_true: '"true"', yes: 'yes', one: 1, object: { on: true } });
  test.each(Object.keys(OFF))('switch %s', async (state) => {
    world({ uncapped: true });
    await burst('unknown', 2, 3000);
    const today = stable(mockSent);
    const todayEvents = logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door' || n.startsWith('web_quiz.'));
    mockSent.length = 0; jest.clearAllMocks();
    world({ uncapped: true, dedupe: OFF[state] });
    expect(await burst('unknown', 2, 3000)).toBe(2);
    expect(stable(mockSent)).toEqual(today);
    expect(logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door' || n.startsWith('web_quiz.'))).toEqual(todayEvents);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
  });
});

// ─────────────────────────────── (b) the door ceiling ───────────────────────────────

describe('web_quiz_door_ceiling = 3: three door replies a phone a PKT day, then ONE logged cap and silence', () => {
  test('the 4th /quiz is silent + ONE reply_capped{one_door_reply, door_ceiling}; the 5th silent with no second log', async () => {
    world({ ceiling: 3 });
    const before = mockSent.length;
    for (let i = 0; i < 5; i += 1) {
      at(T0 + i * 12000);
      await ask('unknown');
      const replies = mockSent.length - before;
      expect(replies).toBe(Math.min(i + 1, 3));
      expect(ceilingCaps()).toHaveLength(i >= 3 ? 1 : 0);
    }
    expect(ceilingCaps()[0]).toEqual(expect.objectContaining({ trigger: 'one_door_reply', counter: 'door_ceiling' }));
    // one onboard.quiz_door 'capped' for the first refusal only: the abuse path does not write a line per send
    expect(events('onboard.quiz_door').filter((p) => p.reply === 'capped')).toHaveLength(1);
  });

  test('the next PKT day answers again (and caps again at its own 4th)', async () => {
    world({ ceiling: 3 });
    expect(await burst('unknown', 5, 12000)).toBe(3);
    // 00:00:30 PKT the next day
    const nextDay = Date.parse('2026-10-17T19:00:30.000Z');
    expect(await burst('unknown', 5, 12000, { start: nextDay })).toBe(3);
    expect(ceilingCaps()).toHaveLength(2);
  });

  test('PKT midnight, not UTC midnight, is the day line: 23:59 PKT capped, 00:00:30 PKT answered', async () => {
    world({ ceiling: 1 });
    const lateEvening = Date.parse('2026-10-17T18:58:00.000Z');   // 23:58 PKT
    expect(await burst('unknown', 2, 60000, { start: lateEvening })).toBe(1);
    at(Date.parse('2026-10-17T19:00:30.000Z')); await ask('unknown');
    expect(mockSent.filter((m) => m.kind === 'cta')).toHaveLength(2);
  });

  test('per phone: one phone at the ceiling never silences another', async () => {
    world({ ceiling: 3 });
    expect(await burst('unknown', 4, 12000)).toBe(3);
    expect(await burst('other', 3, 12000)).toBe(3);
  });

  test('a teacher\'s door reply is under it too (it is a door reply)', async () => {
    world({ ceiling: 2 });
    expect(await burst('teacher', 3, 12000)).toBe(2);
    expect(ceilingCaps()).toHaveLength(1);
  });

  test('BY ORDER: a known child\'s Home reply and a code\'s answer from the SAME phone, interleaved, never move the cap', async () => {
    world({ ceiling: 3 });
    const phone = PERSONAS.unknown.phone;
    const got = [];
    for (let i = 0; i < 5; i += 1) {
      at(T0 + i * 12000);
      const n = mockSent.length;
      await ask('unknown');
      got.push(mockSent.length - n);
      // uncounted for the ceiling: each must still be allowed, and must not spend the door's three
      expect(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true })).toBe(true);
      expect(await Ledger.record({ trigger: 'bind_reply', phone, reason: 'bind', ownReply: true })).toBe(true);
    }
    // a wrong increment (home/bind counted on the door's ceiling) would cap at the 2nd /quiz, not the 4th
    expect(got).toEqual([1, 1, 1, 0, 0]);
  });

  test('BY ORDER: a deduped repeat is not a reply and never spends the ceiling (dedupe ON, ceiling 3)', async () => {
    world({ dedupe: true, ceiling: 3 });
    // answered at 0, 12, 24 s; repeats at 3, 15, 27 s are deduped; the 36 s send is the 4th door reply → capped
    const plan = [0, 3, 12, 15, 24, 27, 36];
    const got = [];
    for (const s of plan) { at(T0 + s * 1000); const n = mockSent.length; await ask('unknown'); got.push(mockSent.length - n); }
    expect(got).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(events('web_quiz.door_dedup')).toHaveLength(3);
    expect(ceilingCaps()).toHaveLength(1);
  });

  test('a known child\'s /quiz is never under it: ceiling 1, 3 taps → 3 hub replies', async () => {
    world({ ceiling: 1 });
    expect(await burst('child_known', 3, 12000)).toBe(0);   // the hub reply is the child's, not a door reply
    expect(mockSent.filter((m) => m.kind === 'child_hub')).toHaveLength(3);
    expect(ceilingCaps()).toHaveLength(0);
  });

  test('Redis down: the ceiling still counts in this process (it never fails open)', async () => {
    world({ ceiling: 3 });
    redis.incr.mockImplementation(async () => null);
    expect(await burst('unknown', 5, 12000)).toBe(3);
    expect(ceilingCaps()).toHaveLength(1);
    const keys = redis.__keys;
    redis.incr.mockImplementation(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; });
  });

  test('with the own-reply exemption OFF the ceiling still holds the door (3 < 20): it is its own bound', async () => {
    world({ uncapped: false, ceiling: 3 });
    expect(await burst('unknown', 5, 12000)).toBe(3);
    expect(ceilingCaps()).toHaveLength(1);
  });
});

describe('web_quiz_door_ceiling ABSENT (or not a positive JSON integer) → no ceiling: today\'s door, byte for byte', () => {
  test('ABSENT → 30 /quiz in one PKT day → 30 replies, no reply_capped (golden vs no row)', async () => {
    world({});
    expect(await burst('unknown', 30, 12000)).toBe(30);
    expect(events('web_quiz.reply_capped')).toHaveLength(0);
  });

  const NOT_A_CEILING = Object.freeze({
    string_100: '100', string_3: '3', zero: 0, negative: -3, fraction: 2.5, bool_true: true, null_value: null,
    object: { n: 3 }, array: [3], word: 'three', empty: '',
  });
  test.each(Object.keys(NOT_A_CEILING))('%s → absent: 5 /quiz → 5 replies, byte for byte as with no row', async (name) => {
    world({});
    await burst('unknown', 5, 12000);
    const today = stable(mockSent);
    const todayEvents = logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door' || n.startsWith('web_quiz.'));
    mockSent.length = 0; jest.clearAllMocks();
    world({ ceiling: NOT_A_CEILING[name] });
    expect(await burst('unknown', 5, 12000)).toBe(5);
    expect(stable(mockSent)).toEqual(today);
    expect(logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door' || n.startsWith('web_quiz.'))).toEqual(todayEvents);
  });

  test('a settings read that throws (both keys ride the door\'s ONE read) → the door reads OFF, as today', async () => {
    world({ throws: true });
    await burst('unknown', 3, 3000);
    const today = stable(mockSent);
    mockSent.length = 0; jest.clearAllMocks();
    world({ throws: true, dedupe: true, ceiling: 1 });
    await burst('unknown', 3, 3000);
    expect(stable(mockSent)).toEqual(today);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
    expect(ceilingCaps()).toHaveLength(0);
  });

  test('the flags reader: ceiling is a positive JSON integer or null; dedupe is JSON true only', async () => {
    const cases = [[3, 3], [100, 100], ['100', null], [0, null], [-1, null], [2.5, null], [true, null], [null, null], [undefined, null]];
    for (const [value, want] of cases) {
      world({ ceiling: value, dedupe: 'true' });
      const f = await OneDoorFlags.flags();
      expect([value, f.doorCeiling]).toEqual([value, want]);
      expect(f.doorDedupe).toBe(false);
    }
    world({ dedupe: true });
    expect((await OneDoorFlags.flags()).doorDedupe).toBe(true);
  });
});

// ───────────── a child the DOOR resolves (a live phone binding; not the menu's handset routing) ─────────────

describe('a known child resolved BY THE DOOR is never under the bound (one-door.service child branch)', () => {
  const SISTERS = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true }];
  const FUTURE = new Date(T0 + 30 * DAY_MS).toISOString();
  const bound = () => [{ id: 'b-1', canonical_id: 'k-1', phone_norm: BindRepo.normalisePhone(PERSONAS.unknown.phone), revoked_at: null, expires_at: FUTURE, bound_at: '2026-10-01T00:00:00Z', via: 'guest' }];
  beforeAll(() => { process.env.WQ_TOMB_SALT = 'unit-salt-not-a-secret'; });
  afterAll(() => { delete process.env.WQ_TOMB_SALT; });

  test('dedupe ON + ceiling 1: 3 taps 3 s apart from a bound phone → 3 hub replies, the door\'s own child branch each time', async () => {
    world({ dedupe: true, ceiling: 1, extra: SISTERS, bindings: bound() });
    await burst('unknown', 3, 3000);
    expect(mockSent.map((m) => m.kind)).toEqual(['child_hub', 'child_hub', 'child_hub']);
    // the door answered (not the menu's persona routing): its child-hub event, once a tap
    expect(events('onboard.quiz_door').filter((p) => p.verdict === 'child' && p.how === 'child_hub')).toHaveLength(3);
    expect(events('web_quiz.door_dedup')).toHaveLength(0);
    expect(ceilingCaps()).toHaveLength(0);
  });

  test('the bound child\'s hub replies are not door replies: ceiling 2 → 3 hub replies, and another phone still gets its own 2', async () => {
    world({ ceiling: 2, extra: SISTERS, bindings: bound() });
    expect(await burst('unknown', 3, 12000)).toBe(0);   // three hub replies, not door replies
    expect(mockSent.filter((m) => m.kind === 'child_hub')).toHaveLength(3);
    expect(await burst('other', 3, 12000)).toBe(2);     // the unbound phone still has its own two
    expect(ceilingCaps()).toHaveLength(1);
  });
});
