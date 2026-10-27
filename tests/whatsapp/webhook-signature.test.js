'use strict';
/**
 * Meta signs every webhook POST and every Flow endpoint request with
 * X-Hub-Signature-256: "sha256=" + HMAC-SHA256(raw request body, App Secret).
 * The bot did not check it, so anyone who knew the URL could POST a message
 * "from" any phone number and the bot handled it as that teacher's.
 *
 * These drive the REAL Express app (bot/whatsapp-bot.js) over HTTP, with bodies
 * signed the way Meta signs them, and assert on what the caller receives and on
 * whether the handler ran at all. Three modes behind one switch:
 *   off      no check
 *   log      check, log the verdict, process anyway (the default)
 *   enforce  401 on /webhook, 432 on the Flow endpoint (Meta's documented code)
 */
const http = require('http');
const crypto = require('crypto');

const SECRET = 'test-app-secret-for-signature-checks';
const sign = (raw, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

// A status-free, message-free webhook: the handler runs its validators and acks.
// Written by hand with spacing and a \u escape, the way Meta's bytes arrive, so a
// check that re-serialises req.body instead of reading the raw bytes cannot pass.
const RAW = '{"object":"whatsapp_business_account", "entry":[{"id":"waba","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"pnid"},"note":"caf\\u00e9"}}]}]}';

let logs;
let currentApp;

function mockCollaborators({ appSetting } = {}) {
  jest.doMock('../../bot/shared/utils/logger', () => {
    const actual = jest.requireActual('../../bot/shared/utils/logger');
    return { ...actual, logToFile: jest.fn((msg, data, level) => logs.push({ msg, data: data || {}, level })) };
  });
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: jest.fn(() => null),
    validateWebhookMessage: jest.fn(() => null),
    isOurPhoneNumber: () => true,
    isTestWebhook: () => false,
    isTestPhoneNumber: () => false,
    isWithin24Hours: () => true,
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/flow-encryption.service', () => ({
    isConfigured: jest.fn(() => true),
    processEncryptedRequest: jest.fn().mockResolvedValue('ENCRYPTED-RESPONSE'),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    const rows = appSetting === undefined ? [] : [{ value: appSetting }];
    return { from: fromMock({ app_settings: { data: rows, error: null } }), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

async function post(path, raw, headers = {}) {
  const server = http.createServer(currentApp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: raw,
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    setTimeout(() => server.close(), 500).unref?.();
  }
}

async function get(path) {
  const server = http.createServer(currentApp);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
    return { status: res.status, text: await res.text() };
  } finally {
    setTimeout(() => server.close(), 500).unref?.();
  }
}

function load({ mode, secret = SECRET, appSetting } = {}) {
  jest.resetModules();
  logs = [];
  if (mode === undefined) delete process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE;
  else process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE = mode;
  if (secret === null) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = secret;
  mockCollaborators({ appSetting });
  currentApp = require('../../bot/whatsapp-bot').app;
  return {
    validators: require('../../bot/shared/utils/validators'),
    flows: require('../../bot/shared/services/flow-encryption.service'),
  };
}

const handlerRan = (validators) => validators.validateWebhookStatus.mock.calls.length > 0;
const events = (name) => logs.filter((l) => l.msg === name);

afterEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe('POST /webhook — enforce', () => {
  test('a body signed with the App Secret is processed, and the handler sees the parsed JSON', async () => {
    const { validators } = load({ mode: 'enforce' });
    const res = await post('/webhook', RAW, { 'x-hub-signature-256': sign(RAW) });
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    // req.body is still the parsed object — handlers read it exactly as before.
    expect(validators.validateWebhookStatus.mock.calls[0][0].body).toEqual(JSON.parse(RAW));
  });

  test('an unsigned body is refused with 401 and never reaches the handler', async () => {
    const { validators } = load({ mode: 'enforce' });
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
    expect(events('webhook.signature_missing')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: 'webhook', mode: 'enforce' }) }),
    ]);
  });

  test('a tampered body (signature of the original) is refused with 401', async () => {
    const { validators } = load({ mode: 'enforce' });
    const tampered = RAW.replace('pnid', 'pnix');
    const res = await post('/webhook', tampered, { 'x-hub-signature-256': sign(RAW) });
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
    expect(events('webhook.signature_invalid')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: 'webhook', reason: 'mismatch', mode: 'enforce' }) }),
    ]);
  });

  test('a body signed with some other secret is refused with 401', async () => {
    const { validators } = load({ mode: 'enforce' });
    const res = await post('/webhook', RAW, { 'x-hub-signature-256': sign(RAW, 'not-the-app-secret') });
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
  });

  test('a malformed signature header is refused with 401, reason malformed', async () => {
    const { validators } = load({ mode: 'enforce' });
    const res = await post('/webhook', RAW, { 'x-hub-signature-256': 'sha256=not-hex' });
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
    expect(events('webhook.signature_invalid')[0].data.reason).toBe('malformed');
  });

  test('with no App Secret configured, enforce refuses rather than waving everything through', async () => {
    const { validators } = load({ mode: 'enforce', secret: null });
    const res = await post('/webhook', RAW, { 'x-hub-signature-256': sign(RAW) });
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
    expect(events('webhook.signature_invalid')[0].data.reason).toBe('secret_missing');
  });

  test('GET /webhook (Meta\'s subscribe handshake, unsigned by design) is untouched', async () => {
    process.env.WEBHOOK_VERIFY_TOKEN = 'vt';
    load({ mode: 'enforce' });
    const res = await get('/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42');
    delete process.env.WEBHOOK_VERIFY_TOKEN;
    expect(res.status).toBe(200);
    expect(res.text).toBe('42');
  });
});

