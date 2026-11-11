'use strict';
/**
 * "Is this you?" (bd-apnnh2.6, plan sections 2.2 to 2.4 and 5.3): who is asked, at "Pick your school".
 *
 * offer() looks for ONE other live account at the picked school with her normalised name, and asks about it only when
 * that account is unused (state "unused") or silent for over 30 days (state "silent"). It reads only, never throws,
 * and logs `registration.is_this_you` with keyed references: never a phone number, a name or a raw id. With the switch
 * off it reads no account and logs nothing, so the feature costs nothing until it is turned on.
 *
 * Only the edges are doubled: the database (an in-memory table fake), Redis and the file logger. The structured event
 * logger is real, spied.
 */
const { recordingDb } = require('./helpers/recording-db');

let mockDb;
const mockReads = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (name) => { mockReads.push(name); return mockDb.client.from(name); },
}));
const mockRedis = { up: true, allowed: true };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockRedis.up,
  checkRateLimit: jest.fn(async () => ({ allowed: mockRedis.allowed })),
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const StructuredLogger = require('../../bot/shared/utils/structured-logger');
const ItU = require('../../bot/shared/services/identity/is-this-you');

const fx = (n) => `92000${String(n).padStart(7, '0')}`;            // synthetic, never a real mobile
const HER = 'b0000000-0000-4000-8000-000000000001';
const REC = 'b0000000-0000-4000-8000-000000000002';
const REC2 = 'b0000000-0000-4000-8000-000000000003';
const OTHER = 'b0000000-0000-4000-8000-000000000009';
const SCHOOL = 'aaaaaaaa-0000-4000-8000-000000000003';
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const her = (o = {}) => ({
  id: HER, phone_number: fx(1), name: null, role: 'teacher', school_id: null, is_test_user: false, deleted_at: null,
  deleted_by: null, registration_completed: false, created_at: ago(60 * 1000), first_message_at: ago(58 * 1000), ...o,
});
const record = (o = {}) => ({
  id: REC, phone_number: fx(247), name: 'AYESHA SIDDIQA', role: 'teacher', school_id: SCHOOL, is_test_user: false,
  deleted_at: null, registration_completed: false, first_message_at: null, last_message_at: null, portal_last_login: null, ...o,
});
const world = ({ users, chats = [], plans = [], ...o }) => {
  const flag = 'flag' in o ? o.flag : true;               // flag: undefined means no row at all (the default: off)
  mockDb = recordingDb({
    users,
    app_settings: flag === undefined ? [] : [{ key: 'registration_is_this_you_enabled', value: flag }],
    chat_sessions: chats, lesson_plans: plans,
  });
};
const ask = (fullName = 'Ayesha Siddiqa') => ItU.offer({ userId: HER, schoolId: SCHOOL, fullName });
const events = () => StructuredLogger.logEvent.mock.calls.filter(([name]) => name === 'registration.is_this_you');

beforeEach(() => {
  mockReads.length = 0;
  mockRedis.up = true;
  mockRedis.allowed = true;
  jest.spyOn(StructuredLogger, 'logEvent');
});
afterEach(() => jest.restoreAllMocks());

test('O1: one unused account with her name at her school: asked, state unused, the last two digits of its number', async () => {
  world({ users: [her(), record()] });
  await expect(ask()).resolves.toEqual({ ask: true, why: null, state: 'unused', candidate: { id: REC, last2: '47' } });
  const [[, ev]] = events();
  expect(ev).toMatchObject({ step: 'offer', outcome: 'asked', why: null, state: 'unused' });
});

