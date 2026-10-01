'use strict';
/**
 * NQ6 — a child hears each refusal line ONCE a day; a repeat gets a free
 * reaction, and a sticker gets nothing (the same rule as for a teacher).
 *
 * A child who kept sending voice notes was sent "I can only read typed messages
 * here — please type your question." every single time — up to 65 times in one
 * day on one handset (prod, 24-30 Sep 2026: 3,515 refusals, 1,730 of them a
 * repeat of the same line on the same handset the same day). From 1 Oct every
 * one of those is a billed message; a reaction is not.
 *
 * Driven through the REAL student-ingress route(); WhatsApp and Redis are the
 * stand-ins, Redis with real set-if-absent semantics.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockKv.has(k) ? mockKv.get(k) : null)),
  set: jest.fn(async (k, v) => { mockKv.set(k, v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockKv.has(k)) return false; mockKv.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockKv.delete(k); return true; }),
}));
const mockSent = [];
let mockReactionOk = true;
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ fn: 'sendMessage', to, text }); return true; }),
  sendReaction: jest.fn(async (to, id, emoji) => { mockSent.push({ fn: 'sendReaction', to, id, emoji }); return mockReactionOk; }),
  sendInteractiveButtons: jest.fn(async () => true),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Ingress = require('../../bot/shared/services/student-ingress');

const PHONE = '923004445566';
const child = () => ({ id: 'u-child', persona: 'student', personaLanguage: 'ur' });
const voice = (n) => ({ message: { id: `wamid.voice-${n}`, type: 'audio' }, messageType: 'audio' });
const route = (m) => Ingress.route({ ...m, from: PHONE, user: child() });
const texts = () => mockSent.filter((s) => s.fn === 'sendMessage').map((s) => s.text);
const reactions = () => mockSent.filter((s) => s.fn === 'sendReaction');

beforeEach(() => { mockKv.clear(); mockSent.length = 0; mockReactionOk = true; });

test('the first voice note of the day gets the line; the next two get a ✍️ on the child\'s own voice note, no text', async () => {
  expect(await route(voice(1))).toBe(true);
  expect(await route(voice(2))).toBe(true);
  expect(await route(voice(3))).toBe(true);

  expect(texts()).toEqual([resolveUx('studentVoiceNotSupported', { language: 'ur' })]);
  expect(reactions().map((r) => [r.id, r.emoji])).toEqual([['wamid.voice-2', '✍️'], ['wamid.voice-3', '✍️']]);
});

test('each LINE is once a day, not each handset: a picture after a voice note still gets its own line once', async () => {
  await route(voice(1));
  await route({ message: { id: 'wamid.img-1', type: 'image' }, messageType: 'image' });
  await route({ message: { id: 'wamid.img-2', type: 'image' }, messageType: 'image' });

  expect(texts()).toEqual([
    resolveUx('studentVoiceNotSupported', { language: 'ur' }),
    resolveUx('studentMediaNotSupported', { language: 'ur' }),
  ]);
  expect(reactions().map((r) => r.id)).toEqual(['wamid.img-2']);
});

test('a teacher button tapped twice: the line once, then a 🙏', async () => {
  const tap = (n) => ({
    message: { id: `wamid.btn-${n}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'menu_lesson_plan' } } },
    messageType: 'interactive',
  });
  await route(tap(1));
  await route(tap(2));
  expect(texts()).toEqual([resolveUx('studentTeacherOnly', { language: 'ur' })]);
  expect(reactions().map((r) => [r.id, r.emoji])).toEqual([['wamid.btn-2', '🙏']]);
});

test('a sticker is not a request: no reply at all', async () => {
  expect(await route({ message: { id: 'wamid.stk', type: 'sticker' }, messageType: 'sticker' })).toBe(true);
  expect(mockSent).toEqual([]);
});

test('the reaction could not be sent: the line is said — a refusal is never met with silence', async () => {
  await route(voice(1));
  mockReactionOk = false;
  await route(voice(2));
  expect(texts()).toHaveLength(2);
});

test('no message id to react to: the line is said every time, as before', async () => {
  await route({ message: { type: 'audio' }, messageType: 'audio' });
  await route({ message: { type: 'audio' }, messageType: 'audio' });
  expect(texts()).toHaveLength(2);
  expect(reactions()).toEqual([]);
});