describe('POST /webhook — log (the default)', () => {
  test('an unsigned body is processed and logged as missing', async () => {
    const { validators } = load({ mode: 'log' });
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(events('webhook.signature_missing')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: 'webhook', mode: 'log' }) }),
    ]);
  });

  test('a tampered body is processed and logged as invalid (mismatch)', async () => {
    const { validators } = load({ mode: 'log' });
    const res = await post('/webhook', RAW.replace('pnid', 'pnix'), { 'x-hub-signature-256': sign(RAW) });
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(events('webhook.signature_invalid')[0].data).toEqual(expect.objectContaining({ route: 'webhook', reason: 'mismatch' }));
  });

  test('a correctly signed body is processed and counted as valid', async () => {
    const { validators } = load({ mode: 'log' });
    const res = await post('/webhook', RAW, { 'x-hub-signature-256': sign(RAW) });
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(events('webhook.signature_valid')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: 'webhook' }) }),
    ]);
    expect(events('webhook.signature_invalid')).toEqual([]);
    expect(events('webhook.signature_missing')).toEqual([]);
  });

  test('no mode set at all behaves as log', async () => {
    const { validators } = load({ mode: undefined });
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(events('webhook.signature_missing')).toHaveLength(1);
  });

  test('an unknown mode value behaves as log, never as off', async () => {
    const { validators } = load({ mode: 'enforced-typo' });
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(events('webhook.signature_missing')).toHaveLength(1);
  });

  test('with no App Secret, log processes everything and says secret_missing once, not per request', async () => {
    const { validators } = load({ mode: 'log', secret: null });
    await post('/webhook', RAW);
    await post('/webhook', RAW);
    expect(validators.validateWebhookStatus).toHaveBeenCalledTimes(2);
    expect(events('webhook.signature_secret_missing')).toHaveLength(1);
    expect(events('webhook.signature_missing')).toEqual([]);
    expect(events('webhook.signature_invalid')).toEqual([]);
  });
});

