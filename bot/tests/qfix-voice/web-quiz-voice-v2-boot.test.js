'use strict';
/**
 * web_quiz_voice_v2 reaches the quiz page's boot as `voice_v2` (wq.js VOICE_V2), from the hub's switch cache (one
 * SWITCHES row, no read of its own) — the same path as web_quiz_share_page_lang. Missing row or anything but the JSON
 * true: off, and the page is today's. Runs getQuiz for real on the shared fake database (tests/quiz/web-quiz fixtures).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true, setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const F = require('../quiz/web-quiz/web-quiz-identity-fixture');

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'voice-v2-secret', PORTAL_URL: 'https://portal.example.test' }; });
afterAll(() => { process.env = SAVED; });

async function open(row) {
  jest.resetModules();
  const db = F.db({ sessions: [] });
  db.app_settings = [{ key: 'web_quiz_enabled', value: true }, ...(row ? [row] : [])];
  const fake = makeFake(db);
  Object.assign(require('../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  const Hub = require('../../shared/services/quiz/web-quiz-hub-flags');
  Hub.prime(db.app_settings.filter((r) => Hub.KEYS.includes(r.key)));
  const WQ = require('../../shared/services/quiz/web-quiz.service');
  return WQ.getQuiz('AB12CD');
}

test('the switch row is in the hub\'s one read (KEYS)', () => {
  expect(require('../../shared/services/quiz/web-quiz-hub-flags').KEYS).toContain('web_quiz_voice_v2');
});

test('on (JSON true): the page boot carries voice_v2', async () => {
  const out = await open({ key: 'web_quiz_voice_v2', value: true });
  expect(out.voice_v2).toBe(true);
});

test.each([[null], [{ key: 'web_quiz_voice_v2', value: 'true' }], [{ key: 'web_quiz_voice_v2', value: false }]])('off (%p): no voice_v2, today\'s page', async (row) => {
  const out = await open(row);
  expect(out.voice_v2).toBeUndefined();
});
