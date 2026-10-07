/**
 * The bot logs web_quiz.config once when it starts serving. The REAL
 * startServer() runs; the port bind and the boundaries are faked, and the event
 * logger is the observed boundary.
 */
const mockEvent = jest.fn();

describe('web_quiz.config at bot boot', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({
      ...jest.requireActual('../../bot/shared/utils/structured-logger'),
      logEvent: (...a) => mockEvent(...a),
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }), get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { fromMock } = require('./helpers/supabase-chain');
      return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
    });
  });

  test('one line with the resolved names, before the port is bound', async () => {
    const saved = { a: process.env.WEB_QUIZ_AUDIO_BUCKET, b: process.env.WEB_QUIZ_BASE_URL };
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-x';
    process.env.WEB_QUIZ_BASE_URL = 'https://kids.example.test';
    try {
      const bot = require('../../bot/whatsapp-bot');
      const order = [];
      jest.spyOn(bot.app, 'listen').mockImplementation(() => { order.push('listen'); return { close() {} }; });
      mockEvent.mockImplementation((name) => { if (name === 'web_quiz.config') order.push('config'); });
      bot.startServer();
      const lines = mockEvent.mock.calls.filter((c) => c[0] === 'web_quiz.config').map((c) => c[1]);
      expect(lines).toEqual([expect.objectContaining({ audioBucket: 'quiz-audio-x', childVoiceBucket: 'quiz-audio-x', baseHost: 'kids.example.test' })]);
      expect(order).toEqual(['config', 'listen']);
    } finally {
      for (const [k, v] of [['WEB_QUIZ_AUDIO_BUCKET', saved.a], ['WEB_QUIZ_BASE_URL', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
