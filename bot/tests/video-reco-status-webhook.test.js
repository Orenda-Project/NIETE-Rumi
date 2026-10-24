'use strict';
/**
 * bd-gzfdu9 (VIDREC): the clip message's delivered / read / failed reach `video_reco_events` through the REAL
 * status handler of the bot (whatsapp-bot.js handleBroadcastStatusWebhook, captured from POST /webhook as in
 * tests/quiz/report-delivery-webhook.test.js, whose golden call log also pins the flag-off path byte for byte).
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const REC = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const log = [];
let handler = null;
let flagOn = true;

function db() {
  const from = (table) => {
    const filters = [];
    const chain = {};
    chain.select = () => chain;
    chain.eq = (f, v) => { filters.push([f, v]); return chain; };
    chain.maybeSingle = async () => {
      log.push(['read', table, ...filters.flat()]);
      const hit = table === 'video_recommendations' && filters.some(([f, v]) => f === 'wamid' && v === 'wamid.CLIP');
      return { data: hit ? { id: REC } : null, error: null };
    };
    chain.single = async () => ({ data: null, error: { message: 'none' } });
    chain.insert = async (row) => { log.push(['insert', table, row]); return { error: null }; };
    chain.update = () => chain;
    chain.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return chain;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

beforeAll(async () => {
  jest.resetModules();
  jest.doMock('../shared/config/supabase', () => db());
  jest.doMock('../shared/services/cache/railway-redis.service', () => new Proxy({ isAvailable: () => true }, { get: (t, p) => (p in t ? t[p] : async () => null) }));
  jest.doMock('../shared/services/queue/sqs-queue.service', () => ({ queueJob: async () => ({ MessageId: 'm1' }) }));
  jest.doMock('../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => Promise.resolve(w), installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendTemplate: jest.fn(async () => true), markAsRead: jest.fn(async () => true) }));
  jest.doMock('../shared/services/whatsapp-status-pricing', () => ({
    pricedFields: () => ({}), logPricedStatuses: async () => {}, handleStatusWebhook: async (_sv, fn) => { handler = fn; },
  }));
  jest.doMock('../shared/services/coaching/video-reco/flags', () => ({ videoRecoEnabled: () => flagOn }));
  const { app } = require('../whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: ['1555', '0000000'].join(''), phone_number_id: '111' },
    statuses: [{ id: 'wamid.boot', status: 'sent', timestamp: '1792230000' }],
  } }] }] };
  const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  expect(res.status).toBe(200);
  await new Promise((r) => server.close(r));
  expect(typeof handler).toBe('function');
}, 60000);

beforeEach(() => { log.length = 0; flagOn = true; });

test('delivered + read of the clip message → two events; another message → nothing written', async () => {
  await handler([
    { id: 'wamid.CLIP', status: 'delivered', timestamp: '1792230213' },
    { id: 'wamid.CLIP', status: 'read', timestamp: '1792230300' },
    { id: 'wamid.OTHER', status: 'delivered', timestamp: '1792230213' },
  ]);
  const inserts = log.filter((e) => e[0] === 'insert' && e[1] === 'video_reco_events').map((e) => e[2].event);
  expect(inserts).toEqual(['delivered', 'read']);
});

test('failed → send_failed with the code', async () => {
  await handler([{ id: 'wamid.CLIP', status: 'failed', timestamp: '1792230213', errors: [{ code: 131026, title: 'x' }] }]);
  const ins = log.find((e) => e[0] === 'insert' && e[1] === 'video_reco_events');
  expect(ins[2]).toMatchObject({ event: 'send_failed', code: '131026', recommendation_id: REC });
});

test('flag off: video_recommendations is never read', async () => {
  flagOn = false;
  await handler([{ id: 'wamid.CLIP', status: 'delivered', timestamp: '1792230213' }]);
  expect(log.filter((e) => e[1] === 'video_recommendations' || e[1] === 'video_reco_events')).toEqual([]);
});