test('O2: an account that messaged 3 days ago is in use: not asked (active)', async () => {
  world({ users: [her(), record({ first_message_at: ago(40 * DAY), last_message_at: ago(3 * DAY) })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'active' });
});

test('O2: a portal login 3 days ago is in use too', async () => {
  world({ users: [her(), record({ portal_last_login: ago(3 * DAY) })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'active' });
});

test('O3: last message 45 days ago: asked, state silent', async () => {
  world({ users: [her(), record({ first_message_at: ago(90 * DAY), last_message_at: ago(45 * DAY) })] });
  await expect(ask()).resolves.toMatchObject({ ask: true, state: 'silent', candidate: { id: REC, last2: '47' } });
});

test('O3: an account with chats but no message dates is silent, not unused', async () => {
  world({ users: [her(), record()], chats: [{ id: 'c1', user_id: REC }] });
  await expect(ask()).resolves.toMatchObject({ ask: true, state: 'silent' });
});

test('O4: two accounts with her name: not asked (several)', async () => {
  world({ users: [her(), record(), record({ id: REC2, phone_number: fx(248) })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'several' });
});

test('O5: retired, merged and deleted accounts are ignored', async () => {
  world({ users: [her(),
    record({ phone_number: `retired:${REC}` }),
    record({ id: REC2, phone_number: `merged:${REC2}` }),
    record({ id: OTHER, phone_number: fx(249), deleted_at: ago(DAY) })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'no_match' });
});

test('O6: a test account never matches a real one, either way round', async () => {
  world({ users: [her(), record({ is_test_user: true })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'no_match' });
  world({ users: [her({ is_test_user: true }), record()] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'no_match' });
  world({ users: [her({ is_test_user: true }), record({ is_test_user: true })] });
  await expect(ask()).resolves.toMatchObject({ ask: true });
});

test('O7: names match after case, spacing and punctuation; an initial does not match a full name', async () => {
  world({ users: [her(), record({ name: 'AYESHA  Siddiqa.' })] });
  await expect(ask('ayesha siddiqa')).resolves.toMatchObject({ ask: true });
  world({ users: [her(), record({ name: 'Muhammad Ali' })] });
  await expect(ask('M. Ali')).resolves.toMatchObject({ ask: false, why: 'no_match' });
});

test('O7: another school is not a match', async () => {
  world({ users: [her(), record({ school_id: 'aaaaaaaa-0000-4000-8000-000000000004' })] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'no_match' });
});

test('O8: her own account already registered: not asked', async () => {
  world({ users: [her({ registration_completed: true }), record()] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'already_registered' });
});

test.each([['absent', undefined], ['false', false], ['junk', 'maybe']])(
  'O9: switch %s: not asked, no account read, no event', async (_label, flag) => {
    world({ users: [her(), record()], flag });
    await expect(ask()).resolves.toEqual({ ask: false, why: 'flag_off' });
    expect(mockReads).not.toContain('users');
    expect(events()).toHaveLength(0);
  },
);

test('O10: a testers list without her account: not asked; with it: asked', async () => {
  world({ users: [her(), record()], flag: [OTHER] });
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'flag_off' });
  world({ users: [her(), record()], flag: [HER] });
  await expect(ask()).resolves.toMatchObject({ ask: true, state: 'unused' });
});

test('O11: a fourth ask within 24 hours is rate limited', async () => {
  world({ users: [her(), record()] });
  mockRedis.allowed = false;
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'rate_limited' });
});

test('O11: Redis down: not asked', async () => {
  world({ users: [her(), record()] });
  mockRedis.up = false;
  await expect(ask()).resolves.toMatchObject({ ask: false, why: 'unreadable' });
});

test('O12: a refused read or an unreachable database: unreadable, and never throws', async () => {
  world({ users: [her(), record()] });
  mockDb.refuseRead = (t) => t === 'users';
  await expect(ask()).resolves.toEqual({ ask: false, why: 'unreadable' });
  world({ users: [her(), record()] });
  mockDb.down = true;                                     // the switch read fails first, and a failed read is off
  await expect(ask()).resolves.toMatchObject({ ask: false });
});

test('O13: no logged field holds a phone number, a name or a raw account id', async () => {
  world({ users: [her(), record()] });
  await ask();
  world({ users: [her(), record(), record({ id: REC2, phone_number: fx(248) })] });
  await ask();
  const logged = JSON.stringify(events());
  expect(events().length).toBeGreaterThanOrEqual(2);
  for (const secret of [fx(1), fx(247), fx(248), HER, REC, REC2]) expect(logged).not.toContain(secret);
  expect(logged.toLowerCase()).not.toContain('ayesha');
});
