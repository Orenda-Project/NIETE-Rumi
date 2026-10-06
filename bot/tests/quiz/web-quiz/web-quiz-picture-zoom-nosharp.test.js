/**
 * The picture-zoom module must load, and degrade to "no zoom", where the `sharp` native module
 * is not installed: the root CI job runs the bot's webhook suites without bot/node_modules, and
 * whatsapp-bot.js requires this module transitively (web-quiz.service → internal routes). A
 * top-level require made every one of those suites fail with "Cannot find module 'sharp'".
 */
jest.mock('sharp', () => { throw new Error("Cannot find module 'sharp'"); });

const zoom = require('../../../shared/services/quiz/web-quiz-picture-zoom');

test('the module loads without sharp', () => {
  expect(typeof zoom.zoomFor).toBe('function');
  expect(typeof zoom.crop).toBe('function');
});

test('zoomFor gives no zoom (null) without sharp, instead of throwing', async () => {
  const q = { id: 'q1', question_text: 'Which bin?', media: { option_images: [{ b64: 'AAAA' }, { b64: 'BBBB' }] } };
  await expect(zoom.zoomFor(q)).resolves.toBeNull();
});

test('crop gives null without sharp', async () => {
  await expect(zoom.crop('AAAA', { x: 0, y: 0, w: 0.5, h: 0.5 })).resolves.toBeNull();
});
