'use strict';
/**
 * `sharp` is a native module installed with the bot's dependencies only. The share-picture
 * service is reached from whatsapp-bot.js (through web-quiz-internal.routes.js), so where
 * sharp is absent — the repo-root CI job, which installs root dependencies only — requiring
 * it at module load took down every suite that loads the webhook. The module must load
 * without sharp, and a picture asked for there fails as a picture, not as the whole bot.
 */
// Where sharp IS installed (the bot's own install) the mock is keyed by the real module path; where it is not (the
// repo-root CI) it is virtual. One hoisted virtual mock did both until the suite count grew: in a run of the whole
// web-quiz folder the virtual key stopped matching the service's require and the REAL sharp drew the picture.
let sharpInstalled = false;
try { require.resolve('sharp'); sharpInstalled = true; } catch (_) { sharpInstalled = false; }
jest.doMock('sharp', () => { throw new Error("Cannot find module 'sharp'"); }, sharpInstalled ? undefined : { virtual: true });
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
