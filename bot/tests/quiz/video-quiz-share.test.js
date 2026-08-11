'use strict';
/**
 * bd-2313..2316 — share-code parsing and minting.
 *
 * The parser runs on EVERY inbound text before any other routing, so its
 * precision matters more than most: a false positive hijacks an ordinary
 * message into a quiz, and a false negative leaves a child staring at a link
 * that did nothing.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logToFile } = require('../../shared/utils/logger');
const share = require('../../shared/services/quiz/video-quiz-share.service');

describe('share code parsing', () => {
  test('matches the code the wa.me link pre-fills', () => {
    expect(share.parseShareCode('QUIZ-A7K3M2')).toBe('A7K3M2');
  });

  test('matches case-insensitively but returns upper case', () => {
    expect(share.parseShareCode('quiz-a7k3m2')).toBe('A7K3M2');
  });

  test('finds the code when a child types around it', () => {
    expect(share.parseShareCode('hi QUIZ-A7K3M2 please')).toBe('A7K3M2');
  });

  test('does NOT claim ordinary messages', () => {
    ['quiz', 'I want a quiz', 'QUIZ-', 'QUIZ-ABC', 'send me QUIZZES',
     'my quiz-time is 4pm', ''].forEach((t) => {
      expect(share.parseShareCode(t)).toBeNull();
    });
  });

  test('does not match a longer alphanumeric run', () => {
    // A 7-char tail must not be silently truncated to 6 and accepted.
    expect(share.parseShareCode('QUIZ-A7K3M2X')).toBeNull();
  });
});

describe('generated codes', () => {
  test('are six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const c = share.randomCode();
      expect(c).toHaveLength(6);
      // O/0, I/1 and S/5 are excluded: a child may retype this off a
      // relative's screen, and a misread character is a dead link.
      expect(c).not.toMatch(/[OI01S5]/);
      expect(share.parseShareCode(`QUIZ-${c}`)).toBe(c);
    }
  });

  test('every generated code round-trips through the parser', () => {
    const c = share.randomCode();
    expect(share.parseShareCode(`https://wa.me/923295012345?text=QUIZ-${c}`)).toBe(c);
  });
});

describe('bot number for the link', () => {
  const OLD_ENV = process.env.WHATSAPP_BOT_NUMBER;
  beforeEach(() => { process.env.WHATSAPP_BOT_NUMBER = '923206281951'; });
  afterEach(() => { process.env.WHATSAPP_BOT_NUMBER = OLD_ENV; });

  test('is digits only, so wa.me never receives a + or spaces', () => {
    expect(share.botNumber()).toMatch(/^\d+$/);
  });

  // bd-2482 (NIETE port): botNumber() must NEVER fall back to another
  // deployment's number — an unset var must fail loud (empty string, logged),
  // not silently point a child at the wrong bot.
  test('with no env var configured, returns empty rather than a wrong number', () => {
    delete process.env.WHATSAPP_BOT_NUMBER;
    delete process.env.REFERRAL_BOT_NUMBER;
    expect(share.botNumber()).toBe('');
  });
});

/**
 * bd-2477 issue #3 — the "send this quiz to your class again?" offer did not
 * appear after a quiz completed.
 *
 * Root cause, confirmed via Axiom (digital-coach-logs, 2026-08-03, same
 * session as bd-2477 #1): WhatsApp's per-recipient-pair rate limit (#131056)
 * was still active in the instant finish() ran offerShare() — the failing
 * `whatsapp.message.failed` events continue right up to the same millisecond
 * as `video_quiz.completed`. offerShare()'s `sendInteractiveButtons` call
 * never checks its own return value, so the failed send was silently dropped
 * — no retry, no log line, nothing. The teacher's screen just never showed
 * the offer.
 */
describe('bd-2477 #3 — a failed share offer must not vanish silently', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('retries once after a backoff when the first send fails', async () => {
    WhatsAppService.sendInteractiveButtons
      .mockResolvedValueOnce(false)   // rate-limited, same as bd-2477's failures
      .mockResolvedValueOnce(true);   // the window clears

    const promise = share.offerShare({
      phone: '923365709413', userId: 'u1', quizId: 'qz1', videoId: 'v1', language: 'en',
    });
    await jest.runAllTimersAsync();
    await promise;

    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(2);
  });

  test('logs loudly, never silently, if both the send and the retry fail', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(false);

    const promise = share.offerShare({
      phone: '923365709413', userId: 'u1', quizId: 'qz1', videoId: 'v1', language: 'en',
    });
    await jest.runAllTimersAsync();
    await promise;

    expect(logToFile).toHaveBeenCalledWith(
      expect.stringContaining('share offer'),
      expect.objectContaining({ phone: expect.any(String) }),
    );
  });

  test('does not retry (and does not log a failure) when the first send succeeds', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);

    await share.offerShare({
      phone: '923365709413', userId: 'u1', quizId: 'qz1', videoId: 'v1', language: 'en',
    });

    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(logToFile).not.toHaveBeenCalled();
  });
});
