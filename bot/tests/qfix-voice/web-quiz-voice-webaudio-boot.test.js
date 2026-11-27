'use strict';
/**
 * web_quiz_voice_webaudio reaches the quiz page's boot as `voice_wa` (wq.js VOICE_WA), from the hub's switch cache (one
 * SWITCHES row, no read of its own), and the page's audio_wa event keeps its outcome on the relay (cleanEvent).
 * Missing row or anything but the JSON true: off, and the page is today's.
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
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'voice-wa-secret', PORTAL_URL: 'https://portal.example.test' }; });
afterAll(() => { process.env = SAVED; });

const QID = '99999991-9999-4999-8999-999999999999';

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
  expect(require('../../shared/services/quiz/web-quiz-hub-flags').KEYS).toContain('web_quiz_voice_webaudio');
});

test('on (JSON true): the page boot carries voice_wa', async () => {
  const out = await open({ key: 'web_quiz_voice_webaudio', value: true });
  expect(out.voice_wa).toBe(true);
});

test.each([[null], [{ key: 'web_quiz_voice_webaudio', value: 'true' }], [{ key: 'web_quiz_voice_webaudio', value: false }]])('off (%p): no voice_wa, today\'s page', async (row) => {
  const out = await open(row);
  expect(out.voice_wa).toBeUndefined();
});

test('audio_wa keeps its outcome, how, step, part, question, time, host and format; never an address', () => {
  jest.resetModules();
  const { cleanEvent } = require('../../shared/services/quiz/web-quiz.service');
  expect(cleanEvent({ n: 'audio_wa', ok: true, how: 'rescue', part: 'q', qid: QID, ms: 1400, host: 'r2', fmt: 'ogg' }).props)
    .toEqual({ ok: true, how: 'rescue', part: 'q', qid: QID, ms: 1400, host: 'r2', fmt: 'ogg' });
  expect(cleanEvent({ n: 'audio_wa', ok: false, how: 'rescue', step: 'decode', host: 'https://acct.r2.cloudflarestorage.com/b/k.ogg' }).props)
    .toEqual({ ok: false, how: 'rescue', step: 'decode' });
});
