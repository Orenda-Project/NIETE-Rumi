'use strict';
/**
 * `sharp` is a native module installed with the bot's dependencies only. The share-picture
 * service is reached from whatsapp-bot.js (through web-quiz-internal.routes.js), so where
 * sharp is absent — the repo-root CI job, which installs root dependencies only — requiring
 * it at module load took down every suite that loads the webhook. The module must load
 * without sharp, and a picture asked for there fails as a picture, not as the whole bot.
 */
jest.mock('sharp', () => { throw new Error("Cannot find module 'sharp'"); }, { virtual: true });
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), headObject: jest.fn(async () => ({ exists: false })) }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(async () => Buffer.from('png')) }));

test('the share-picture service loads where sharp is not installed', () => {
  expect(() => require('../../../shared/services/quiz/web-quiz-art')).not.toThrow();
});

test('the web quiz internal routes load where sharp is not installed', () => {
  expect(() => require('../../../shared/routes/web-quiz-internal.routes')).not.toThrow();
});

test('drawing a picture without sharp fails that picture with a named error', async () => {
  const Art = require('../../../shared/services/quiz/web-quiz-art');
  await expect(Art._drawForTests({ kind: 'card', size: 'og', brand: 'niete', lang: 'en', d: {} }))
    .rejects.toThrow(/sharp/);
});
