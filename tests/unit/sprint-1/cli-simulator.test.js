/**
 * Sprint 1 TDD: CLI Simulator Tests (bd-235)
 *
 * RED phase: Tests define the API contract for the CLI simulator
 * that allows local testing without WhatsApp.
 *
 * The simulator must:
 * - Accept text input and return bot responses
 * - Simulate the WhatsApp webhook payload structure
 * - Support /quit to exit
 */

const path = require('path');

const simulatorPath = path.resolve(
  __dirname,
  '../../../bot/scripts/simulate.js'
);

describe('CLI Simulator', () => {
  let simulator;

  beforeEach(() => {
    jest.resetModules();
    simulator = require(simulatorPath);
  });

  describe('module exports', () => {
    test('exports createSimulator function', () => {
      expect(typeof simulator.createSimulator).toBe('function');
    });

    test('exports simulateMessage function', () => {
      expect(typeof simulator.simulateMessage).toBe('function');
    });
  });

  describe('simulateMessage()', () => {
    test('creates a valid WhatsApp webhook payload from text input', () => {
      const payload = simulator.simulateMessage('Hello');
      expect(payload).toHaveProperty('object', 'whatsapp_business_account');
      expect(payload.entry).toBeDefined();
      expect(payload.entry[0].changes[0].value.messages[0].text.body).toBe('Hello');
    });

    test('includes a from phone number', () => {
      const payload = simulator.simulateMessage('Test');
      const message = payload.entry[0].changes[0].value.messages[0];
      expect(message.from).toBeDefined();
      expect(typeof message.from).toBe('string');
    });

    test('includes message timestamp', () => {
      const payload = simulator.simulateMessage('Test');
      const message = payload.entry[0].changes[0].value.messages[0];
      expect(message.timestamp).toBeDefined();
    });

    test('includes contact info', () => {
      const payload = simulator.simulateMessage('Test');
      const contacts = payload.entry[0].changes[0].value.contacts;
      expect(contacts).toBeDefined();
      expect(contacts[0].profile.name).toBeDefined();
    });
  });

  describe('postToWebhook() — real routing (not a stub)', () => {
    test('exports postToWebhook', () => {
      expect(typeof simulator.postToWebhook).toBe('function');
    });

    test('POSTs the payload to the local /webhook and reports success', async () => {
      const calls = [];
      const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
      const payload = simulator.simulateMessage('Hello');
      const res = await simulator.postToWebhook(payload, { port: 3000, fetch: fakeFetch });

      expect(res).toEqual({ ok: true, status: 200 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://localhost:3000/webhook');
      expect(calls[0].opts.method).toBe('POST');
      expect(JSON.parse(calls[0].opts.body).entry[0].changes[0].value.messages[0].text.body).toBe('Hello');
    });

    test('returns a friendly error when the bot is not running', async () => {
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
      const res = await simulator.postToWebhook(simulator.simulateMessage('hi'), { fetch: fakeFetch });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/ECONNREFUSED/);
    });
  });

  describe('isQuitCommand()', () => {
    test('returns true for /quit', () => {
      expect(simulator.isQuitCommand('/quit')).toBe(true);
    });

    test('returns true for /exit', () => {
      expect(simulator.isQuitCommand('/exit')).toBe(true);
    });

    test('returns false for normal messages', () => {
      expect(simulator.isQuitCommand('Hello')).toBe(false);
    });
  });
});
