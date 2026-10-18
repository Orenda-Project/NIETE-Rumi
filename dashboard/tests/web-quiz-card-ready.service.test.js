/**
 * The card is ready before Send at the public edge (web_quiz_card_ready): the bot stored the card's picture and its page's
 * facts at mint under the token's hash, so a cold edge (a new deploy, another replica) answers the picture and the
 * shared link's page from storage without asking the bot; a miss, storage away or the switch off: the bot, as today.
 * Each answer says where it came from in the process log. The bot and storage are the boundaries.
 */
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WA = 'WhatsApp/2.24.20.89 A';
const FACTS = { kind: 'read', lang: 'ur', first: 'امل', deed_text: 'میں نے آج پوری کہانی اونچی آواز میں پڑھی!',
  ret: { text: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:', cta: 'جگنو کے ساتھ کھیلیں', words: 'کوئز دکھائیں', href: 'https://wa.me/15550001111?text=%DA%A9%D9%88%D8%A6%D8%B2' } };

const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const pngRes = () => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => PNG, text: async () => '' });
const payload = () => ({ quiz: { id: 'q', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', n: 7, questions: [] }, cls: { label: 'Class 5', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: { class: null, invite: null, schools: null } });

// one connection per request (agent: false): a pooled keep-alive socket can still reach the previous test's server
function req(srv, path, { ua = 'Mozilla/5.0 (Linux; Android 13) Chrome/129 Mobile', method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' };
    if (body) headers['content-type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let srv; let events; let calls; let answer; let ready; let store; let asked; let storeDown;
beforeEach(async () => {
  events = []; calls = []; ready = true; store = new Map(); asked = []; storeDown = false;
  answer = (url) => {
    if (/\/api\/internal\/wq\/card\/[^/]+\.png$/.test(url)) return pngRes();
    if (/\/api\/internal\/wq\/card\/[^/]+$/.test(url)) return jsonRes(200, FACTS);
    if (/\/api\/internal\/wq\/card$/.test(url)) return jsonRes(200, { token: TOK, url: `/k/${TOK}` });
    return jsonRes(200, payload());
  };
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: (e, p) => events.push([e, p]), fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url); }, storyEnv: 'sandbox', cardReadyOn: async () => ready, cardObject: async (key) => { asked.push(key); if (storeDown) throw new Error('down'); return store.get(key) || null; } }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

const keyOf = (ext) => `wq-card/sandbox/${crypto.createHash('sha256').update(TOK).digest('hex').slice(0, 32)}.${ext}`;
const botCalls = (re) => calls.filter((c) => re.test(c.url)).length;

describe('the picture', () => {
  test('stored at mint: answered from storage, immutable, the bot not asked; then from the edge\'s memory', async () => {
    store.set(keyOf('png'), { bytes: PNG, contentType: 'image/png' });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await req(srv, `/wq/card/${TOK}.png`, { ua: WA });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^image\/png/);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.compare(r.body, PNG)).toBe(0);
    expect(botCalls(/\/card\//)).toBe(0);
    expect(log.mock.calls.map(([l]) => JSON.parse(l)).find((x) => x.evt === 'web_quiz.card_edge')).toMatchObject({ from: 'store' });
    await req(srv, `/wq/card/${TOK}.png`, { ua: WA });
    expect(asked).toHaveLength(1);
    log.mockRestore();
  });
  test.each([['not stored yet', () => {}], ['storage away', () => { storeDown = true; }], ['the switch off', () => { ready = false; }]])('%s: the bot draws it, as today', async (_, set) => {
    set();
    const r = await req(srv, `/wq/card/${TOK}.png`, { ua: WA });
    expect(r.status).toBe(200);
    expect(botCalls(/\/card\/[^/]+\.png$/)).toBe(1);
    if (!ready) expect(asked).toHaveLength(0);
  });
});

describe('the shared link\'s page', () => {
  test('stored at mint: the same page as the bot\'s, from storage, the bot not asked', async () => {
    const fromBot = (await req(srv, `/k/${TOK}`, { ua: WA })).body.toString();
    srv.close();
    calls = []; asked = [];
    const app = express();
    app.set('trust proxy', true);
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: () => {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url); }, storyEnv: 'sandbox', cardReadyOn: async () => true, cardObject: async (key) => { asked.push(key); return key === keyOf('json') ? { bytes: Buffer.from(JSON.stringify(FACTS)), contentType: 'application/json' } : null; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
    const r = await req(srv, `/k/${TOK}`, { ua: WA });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe(fromBot);
    expect(botCalls(/\/card\//)).toBe(0);
    expect(asked).toEqual([keyOf('json')]);
  });
  test('stored facts that are not a page\'s (corrupt, wrong shape): the bot, as today', async () => {
    store.set(keyOf('json'), { bytes: Buffer.from('{not json'), contentType: 'application/json' });
    expect((await req(srv, `/k/${TOK}`)).status).toBe(200);
    expect(botCalls(/\/card\/[^/.]+$/)).toBe(1);
  });
  test('the switch off: storage is never asked', async () => {
    ready = false;
    await req(srv, `/k/${TOK}`);
    expect(asked).toHaveLength(0);
    expect(botCalls(/\/card\/[^/.]+$/)).toBe(1);
  });
});

describe('how long the edge took, on the answer itself (Server-Timing)', () => {
  test('the picture and the page say where they came from and how long it took; off: no header', async () => {
    store.set(keyOf('png'), { bytes: PNG, contentType: 'image/png' });
    store.set(keyOf('json'), { bytes: Buffer.from(JSON.stringify(FACTS)), contentType: 'application/json' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    expect((await req(srv, `/wq/card/${TOK}.png`, { ua: WA })).headers['server-timing']).toMatch(/^card;desc="store";dur=\d+$/);
    expect((await req(srv, `/wq/card/${TOK}.png`, { ua: WA })).headers['server-timing']).toMatch(/^card;desc="edge";dur=\d+$/);
    expect((await req(srv, `/k/${TOK}`, { ua: WA })).headers['server-timing']).toMatch(/^card;desc="store";dur=\d+$/);
    expect((await req(srv, `/k/${TOK}`, { ua: WA })).headers['server-timing']).toMatch(/^card;desc="edge";dur=\d+$/);
    console.log.mockRestore();
  });
  test('the switch off: no Server-Timing on the picture or the page', async () => {
    ready = false;
    expect((await req(srv, `/wq/card/${TOK}.png`, { ua: WA })).headers['server-timing']).toBeUndefined();
    expect((await req(srv, `/k/${TOK}`, { ua: WA })).headers['server-timing']).toBeUndefined();
  });
});

describe('the switch read never makes a visitor wait', () => {
  test('read once when the edge starts; a slow re-read answers from the last value', async () => {
    srv.close();
    let reads = 0; let release;
    const slow = () => { reads += 1; return reads === 1 ? Promise.resolve(true) : new Promise((r) => { release = () => r(true); }); };
    store.set(keyOf('json'), { bytes: Buffer.from(JSON.stringify(FACTS)), contentType: 'application/json' });
    const app = express();
    app.set('trust proxy', true);
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: () => {}, fetchImpl: async (url) => answer(url), storyEnv: 'sandbox', cardReadyOn: slow, cardObject: async (key) => store.get(key) || null }));
    await new Promise((r) => { srv = app.listen(0, r); });
    expect(reads).toBe(1);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await Promise.race([req(srv, `/k/${TOK}`, { ua: WA }), new Promise((res) => setTimeout(() => res('waited'), 1500))]);
    console.log.mockRestore();
    expect(r).not.toBe('waited');
    expect(r.status).toBe(200);
    expect(botCalls(/\/card\//)).toBe(0);
    if (release) release();
  });
  test('a flip after the edge starts is picked up in the background: the next visitor sees it with no wait', async () => {
    srv.close();
    let mode = 'off';
    const reader = () => (mode === 'off' ? Promise.resolve(false) : mode === 'on' ? Promise.resolve(true) : new Promise(() => {}));
    store.set(keyOf('json'), { bytes: Buffer.from(JSON.stringify(FACTS)), contentType: 'application/json' });
    const app = express();
    app.set('trust proxy', true);
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: () => {}, fetchImpl: async (url) => { calls.push({ url }); return answer(url); }, storyEnv: 'sandbox', cardReadyOn: reader, cardFlagRefreshMs: 20, cardObject: async (key) => store.get(key) || null }));
    await new Promise((r) => { srv = app.listen(0, r); });
    await new Promise((r) => setTimeout(r, 10));
    mode = 'on';
    await new Promise((r) => setTimeout(r, 80));
    mode = 'slow';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await req(srv, `/k/${TOK}`, { ua: WA });
    console.log.mockRestore();
    expect(r.headers['server-timing']).toMatch(/desc="store"/);
    expect(botCalls(/\/card\//)).toBe(0);
  });
});
