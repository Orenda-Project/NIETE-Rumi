/**
 * WHATSAPP_API_BASE — the one seam between the bot and Meta's Graph API.
 *
 * Every send in whatsapp.service.js builds its URL from GRAPH_API_BASE. For the local
 * mock E2E lane that constant must be redirectable to a local fake, and for every other
 * deployment it must stay exactly `https://graph.facebook.com/<version>`.
 *
 * Red-first: fails on develop — the constant is hardcoded to graph.facebook.com.
 */
const load = (env) => {
  jest.resetModules();
  for (const k of ['WHATSAPP_API_BASE', 'GRAPH_API_VERSION']) delete process.env[k];
  Object.assign(process.env, { PHONE_NUMBER_ID: 'ph-1', WHATSAPP_TOKEN: 'tok' }, env);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  return require('../../bot/shared/services/whatsapp.service');
};

describe('whatsapp.service: Graph API base URL', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.x' }] }) };
    });
  });

  test('defaults to graph.facebook.com when WHATSAPP_API_BASE is unset (real behaviour unchanged)', async () => {
    const wa = load({});
    await wa.sendMessage('923000000001', 'hi');
    expect(calls[0]).toBe('https://graph.facebook.com/v21.0/ph-1/messages');
  });

  test('WHATSAPP_API_BASE redirects every send to the local mock, keeping the /<version>/<phone>/messages path', async () => {
    const wa = load({ WHATSAPP_API_BASE: 'http://127.0.0.1:4010' });
    await wa.sendMessage('923000000001', 'hi');
    expect(calls[0]).toBe('http://127.0.0.1:4010/v21.0/ph-1/messages');
  });

  test('a trailing slash on WHATSAPP_API_BASE does not double the separator', async () => {
    const wa = load({ WHATSAPP_API_BASE: 'http://127.0.0.1:4010/' });
    await wa.sendMessage('923000000001', 'hi');
    expect(calls[0]).toBe('http://127.0.0.1:4010/v21.0/ph-1/messages');
  });
});
