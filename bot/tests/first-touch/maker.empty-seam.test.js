'use strict';
/**
 * The empty line's event key through the REAL phone-bindings repo: onboard.quiz_door{door:'empty'} carries the
 * sister's ukeyOf of the teacher's phone, never the phone itself.
 * Only the network is faked (supabase, Redis, WhatsApp); the repo is never mocked.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Ledger = require('../../shared/services/quiz/message-ledger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const { emptyLine } = require('../../shared/services/first-touch/maker.empty');
const { seedMaker, TEACHER, PHONE } = require('./maker-fixture');

const SAVED = { ...process.env };

beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_BASE_URL: 'https://portal.example.test', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret' };
  jest.clearAllMocks();
  jest.restoreAllMocks();
  seedMaker(supabase);
  IdFlags._resetCache();
  Ledger._resetCap();
  jest.spyOn(Ledger, 'record').mockResolvedValue(true);
});
afterAll(() => { process.env = SAVED; });

const doorEvents = () => logEvent.mock.calls.filter(([n]) => n === 'onboard.quiz_door').map(([, f]) => f);

test('the event key is the real repo\'s ukeyOf of the phone; the phone itself is in no field', async () => {
  await expect(emptyLine({ user: TEACHER, phone: PHONE, lang: 'en' })).resolves.toBe(true);
  const want = BindRepo.ukeyOf(BindRepo.normalisePhone(PHONE));
  expect(want).toMatch(/^[0-9a-f]{16}$/);
  expect(doorEvents()).toEqual([{ door: 'empty', reply: 'maker', ukey: want, w: 's' }]);
  expect(JSON.stringify(doorEvents())).not.toContain(PHONE);
});
