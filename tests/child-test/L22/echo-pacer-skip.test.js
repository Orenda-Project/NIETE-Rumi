'use strict';
/**
 * bd-s1oo0.30 (L22) — a send the PACER never attempted must say so on its outbound echo.
 *
 * Sandbox run sandbox5-syn-2032: 21 of the coach's 👍 reactions were echoed as `status: 429, ok: false`.
 * Read back by the simulation, they looked like Meta refusing the bot for rate. They were not: every one
 * was a `whatsapp.paced outcome=skipped` (a best-effort reaction with no room in the coach's 6 s
 * schedule — by design), and the fetch transport writes 429 for any send it never attempted. The echo
 * now carries `local` (the pacer's outcome: 'skipped' | 'shed'), null for a send that reached Meta.
 *
 * Only the network boundaries are mocked: fetch/axios (Meta), the Redis client (the pacer's schedule),
 * R2, and the log sink. The real whatsapp.service, pacer and outbound-echo run.
 */

const SIM = '923009990301';

function load({ slotGranted }) {
  jest.resetModules();
  for (const k of ['WA_OUTBOUND_ECHO_TO', 'RAILWAY_ENVIRONMENT_NAME', 'ENVIRONMENT', 'WHATSAPP_API_BASE', 'WA_PAIR_PACING']) delete process.env[k];
  Object.assign(process.env, { PHONE_NUMBER_ID: 'ph-1', WHATSAPP_TOKEN: 'tok', WA_OUTBOUND_ECHO_TO: SIM, RAILWAY_ENVIRONMENT_NAME: 'sandbox' });
  const logger = { logToFile: jest.fn(), logError: jest.fn() };
  jest.doMock('../../../bot/shared/utils/logger', () => logger);
  jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn() }));
  // The coach's schedule: no room right now (a 4 s wait) unless the slot is granted.
  jest.doMock('../../../bot/shared/services/cache/railway-redis.service', () => ({
    isAvailable: () => true,
    evalScript: jest.fn(async () => (slotGranted ? [0, 1] : [4000, 0])),
  }));
  const axios = require('axios');
  const wa = require('../../../bot/shared/services/whatsapp.service');
  return { wa, axios, logger };
}

const echoes = (logger) => logger.logToFile.mock.calls.filter((c) => c[0] === 'whatsapp.outbound_echo').map((c) => c[1]);

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.R1' }] }) }));
});

test('a reaction the pacer skipped is echoed with local: "skipped", and never reached Meta', async () => {
  const { wa, logger } = load({ slotGranted: false });
  await expect(wa.sendReaction(SIM, 'wamid.IN1', '👍')).resolves.toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  const e = echoes(logger);
  expect(e).toHaveLength(1);
  expect(e[0]).toMatchObject({ ok: false, local: 'skipped', payload: { type: 'reaction' } });
});

test('a reaction Meta refused is echoed with local: null — Meta\'s own verdict, not the pacer\'s', async () => {
  const { wa, logger } = load({ slotGranted: true });
  global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131009, error_data: { details: 'Invalid message_id' } } }) }));
  await expect(wa.sendReaction(SIM, 'sim_1_1', '👍')).resolves.toBe(false);
  const e = echoes(logger);
  expect(e).toHaveLength(1);
  expect(e[0]).toMatchObject({ ok: false, status: 400, local: null });
});

test('a delivered message is echoed with local: null (axios transport)', async () => {
  const { wa, axios, logger } = load({ slotGranted: true });
  jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.B1' }] } });
  await expect(wa.sendInteractiveButtons(SIM, { body: 'Present?', buttons: [{ id: 'p', title: 'Present' }] })).resolves.toBe(true);
  expect(echoes(logger)[0]).toMatchObject({ ok: true, local: null, message_id: 'wamid.B1' });
});