describe('POST /webhook — off', () => {
  test('an unsigned body is processed with no signature logging', async () => {
    const { validators } = load({ mode: 'off' });
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
    expect(logs.filter((l) => String(l.msg).startsWith('webhook.signature_'))).toEqual([]);
  });
});

describe('the app_settings switch overrides the env without a deploy', () => {
  test('env says log, app_settings says enforce → an unsigned body is refused', async () => {
    const { validators } = load({ mode: 'log', appSetting: 'enforce' });
    await require('../../bot/shared/services/webhook-signature').primeSignatureMode();
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
  });

  test('env says enforce, app_settings says log → an unsigned body is processed (the fast rollback)', async () => {
    const { validators } = load({ mode: 'enforce', appSetting: 'log' });
    await require('../../bot/shared/services/webhook-signature').primeSignatureMode();
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(200);
    expect(handlerRan(validators)).toBe(true);
  });

  test('a junk app_settings value is ignored and the env decides', async () => {
    const { validators } = load({ mode: 'enforce', appSetting: 'nonsense' });
    await require('../../bot/shared/services/webhook-signature').primeSignatureMode();
    const res = await post('/webhook', RAW);
    expect(res.status).toBe(401);
    expect(handlerRan(validators)).toBe(false);
  });
});

describe('POST /api/flows/* — the Flow endpoint is signed by Meta too', () => {
  const FLOW_RAW = '{"encrypted_flow_data":"abc","encrypted_aes_key":"def","initial_vector":"ghi"}';

  test('enforce: unsigned → 432 (Meta\'s code for a failed signature), never decrypted', async () => {
    const { flows } = load({ mode: 'enforce' });
    const res = await post('/api/flows/registration', FLOW_RAW);
    expect(res.status).toBe(432);
    expect(flows.processEncryptedRequest).not.toHaveBeenCalled();
    expect(events('webhook.signature_missing')[0].data).toEqual(expect.objectContaining({ route: 'flows' }));
  });

  test('enforce: signed → decrypted and answered as before', async () => {
    const { flows } = load({ mode: 'enforce' });
    const res = await post('/api/flows/registration', FLOW_RAW, { 'x-hub-signature-256': sign(FLOW_RAW) });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ENCRYPTED-RESPONSE');
    expect(flows.processEncryptedRequest).toHaveBeenCalledWith(JSON.parse(FLOW_RAW), expect.any(Function));
  });

  test('log: unsigned → processed as before, logged as missing on route flows', async () => {
    const { flows } = load({ mode: 'log' });
    const res = await post('/api/flows/registration', FLOW_RAW);
    expect(res.status).toBe(200);
    expect(flows.processEncryptedRequest).toHaveBeenCalled();
    expect(events('webhook.signature_missing')[0].data).toEqual(expect.objectContaining({ route: 'flows', mode: 'log' }));
  });
});

describe('boot', () => {
  test('the server logs the signature config before it binds, and secret_missing once when there is no secret', () => {
    load({ mode: 'log', secret: null });
    const bot = require('../../bot/whatsapp-bot');
    const order = [];
    jest.spyOn(bot.app, 'listen').mockImplementation(() => { order.push('listen'); return { close() {} }; });
    bot.startServer();
    expect(events('webhook.signature_config')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ mode: 'log', secret: 'missing' }) }),
    ]);
    expect(events('webhook.signature_secret_missing')).toHaveLength(1);
    expect(order).toEqual(['listen']);
  });

  test('with a secret set, the boot line says so by presence only, never the value', () => {
    load({ mode: 'enforce' });
    const bot = require('../../bot/whatsapp-bot');
    jest.spyOn(bot.app, 'listen').mockImplementation(() => ({ close() {} }));
    bot.startServer();
    const [line] = events('webhook.signature_config');
    expect(line.data).toEqual(expect.objectContaining({ mode: 'enforce', secret: 'set' }));
    expect(JSON.stringify(line.data)).not.toContain(SECRET);
    expect(events('webhook.signature_secret_missing')).toEqual([]);
  });
});
