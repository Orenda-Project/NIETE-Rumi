/**
 * bd-mo5pru — defence in depth: WhatsAppService.sendMessage never calls Meta without a recipient.
 *
 * A caller that reached sendMessage with no phone (the portal grading an exam, a web
 * request reusing a bot service) POSTed `{ to: null }` and Meta answered #100 «The
 * parameter to is required», logged only as a generic send error. Now the send returns
 * false before the network and logs `whatsapp.send.no_recipient` at warn, naming the
 * caller, so the next such caller is found from one log line.
 *
 * Exercised through the REAL WhatsAppService; only the network (`fetch`) is faked.
 */

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn(),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false,
  evalScript: jest.fn(),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
}));

const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const ok = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) });
const noRecipientLogs = () => logToFile.mock.calls.filter(([msg]) => msg === 'whatsapp.send.no_recipient');

beforeEach(() => {
  global.fetch = jest.fn(async () => ok());
  logToFile.mockClear();
});
afterAll(() => { delete global.fetch; });

describe('sendMessage with no recipient', () => {
  test.each([[null], [undefined], ['']])('to = %p → false, Meta is never called', async (to) => {
    await expect(WhatsAppService.sendMessage(to, 'Your result')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('logs whatsapp.send.no_recipient at warn, naming the caller', async () => {
    await WhatsAppService.sendMessage(null, 'Your result');
    const logs = noRecipientLogs();
    expect(logs).toHaveLength(1);
    const [, data, level] = logs[0];
    expect(level).toBe('warn');
    expect(data).toMatchObject({ event: 'whatsapp.send.no_recipient', method: 'sendMessage' });
    expect(data.callSite).toMatch(/^send-no-recipient\.test\.js:\d+/);
  });

  test('golden: a real recipient still goes to Meta once, unchanged', async () => {
    await expect(WhatsAppService.sendMessage('923000000000', 'Your result')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ to: '923000000000', text: { body: 'Your result' } });
    expect(noRecipientLogs()).toHaveLength(0);
  });
});
