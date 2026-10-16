'use strict';
/**
 * DOOR.md §8.4 / SPEC §8.7 — the registration invite never reaches a family phone or a door turn. The unprompted offer
 * (offerRegistrationOnce: after her first reply, after a feature) asks the door's guard first: a phone holding
 * quiz_door_child, or a phone whose turn the door just answered with the chooser / the family reply / the capped reply,
 * is not offered the form. A known teacher, a complete account and both switches OFF: byte-identical. A guard that
 * throws or a key read that fails → no invite (the safe side). Only the network boundary is faked.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const Invite = require('../../shared/services/registration-invite.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const Guard = require('../../shared/services/first-touch/door.invite-guard');
const T = require('./_door-turn');
const { UNKNOWN_USER, PHONE, TABLE, firstUse, fixturePhone } = require('./door-fixture');

const SAVED = { ...process.env };
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV, REGISTRATION_FLOW_ID: 'flow-reg-unit' };
  jest.clearAllMocks();
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
  WhatsAppService.sendFlow.mockResolvedValue(true);
  Guard._forget();
});
afterEach(() => { Reply._deps.makerCta = undefined; jest.dontMock('../../shared/services/first-touch/door.invite-guard'); });
afterAll(() => { process.env = SAVED; });

const offer = (phone = PHONE, reason = 'first_reply') => Invite.offerRegistrationOnce({ user: { id: UNKNOWN_USER.id }, phone, language: 'en', reason });
const invites = () => WhatsAppService.sendFlow.mock.calls.length;
const usersTrace = () => T.state.fake.calls.filter((c) => c.table === 'users').map((c) => `${c.op}`);

test('a keyless unknown phone, no door turn: the offer goes as today (one Flow)', async () => {
  T.seed();
  expect(await offer(fixturePhone(931))).toBe(true);
  expect(invites()).toBe(1);
});

test('a phone holding quiz_door_child: never offered, nothing claimed', async () => {
  T.seed({ rows: [firstUse('quiz_door_child')] });
  expect(await offer()).toBe(false);
  expect(invites()).toBe(0);
  expect(usersTrace()).not.toContain('update');
});

test('the chooser turn: never offered in that turn', async () => {
  T.seed();
  await T.text('quiz');
  expect(T.doorEvents().slice(-1)[0].reply).toBe('chooser');
  expect(await offer()).toBe(false);
  expect(invites()).toBe(0);
});

test('the family reply turn: never offered', async () => {
  T.seed();
  await T.text('child');
  expect(T.doorEvents().slice(-1)[0].reply).toBe('family');
  expect(await offer()).toBe(false);
  expect(invites()).toBe(0);
});

test('the capped reply turn: never offered', async () => {
  T.seed({ rows: [firstUse('quiz_door_asked', { count: 2 })] });
  await T.text('quiz');
  expect(T.doorEvents().slice(-1)[0].reply).toBe('capped_family');
  expect(await offer()).toBe(false);
  expect(invites()).toBe(0);
});

test('the key read fails → no invite (the safe side)', async () => {
  T.seed({ throwOn: TABLE });
  expect(await offer(fixturePhone(932))).toBe(false);
  expect(invites()).toBe(0);
});

test('the guard module throws at require → no invite', async () => {
  jest.resetModules();
  jest.doMock('../../shared/services/first-touch/door.invite-guard', () => { throw new Error('boom'); });
  const Inv = require('../../shared/services/registration-invite.service');
  const WA = require('../../shared/services/whatsapp.service');
  require('./_door-turn').seed();
  expect(await Inv.offerRegistrationOnce({ user: { id: UNKNOWN_USER.id }, phone: fixturePhone(933), language: 'en', reason: 'first_reply' })).toBe(false);
  expect(WA.sendFlow).not.toHaveBeenCalled();
});

test('both OFF: the offer as today, no key read — a child-keyed phone too (the door never ran)', async () => {
  T.seed({ settings: {}, rows: [firstUse('quiz_door_child')] });
  expect(await offer()).toBe(true);
  expect(invites()).toBe(1);
  expect(T.keyReads()).toBe(0);
});

test('a complete (known) teacher: never offered, as today, and the door\'s keys never read', async () => {
  T.seed();
  T.state.fake.db.users[0] = { ...T.state.fake.db.users[0], name: 'Teacher Testwala', role: 'teacher', school_id: 'sch-1', registration_completed: true, registration_state: 'completed' };
  expect(await offer()).toBe(false);
  expect(invites()).toBe(0);
  expect(T.keyReads()).toBe(0);
});
