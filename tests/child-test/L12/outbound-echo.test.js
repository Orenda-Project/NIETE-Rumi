'use strict';
/**
 * whatsapp.outbound_echo — the reply source for a simulated coach on the DEPLOYED sandbox bot.
 *
 * The sandbox bot's sends go through Meta to a synthetic phone no device reads, and its logs carry
 * only the message id ("✅ WhatsApp message sent" { messageId }). The child-test driver needs the
 * list row ids, button ids and Flow token the bot sent. So, for recipients on WA_OUTBOUND_ECHO_TO
 * only, both paced transports in whatsapp.service.js log the payload they sent. Never in production,
 * never for a phone that is not listed, never able to break a send.
 *
 * Only the network boundary (fetch, axios, R2) and the log sink are mocked; the real service runs.
 */

const SIM = '923009990301';

function load(env) {
  jest.resetModules();
  for (const k of ['WA_OUTBOUND_ECHO_TO', 'RAILWAY_ENVIRONMENT_NAME', 'ENVIRONMENT', 'WHATSAPP_API_BASE']) delete process.env[k];
  Object.assign(process.env, { PHONE_NUMBER_ID: 'ph-1', WHATSAPP_TOKEN: 'tok' }, env);
  const logger = { logToFile: jest.fn(), logError: jest.fn() };
  jest.doMock('../../../bot/shared/utils/logger', () => logger);
  jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn() }));
  const axios = require('axios');
  const wa = require('../../../bot/shared/services/whatsapp.service');
  return { wa, axios, logger };
}

const echoes = (logger) => logger.logToFile.mock.calls.filter((c) => c[0] === 'whatsapp.outbound_echo').map((c) => c[1]);

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.T1' }] }) }));
});

describe('outbound echo (fetch transport: sendMessage)', () => {
  test('a listed synthetic phone gets the sent text echoed, with to, ok and a sequence', async () => {
    const { wa, logger } = load({ WA_OUTBOUND_ECHO_TO: `${SIM}, 923009990302`, RAILWAY_ENVIRONMENT_NAME: 'sandbox' });
    await expect(wa.sendMessage(SIM, 'hello coach')).resolves.toBe(true);
    const e = echoes(logger);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ event: 'whatsapp.outbound_echo', to: SIM, phone: SIM, ok: true, payload: { type: 'text', text: { body: 'hello coach' } } });
    expect(typeof e[0].echo_id).toBe('string');
    expect(typeof e[0].echo_seq).toBe('number');
    expect(Date.parse(e[0].sent_at)).not.toBeNaN();
  });

  test('a phone not on the list is never echoed', async () => {
    const { wa, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    await wa.sendMessage('923001112223', 'a real teacher');
    expect(echoes(logger)).toHaveLength(0);
  });

  test('unset list: nothing is echoed (every deployment today)', async () => {
    const { wa, logger } = load({});
    await wa.sendMessage(SIM, 'hi');
    expect(echoes(logger)).toHaveLength(0);
  });

  test('production refuses the echo even when the phone is listed', async () => {
    const { wa, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM, RAILWAY_ENVIRONMENT_NAME: 'production' });
    await wa.sendMessage(SIM, 'hi');
    expect(echoes(logger)).toHaveLength(0);
  });

  test('a refused send is echoed with ok:false, and the send still answers false', async () => {
    const { wa, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131009, message: 'bad' } }) }));
    await expect(wa.sendMessage(SIM, 'hi')).resolves.toBe(false);
    const e = echoes(logger);
    expect(e).toHaveLength(1);
    expect(e[0].ok).toBe(false);
  });
});

describe('outbound echo (axios transport: interactive)', () => {
  test('buttons are echoed with their ids, and the message id Meta returned', async () => {
    const { wa, axios, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.B9' }] } });
    await expect(wa.sendInteractiveButtons(SIM, { body: 'Present?', buttons: [{ id: 'ctst_pres:d1:p', title: 'Present' }, { id: 'ctst_pres:d1:a', title: 'Absent' }] })).resolves.toBe(true);
    const e = echoes(logger);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ to: SIM, ok: true, message_id: 'wamid.B9' });
    expect(e[0].payload.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['ctst_pres:d1:p', 'ctst_pres:d1:a']);
  });

  test('a list keeps its row ids', async () => {
    const { wa, axios, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.L1' }] } });
    await wa.sendInteractiveMessage(SIM, { body: { text: 'Today' }, action: { button: 'Children', sections: [{ rows: [{ id: 'ctst_child:d1', title: '1 · Child' }] }] } });
    expect(echoes(logger)[0].payload.interactive.action.sections[0].rows[0].id).toBe('ctst_child:d1');
  });

  test('media uploads are not echoed, only the /messages send', async () => {
    const { wa, axios, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    jest.spyOn(axios, 'post').mockImplementation(async (url) => (String(url).endsWith('/media')
      ? { status: 200, data: { id: 'media-1' } } : { status: 200, data: { messages: [{ id: 'wamid.I1' }] } }));
    await wa.sendImageFromBuffer(SIM, Buffer.from('png'), 'card');
    const e = echoes(logger);
    expect(e).toHaveLength(1);
    expect(e[0].payload.type).toBe('image');
  });

  test('a logging failure never breaks the send', async () => {
    const { wa, axios, logger } = load({ WA_OUTBOUND_ECHO_TO: SIM });
    logger.logToFile.mockImplementation((m) => { if (m === 'whatsapp.outbound_echo') throw new Error('sink down'); });
    jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.B1' }] } });
    await expect(wa.sendInteractiveButtons(SIM, { body: 'x', buttons: [{ id: 'a', title: 'A' }] })).resolves.toBe(true);
  });
});
