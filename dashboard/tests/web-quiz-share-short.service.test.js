/**
 * Short share links at the public edge (web_quiz_share_short): /s/<8 hex> asks the bot for its card and answers with the
 * very page /k/<token> answers (a class quiz's card: a redirect to its class link with the card); an unknown, expired or
 * malformed id, or the bot away, opens the join door (one green button), never a 404. The id's answer is kept at the
 * edge, so a link preview's HEAD + GET ask the bot once. The bot is the network boundary.
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

const botCalls = (re) => calls.filter((c) => re.test(c.url)).length;
const ID = '0a1b2c3d';
const RET = { text: 'Play with Jugnu any day. Tap, then send:', cta: 'Play with Jugnu', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' };
const short = (fn) => { const prev = answer; answer = (url) => (/\/api\/internal\/wq\/card\/s\/[^/]+$/.test(url) ? fn(url) : prev(url)); };

describe('/s/<id>', () => {
  test('a card\'s short id: the same page as its long link, from one ask of the bot per id', async () => {
    short(() => jsonRes(200, { token: TOK, url: `/k/${TOK}` }));
    const s = await req(srv, `/s/${ID}`);
    const k = await req(srv, `/k/${TOK}`);
    expect(s.status).toBe(200);
    expect(s.body.toString()).toBe(k.body.toString());
    expect(String(s.headers['cache-control'])).toMatch(/no-store|no-cache|private/);
    await req(srv, `/s/${ID}`, { ua: WA, method: 'HEAD' });
    await req(srv, `/s/${ID}`, { ua: WA });
    expect(botCalls(/\/card\/s\//)).toBe(1);
  });
  test('a class quiz\'s card: a redirect to its class link with the card', async () => {
    short(() => jsonRes(200, { token: TOK, url: `/q/AB12CD?k=${TOK}` }));
    const r = await req(srv, `/s/${ID}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`/q/AB12CD?k=${TOK}`);
  });
  test('an Urdu class quiz\'s card: the redirect carries the card\'s language, so the friend\'s door is Urdu', async () => {
    short(() => jsonRes(200, { token: TOK, url: `/q/AB12CD?k=${TOK}`, lang: 'ur' }));
    const r = await req(srv, `/s/${ID}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`/q/AB12CD?k=${TOK}&lang=ur`);
  });
  test('any other language word from the bot: the redirect is today\'s', async () => {
    for (const [id, lang] of [['1a2b3c01', 'en'], ['1a2b3c02', 'fr'], ['1a2b3c03', 5], ['1a2b3c04', '']]) {
      short(() => jsonRes(200, { token: TOK, url: `/q/AB12CD?k=${TOK}`, lang }));
      const r = await req(srv, `/s/${id}`);
      expect(r.headers.location).toBe(`/q/AB12CD?k=${TOK}`);
    }
  });
  test('an unknown or expired id: the join door with the bot\'s words, one green button, never a 404', async () => {
    short(() => jsonRes(404, { error: 'not_found', ret: RET }));
    const r = await req(srv, `/s/${ID}`);
    expect(r.status).toBe(200);
    const html = r.body.toString();
    expect(html).toContain('data-screen="card_door"');
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toContain('href="https://wa.me/15550001111?text=quiz%20please"');
    expect(html).toContain('>Play with Jugnu</a>');
  });
  test.each([['the bot away', () => { throw new Error('down'); }], ['a bot answer of the wrong shape', () => jsonRes(200, { token: 5, url: 'https://evil.example/' })]])('%s: the door, with WhatsApp and the words typed', async (_, fn) => {
    short(fn);
    const r = await req(srv, `/s/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.toString()).toContain('data-screen="card_door"');
    expect(r.body.toString()).toContain('href="https://wa.me/?text=quiz%20please"');
    expect(r.body.toString()).not.toContain('evil');
  });
  test('a malformed id: the door, and the bot is not asked', async () => {
    const r = await req(srv, '/s/NOT-AN-ID');
    expect(r.status).toBe(200);
    expect(r.body.toString()).toContain('data-screen="card_door"');
    expect(botCalls(/\/card\/s\//)).toBe(0);
  });
});
