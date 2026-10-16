'use strict';
/**
 * The seam door.reply.js > child-phone-bindings.repo, with the REAL repo: the door's event key is the repo's
 * ukeyOf over its own normalisePhone (the same function the binder re-exports), on the event and in the family token's
 * `uk` claim; never the phone. Only the network is faked (supabase, Redis, the WhatsApp send, the loggers).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const Ledger = require('../../shared/services/quiz/message-ledger');
const Reply = require('../../shared/services/first-touch/door.reply');
const FamilyToken = require('../../shared/services/first-touch/family.token');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const { UNKNOWN_USER, PHONE, PHONE_PLUS } = require('./door-fixture');
const { ENV } = require('./_door-turn');

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, ...ENV };
  jest.clearAllMocks();
  const fake = makeFake({ app_settings: [], message_ledger: [] });
  supabase.from = fake.from;
  supabase.rpc = fake.rpc;
  Ledger._resetCap();
});
afterAll(() => { process.env = SAVED; });

test('the event key is the repo\'s ukeyOf(normalisePhone(phone)) for both phone forms, and never the phone', () => {
  const want = BindRepo.ukeyOf(BindRepo.normalisePhone(PHONE));
  expect(want).toMatch(/^[0-9a-f]{16}$/);
  expect(Reply.ukeyFor(PHONE)).toBe(want);
  expect(Reply.ukeyFor(PHONE_PLUS)).toBe(want);
  Reply.logDoor({ from: PHONE, user: UNKNOWN_USER, door: 'undo', store: 'child', reply: 'family', lang: 'bi', script: 'latin' });
  const [[name, ev]] = logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door');
  expect(name).toBe('onboard.quiz_door');
  expect(ev.ukey).toBe(want);
  expect(JSON.stringify(ev)).not.toContain(PHONE);
});

test('no key configured → no ukey field at all (never a null or a phone in its place)', () => {
  delete process.env.WEB_QUIZ_KID_KEY;
  expect(Reply.ukeyFor(PHONE)).toBeNull();
  Reply.logDoor({ from: PHONE, user: UNKNOWN_USER, door: 'text', reply: 'chooser', lang: 'bi', script: 'latin' });
  const ev = logEvent.mock.calls.find(([n]) => n === 'onboard.quiz_door')[1];
  expect('ukey' in ev).toBe(false);
});

test('the family reply\'s token carries the same ukey as `uk`, the uid and the lang; no phone', async () => {
  const ukey = Reply.ukeyFor(PHONE);
  await expect(Reply.sendFamilyReply({ from: PHONE, user: UNKNOWN_USER, lang: 'bi', ukey })).resolves.toBe('family');
  const { url } = WhatsAppService.sendCtaUrl.mock.calls[0][1];
  const claims = FamilyToken.verifyFamilyToken(url.split('/f/')[1]);
  expect(claims).toEqual(expect.objectContaining({ k: 'f', uid: UNKNOWN_USER.id, lang: 'bi', uk: ukey }));
  expect(url).not.toContain(PHONE);
  expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(FamilyToken.FAMILY_TTL_S);
  expect(FamilyToken.verifyFamilyToken(url.split('/f/')[1].replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
});
