'use strict';
/**
 * The verdict cache (DOOR.md §1.4): a first_door verdict is cached for FIRST_DOOR_TTL_SECS = 60 at
 * student-ingress.js:240 — the guest's ternary gains our reason — never the unknown verdict's 10 minutes, so a tap is
 * honoured within a minute even before the cache forget. A warm first_door verdict is replayed without a read. A
 * non-quiz text still caches today's 10-minute no_student_row (§1.5's re-read in route() is D2's handler).
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

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../shared/services/student-ingress');
const Door = require('../../shared/services/first-touch/door.service');
const Keys = require('../../shared/services/first-touch/door.keys');
const { UNKNOWN_USER, PHONE, SISTER_ON, OURS_ON, seedDb, firstUseReads } = require('./door-fixture');

const SAVED = { ...process.env };
let fake;
function seed(opts = {}) {
  fake = seedDb(supabase, { settings: { ...SISTER_ON, ...OURS_ON }, ...opts });
  IdFlags._resetCache(); HubFlags._resetCache();
  redisService.__keys.clear();
}
const classify = (body) => Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE, body });

beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

test('a cold "quiz" → the chooser verdict cached with ttl 60 (the ttl ARGUMENT asserted), not 600', async () => {
  seed();
  await classify('quiz');
  expect(redisService.set).toHaveBeenCalledTimes(1);
  expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ reason: 'first_door', door: 'chooser' }), Door.FIRST_DOOR_TTL_SECS);
  expect(redisService.set.mock.calls[0][2]).toBe(60);
});

test('a warm first_door verdict is replayed without any read (the same object)', async () => {
  seed();
  const first = await classify('quiz');
  const n = fake.calls.length;
  const second = await classify('quiz');
  expect(second).toEqual(first);
  expect(fake.calls.length).toBe(n);
  expect(firstUseReads(fake)).toBe(1);
});

test('a non-quiz text caches today\'s no_student_row for 10 minutes (today\'s default ttl), as it does today', async () => {
  seed();
  await classify('hello');
  expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ reason: 'no_student_row' }), Ingress.CACHE_TTL_SECS);
  expect(Ingress.CACHE_TTL_SECS).toBe(600);
});

test('a key write forgets the cached verdict (both phone forms), so the next message is decided cold', async () => {
  seed();
  await classify('quiz');
  expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(true);
  await Keys.markTeacher(UNKNOWN_USER.id, PHONE);
  expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(false);
  const v = await classify('quiz');
  expect(v.door).toBe('maker');
  expect(firstUseReads(fake)).toBe(2);
});
