/**
 * The finish card at the public edge (web_quiz_card_v3): the card's picture (/wq/card/<t>.png) kept at the edge so a
 * link preview's HEAD + GET never wait on the bot twice; the shared link /k/<t> whose head names the picture and
 * whose page has one way in (the bot's chat); a class quiz shared from the card (/q/<CODE>?k=<t>) previewing the
 * card; the Jugnu page asking for the card's script only when the menu says so. The bot is the network boundary.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderChallengePage, renderQuizPage } = require('../routes/web-quiz.routes');

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

let srv; let events; let calls; let answer;
beforeEach(async () => {
  events = []; calls = [];
  answer = (url) => {
    if (/\/api\/internal\/wq\/card\/[^/]+\.png$/.test(url)) return pngRes();
    if (/\/api\/internal\/wq\/card\/[^/]+$/.test(url)) return jsonRes(200, FACTS);
    if (/\/api\/internal\/wq\/card$/.test(url)) return jsonRes(200, { token: TOK, url: `/k/${TOK}` });
    return jsonRes(200, payload());
  };
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: (e, p) => events.push([e, p]), fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url); } }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;
const botCalls = (re) => calls.filter((c) => re.test(c.url)).length;

describe('the picture: /wq/card/<t>.png', () => {
  test('PNG bytes with a year-long immutable cache; the second GET and the HEAD are answered from the edge', async () => {
    const a = await req(srv, `/wq/card/${TOK}.png`, { ua: WA, method: 'HEAD' });
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('image/png');
    const b = await req(srv, `/wq/card/${TOK}.png`, { ua: WA });
    expect(b.body.equals(PNG)).toBe(true);
    expect(b.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const c = await req(srv, `/wq/card/${TOK}.png`, { ua: WA, method: 'HEAD' });
    expect(c.status).toBe(200);
    expect(botCalls(/\/card\/.+\.png$/)).toBe(1);
    expect(events.filter(([e]) => e === 'web_quiz.card_edge').map(([, p]) => [p.from, p.head])).toEqual([['bot', true], ['edge', false], ['edge', true]]);
  });

  test('the token never reaches a log line (the bot call is logged by its route pattern)', async () => {
    await req(srv, `/wq/card/${TOK}.png`);
    await req(srv, `/k/${TOK}`);
    expect(JSON.stringify(events)).not.toContain(TOK);
  });

  test('a malformed token is refused at the edge (no bot call); a token the bot does not know is 404', async () => {
    expect((await req(srv, '/wq/card/short.png')).status).toBe(404);
    expect((await req(srv, `/wq/card/${TOK}%3Cx%3E.png`)).status).toBe(404);
    expect(calls.length).toBe(0);
    answer = () => jsonRes(404, { error: 'not_found' });
    expect((await req(srv, `/wq/card/${TOK}.png`)).status).toBe(404);
  });

  test('the static files are still served under /wq', async () => {
    const r = await req(srv, '/wq/wq-finish-card.js');
    expect(r.status).toBe(200);
  });
});

describe('the shared link: /k/<t>', () => {
  test('its head names the card picture as a 1200x630 PNG; its page has the picture and ONE way in, the bot chat', async () => {
    const r = await req(srv, `/k/${TOK}`, { ua: WA });
    expect(r.status).toBe(200);
    const html = r.body.toString();
    expect(meta(html, 'image')).toBe(`https://portal.example/wq/card/${TOK}.png`);
    expect(meta(html, 'image:type')).toBe('image/png');
    expect([meta(html, 'image:width'), meta(html, 'image:height')]).toEqual(['1200', '630']);
    expect(meta(html, 'title')).toBe(`${FACTS.first}: ${FACTS.deed_text}`);
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toContain(`href="${FACTS.ret.href}"`);
    expect(html).not.toMatch(/<script/);
    expect(events).toContainEqual(['web_quiz.card_open', { kind: 'read', lang: 'ur', ua: 'wa_a', head: false }]);
  });

  test('a preview fetch twice asks the bot for the facts once', async () => {
    await req(srv, `/k/${TOK}`, { ua: WA, method: 'HEAD' });
    await req(srv, `/k/${TOK}`, { ua: WA });
    expect(botCalls(/\/card\/[^/.]+$/)).toBe(1);
  });

  test('a return link that is not this bot\'s wa.me chat is not drawn', async () => {
    answer = () => jsonRes(200, { ...FACTS, ret: { ...FACTS.ret, href: 'https://evil.example/x' } });
    const html = (await req(srv, `/k/${TOK}`)).body.toString();
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('data-primary');
  });

  test('an unknown card: the closed page, 404', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    expect((await req(srv, `/k/${TOK}`)).status).toBe(404);
  });
});

describe('renderCardPage on a fresh profile (a classmate\'s phone: no cookie, no device ref, nothing cached)', () => {
  test('the shared card opens whole with no state at all: the picture, the words, the one way in; no script, no cookie set', async () => {
    const r = await req(srv, `/k/${TOK}`);
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toBeUndefined();
    const html = r.body.toString();
    expect(html).toContain(`<img src="https://portal.example/wq/card/${TOK}.png"`);
    expect(html).toContain(FACTS.ret.text);
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).not.toMatch(/<script|localStorage|wq_dv/);
    // the bot was asked with no device of the phone
    const call = calls.find((c) => /\/card\/[^/.]+$/.test(c.url));
    expect(JSON.stringify(call.init.headers || {})).not.toMatch(/x-wq-device/i);
  });
});

describe('a class quiz shared from the card: /q/<CODE>?k=<t>', () => {
  test('previews the card picture (PNG); the quiz itself opens as always', async () => {
    const r = await req(srv, `/q/AB12CD?k=${TOK}`, { ua: WA });
    expect(meta(r.body, 'image')).toBe(`https://portal.example/wq/card/${TOK}.png`);
    expect(meta(r.body, 'image:type')).toBe('image/png');
    const child = await req(srv, `/q/AB12CD?k=${TOK}`);
    expect(child.body.toString()).toContain('/wq/wq.js?v=');
  });

  test('with the fast first page on, the head a phone gets still names the card picture (one head, both paths)', async () => {
    answer = (url) => jsonRes(200, { ...payload(), fast: true });
    await req(srv, '/q/AB12CD'); // the page that teaches this edge the fast page is on
    const r = await req(srv, `/q/AB12CD?k=${TOK}`);
    expect(r.body.toString()).toContain('<link rel="preload" href="/wq/wq.js?v=');
    expect(meta(r.body, 'image')).toBe(`https://portal.example/wq/card/${TOK}.png`);
    expect(meta(r.body, 'image:type')).toBe('image/png');
  });

  test('golden: no k (or a malformed one) renders the quiz page byte for byte as before', () => {
    const args = { payload: payload(), code: 'AB12CD', view: 'quiz', origin: 'https://portal.example', assetV: 'v1', url: 'https://portal.example/q/AB12CD' };
    const plain = renderQuizPage(args);
    expect(renderQuizPage({ ...args, k: undefined })).toBe(plain);
    expect(renderQuizPage({ ...args, k: 'not a token' })).toBe(plain);
    expect(plain).toContain('<meta property="og:image:type" content="image/jpeg">');
  });
});

describe('POST /api/wq/card', () => {
  test('is forwarded to the bot', async () => {
    const r = await req(srv, '/api/wq/card', { method: 'POST', body: { ct: 'x.y', kind: 'read', deed: 'read_all', lang: 'en' } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body.toString())).toEqual({ token: TOK, url: `/k/${TOK}` });
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/card`);
  });
});

describe('the Jugnu page asks for the card script only when the menu says so', () => {
  const menu = { lang: 'en', v2: true, exercises: [] };
  const render = (m) => renderChallengePage({ menu: m, token: 't', kid: null, origin: 'https://portal.example', assetV: 'v1', chV: 'c1', brandKey: 'niete' });
  test('switch off (no card_v3): no script; on: the script before the Trail', () => {
    expect(render(menu)).not.toContain('wq-finish-card.js');
    const on = render({ ...menu, card_v3: true });
    expect(on).toMatch(/<script src="\/wq\/wq-finish-card\.js\?v=[0-9a-f]{10}" defer><\/script>\n<script src="\/wq\/wq-trail\.js/);
  });
});
