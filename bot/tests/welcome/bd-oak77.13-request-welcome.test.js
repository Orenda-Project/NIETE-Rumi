'use strict';
/**
 * bd-oak77.13 — a first open must be answered with a welcome, not an error.
 *
 * RED BEFORE GREEN: with `enable_welcome_message:true` on the staging number
 * (verified live 2026-09-06 via GET ?fields=conversational_automation), Meta
 * posts `type:"request_welcome"` when a teacher opens a brand-new chat. Nothing
 * in this repo handled it, so it fell through whatsapp-bot.js's terminal else to
 * unsupportedTypeReply() and her FIRST EVER message from the bot was
 * «I can only reply to text and voice messages».
 */

const sent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { sent.push({ to, text }); return true; }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { maybeHandleRequestWelcome } = require('../../shared/handlers/welcome.handler');
const { DEFAULT_REPLY } = require('../../shared/utils/unsupported-message');
const { UX_STRINGS } = require('../../shared/config/ux-strings');

const cp = (s) => [...String(s)].length;
const FROM = '923330000201';

beforeEach(() => { sent.length = 0; });

describe('request_welcome — the first-open door', () => {
  test('claims the event and sends exactly one message', async () => {
    const handled = await maybeHandleRequestWelcome('request_welcome', { from: FROM });
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(FROM);
  });

  test('the message is the welcome, NOT the unsupported-type fallback', async () => {
    await maybeHandleRequestWelcome('request_welcome', { from: FROM });
    expect(sent[0].text).not.toBe(DEFAULT_REPLY);
    expect(sent[0].text).not.toMatch(/only reply to text and voice/i);
  });

  test('bilingual in one body — she has no language yet at a first open', async () => {
    await maybeHandleRequestWelcome('request_welcome', { from: FROM });
    const text = sent[0].text;
    expect(text).toMatch(/[؀-ۿ]/);          // Urdu present
    expect(text).toMatch(/NIETE Teaching Assistant/);  // English present
    expect(text).toMatch(/السلام علیکم/);
  });

  test('fits the WhatsApp body cap, measured in CODE POINTS', async () => {
    await maybeHandleRequestWelcome('request_welcome', { from: FROM });
    expect(cp(sent[0].text)).toBeLessThanOrEqual(1024);
  });

  test('Urdu second person stays gender-agnostic (mixed cohort)', () => {
    const text = UX_STRINGS.welcomeFirstOpen.en;
    expect(text).not.toMatch(/رہی ہوں گی|رہے ہوں گے|سکتا ہوں/);
  });

  test('every other message type is left alone — this handler owns one event', async () => {
    for (const t of ['text', 'audio', 'interactive', 'video', 'reaction', '', undefined]) {
      expect(await maybeHandleRequestWelcome(t, { from: FROM })).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });

  test('a send failure never throws out of the webhook path', async () => {
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    WhatsAppService.sendMessage.mockRejectedValueOnce(new Error('Graph 500'));
    await expect(maybeHandleRequestWelcome('request_welcome', { from: FROM })).resolves.toBe(true);
  });
});

describe('whatsapp-bot.js wires the door BEFORE the unsupported fallback', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');

  test('the one-line call site exists', () => {
    expect(SRC).toMatch(/maybeHandleRequestWelcome\(messageType,\s*\{\s*from\s*\}\)/);
  });

  test('it runs before the reaction/typing indicators and before the terminal else', () => {
    const call = SRC.indexOf('maybeHandleRequestWelcome');
    const reaction = SRC.indexOf('sendReaction(from, message.id, emoji)');
    const fallback = SRC.indexOf('unsupportedTypeReply(messageType');
    expect(call).toBeGreaterThan(-1);
    expect(reaction).toBeGreaterThan(call);
    expect(fallback).toBeGreaterThan(call);
  });
});
