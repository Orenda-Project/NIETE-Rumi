'use strict';
/**
 * The seam family.door.js > child-phone-bindings.repo, with the REAL repo: the family door's event key on
 * "Change my choice" is the repo's ukeyOf over its own normalisePhone — the SAME value the chat's door puts on
 * onboard.quiz_door for that phone, in either phone form — and never the phone. Only the network is faked
 * (supabase, Redis, the WhatsApp send, the loggers).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const Reply = require('../../shared/services/first-touch/door.reply');
const FamilyDoor = require('../../shared/services/first-touch/family.door');
const { PHONE, PHONE_PLUS } = require('./door-fixture');
const { ENV } = require('./_door-turn');

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, ...ENV }; jest.clearAllMocks(); });
afterAll(() => { process.env = SAVED; });

test('the page\'s ukey is the repo\'s ukeyOf(normalisePhone(phone)) — equal to the chat door\'s for both phone forms, never the phone', () => {
  const want = BindRepo.ukeyOf(BindRepo.normalisePhone(PHONE));
  expect(want).toMatch(/^[0-9a-f]{16}$/);
  expect(FamilyDoor.ukeyOf(PHONE)).toBe(want);
  expect(FamilyDoor.ukeyOf(PHONE_PLUS)).toBe(want);
  expect(FamilyDoor.ukeyOf(PHONE)).toBe(Reply.ukeyFor(PHONE));
  expect(FamilyDoor.ukeyOf(PHONE)).not.toContain(PHONE);
});

test('no key configured → null (the event then carries no ukey field), never a phone in its place', () => {
  delete process.env.WEB_QUIZ_KID_KEY;
  expect(FamilyDoor.ukeyOf(PHONE)).toBeNull();
  expect(FamilyDoor.ukeyOf(null)).toBeNull();
});
