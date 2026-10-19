/**
 * The shared link's page in a few ms on any portal copy (web_quiz_card_fast, on top of web_quiz_card_ready): the bot
 * keeps the page's facts in Redis at mint under the token's hash; the portal reads Redis before storage, and fills it
 * from a storage or bot answer, so the next copy finds it too. Redis away, slow or holding junk: storage, then the bot,
 * as today. Off: Redis is never asked. The bot, storage and Redis are the boundaries.
 */
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const WA = 'WhatsApp/2.24.20.89 A';
const FACTS = { kind: 'read', lang: 'ur', first: 'امل', deed_text: 'میں نے آج پوری کہانی اونچی آواز میں پڑھی!',
  ret: { text: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:', cta: 'جگنو کے ساتھ کھیلیں', words: 'کوئز دکھائیں', href: 'https://wa.me/15550001111?text=%DA%A9%D9%88%D8%A6%D8%B2' } };
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });

function req(srv, path, ua = WA) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}

const hash = crypto.createHash('sha256').update(TOK).digest('hex').slice(0, 32);
const KEY = `wq:card:sandbox:${hash}`;
let srv; let calls; let fast; let store; let asked; let redis; let gets; let sets; let redisGet;
async function start() {
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: () => {}, fetchImpl: async (url) => { calls.push(url); return jsonRes(200, FACTS); }, storyEnv: 'sandbox', cardReadyOn: async () => true, cardFastOn: async () => fast, cardObject: async (key) => { asked.push(key); return store.get(key) || null; }, cardCache: { get: async (k) => { gets.push(k); return redisGet(k); }, set: async (k, v, ttl) => { sets.push([k, v, ttl]); redis.set(k, v); return true; } } }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
beforeEach(async () => {
  calls = []; fast = true; store = new Map(); asked = []; redis = new Map(); gets = []; sets = [];
  redisGet = async (k) => redis.get(k) || null;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await start();
});
afterEach(() => { console.log.mockRestore(); return new Promise((r) => srv.close(r)); });

test('kept in Redis at mint: the same page as the bot\'s, storage and the bot not asked, timing says redis', async () => {
  const fromBot = await (async () => { fast = false; const r = await req(srv, `/k/${TOK}`); fast = true; return r.body; })();
  srv.close(); calls = []; asked = []; gets = [];
  await start();
  redis.set(KEY, JSON.stringify(FACTS));
  const r = await req(srv, `/k/${TOK}`);
  expect(r.status).toBe(200);
  expect(r.body).toBe(fromBot);
  expect(gets).toEqual([KEY]);
  expect(asked).toHaveLength(0);
  expect(calls.filter((u) => /\/card\//.test(u))).toHaveLength(0);
  expect(r.headers['server-timing']).toMatch(/^card;desc="redis";dur=\d+$/);
});
test('not in Redis: storage answers, and the facts are put in Redis for the next copy (14 days, the token\'s hash)', async () => {
  store.set(`wq-card/sandbox/${hash}.json`, { bytes: Buffer.from(JSON.stringify(FACTS)) });
  const r = await req(srv, `/k/${TOK}`);
  expect(r.headers['server-timing']).toMatch(/desc="store"/);
  expect(sets).toEqual([[KEY, JSON.stringify(FACTS), 14 * 24 * 3600]]);
  expect(sets[0][0]).not.toContain(TOK);
});
test('not in Redis or storage: the bot answers, and Redis is filled', async () => {
  const r = await req(srv, `/k/${TOK}`);
  expect(r.status).toBe(200);
  expect(calls.filter((u) => /\/card\/[^/.]+$/.test(u))).toHaveLength(1);
  expect(sets.map((s) => s[0])).toEqual([KEY]);
});
test.each([
  ['Redis away (throws)', () => { redisGet = async () => { throw new Error('down'); }; }],
  ['Redis slow (never answers)', () => { redisGet = () => new Promise(() => {}); }],
  ['junk in Redis', () => { redisGet = async () => '{not json'; }],
])('%s: storage answers, as today', async (_, set) => {
  set();
  store.set(`wq-card/sandbox/${hash}.json`, { bytes: Buffer.from(JSON.stringify(FACTS)) });
  const t0 = Date.now();
  const r = await req(srv, `/k/${TOK}`);
  expect(r.status).toBe(200);
  expect(r.headers['server-timing']).toMatch(/desc="store"/);
  expect(Date.now() - t0).toBeLessThan(1000);
});
test('the switch off: Redis is never asked or written', async () => {
  fast = false;
  store.set(`wq-card/sandbox/${hash}.json`, { bytes: Buffer.from(JSON.stringify(FACTS)) });
  await req(srv, `/k/${TOK}`);
  expect(gets).toHaveLength(0);
  expect(sets).toHaveLength(0);
});

describe('the portal\'s shared Redis (lib/edge-redis)', () => {
  const E = require('../lib/edge-redis');
  afterEach(() => E.setClient(null));
  test('no client, or one not ready: null / false at once', async () => {
    expect(await E.get('k')).toBeNull();
    expect(await E.set('k', 'v', 5)).toBe(false);
    E.setClient({ isReady: false, get: jest.fn(), set: jest.fn() });
    expect(await E.get('k')).toBeNull();
    expect(await E.set('k', 'v', 5)).toBe(false);
  });
  test('a ready client: get, and set with its TTL; a failing client: null / false', async () => {
    const c = { isReady: true, get: jest.fn(async () => 'v'), set: jest.fn(async () => 'OK') };
    E.setClient(c);
    expect(await E.get('k')).toBe('v');
    expect(await E.set('k', 'v', 60)).toBe(true);
    expect(c.set).toHaveBeenCalledWith('k', 'v', { EX: 60 });
    E.setClient({ isReady: true, get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } });
    expect(await E.get('k')).toBeNull();
    expect(await E.set('k', 'v', 60)).toBe(false);
  });
});
