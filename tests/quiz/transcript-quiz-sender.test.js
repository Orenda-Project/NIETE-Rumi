'use strict';
/**
 * bd-mg9c7.15 — every child-facing send is throttled, and the picker chrome
 * follows the quiz language. Own file: the throttle mock must be installed
 * before the sender is first required, which jest.mock at file scope
 * guarantees and a doMock inside a shared suite does not.
 */
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const rateLimiter = require('../../bot/shared/services/quiz/video-quiz-rate-limiter.service');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const sender = require('../../bot/shared/services/quiz/video-quiz-sender.service');

beforeEach(() => jest.clearAllMocks());

test('sendPhase awaits the per-recipient throttle before each send', async () => {
  const msgs = [{ phase: 'question', kind: 'text', body: 'a', seq: 0 }, { phase: 'question', kind: 'text', body: 'b', seq: 1 }];
  const r = await sender.sendPhase('923001234567', msgs, 'question', { questionId: 'q' });
  expect(r.sent).toBe(2);
  expect(rateLimiter.throttle).toHaveBeenCalledTimes(2);
  expect(rateLimiter.throttle).toHaveBeenCalledWith('923001234567');
});

test('the list picker chrome follows the quiz language', async () => {
  const msgs = [{ phase: 'interaction', kind: 'list', body: 'سوال', options: ['a', 'b', 'c', 'd'], optionIndices: [0, 1, 2, 3], role: 'ask' }];
  await sender.sendPhase('923001234567', msgs, 'interaction', { questionId: 'q', language: 'ur' });
  const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
  expect(payload.action.button).toMatch(/[؀-ۿ]/);
  expect(payload.action.sections[0].title).toMatch(/[؀-ۿ]/);
  await sender.sendPhase('923001234567', msgs, 'interaction', { questionId: 'q', language: 'en' });
  expect(WhatsAppService.sendInteractiveMessage.mock.calls[1][1].action.button).toBe('Choose answer');
});

test('list rows never strand a sacred name from its honorific at the 72-code-point cut', () => {
  const long = 'یہ ایک بہت لمبا جواب ہے جو بار بار دہرایا جاتا ہے تاکہ حد سے بڑھ جائے اور آخر میں نبی کریم ﷺ آئے';
  const rows = sender.listRows([long, 'b'], { questionId: 'q' }, [0, 1]);
  expect([...rows[0].description].length).toBeLessThanOrEqual(72);
  expect(rows[0].description.endsWith('نبی کریم')).toBe(false);
});
