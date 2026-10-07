/**
 * The share picture's own path, after the preview's text is on screen.
 *
 * WhatsApp shows a link preview's text as soon as it has read the page's head, then fetches og:image. The head now
 * names the picture's type, its https address and an alt text, so the phone knows what it is about to fetch, and the
 * edge logs every picture it hands out (kind, kept at the edge or asked of the bot, ms, which fetcher, HEAD or GET):
 * the portal answers pictures it already holds without the bot, so until now a phone's picture fetch left no trace.
 * The bot is the network boundary (fake fetch); the log sink is passed in like the clock; nothing first-party is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const INVITE = 'i.CH12CD.yzabcdefghij';
const WA = 'WhatsApp/2.24.20.89 A';
const WA_IOS = 'WhatsApp/2.24.19.78 I';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
function jpegRes() {
  return { status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => JPEG, text: async () => '' };
}
const payload = (extra = {}) => ({
  quiz: { id: 'q', code: 'AB12CD', topic: 'Fractions', lang: 'en', dir: 'ltr', n: 7, questions: [] },
  cls: { label: 'Class 5', chips: [] }, live: {}, video: null, preview: false, brand: 'niete',
  art: { class: null, invite: null, schools: null }, ...extra,
});

function req(srv, path, { ua = PHONE, method = 'GET', proto } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', 'user-agent': ua };
    if (proto) headers['x-forwarded-proto'] = proto;
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv; let events; let answer;
beforeEach(async () => {
  events = [];
  answer = (url) => (url.indexOf('/art/') >= 0 ? jpegRes() : jsonRes(200, payload()));
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, logEvent: (e, p) => events.push([e, p]), fetchImpl: async (url) => answer(url) }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;

describe('the head names the picture it advertises', () => {
  test("a card share's preview head: type, https address and alt, next to the 1200x630 size", async () => {
    const res = await req(srv, `/q/AB12CD?a=${CARD}`, { ua: WA, proto: 'https' });
    expect(res.status).toBe(200);
    const img = meta(res.body, 'image');
    expect(img).toMatch(/^https:\/\/portal\.example\/q\/AB12CD\/art\/card\.jpg\?a=/);
    expect(meta(res.body, 'image:type')).toBe('image/jpeg');
    expect(meta(res.body, 'image:secure_url')).toBe(img);
    expect(meta(res.body, 'image:alt')).toBe(meta(res.body, 'title'));
    expect([meta(res.body, 'image:width'), meta(res.body, 'image:height')]).toEqual(['1200', '630']);
  });

  test("the child's own page carries the same tags (the full head, not only the preview's)", async () => {
    const res = await req(srv, '/q/AB12CD', { ua: PHONE, proto: 'https' });
    expect(meta(res.body, 'image:type')).toBe('image/jpeg');
    expect(meta(res.body, 'image:secure_url')).toBe(meta(res.body, 'image'));
  });

  test('a page reached over plain http names no secure_url (it would be a lie)', async () => {
    const res = await req(srv, '/q/AB12CD', { ua: PHONE });
    expect(meta(res.body, 'image:type')).toBe('image/jpeg');
    expect(meta(res.body, 'image:secure_url')).toBeUndefined();
  });
});

describe('every picture the edge hands out is logged, with no id or code', () => {
  const edge = () => events.filter(([e]) => e === 'web_quiz.art_edge').map(([, p]) => p);

  test("WhatsApp Android's first fetch is asked of the bot, its second is kept at the edge", async () => {
    await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`, { ua: WA });
    await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`, { ua: WA });
    const ev = edge();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toEqual(expect.objectContaining({ kind: 'card', from: 'bot', ua: 'wa_a', head: false, ms: expect.any(Number) }));
    expect(ev[1]).toEqual(expect.objectContaining({ kind: 'card', from: 'edge', ua: 'wa_a' }));
    expect(JSON.stringify(ev)).not.toMatch(/AB12CD|DwjiGhss|abcdefghijkl/);
  });

  test('the fetcher is named: WhatsApp iOS, a browser, a HEAD', async () => {
    await req(srv, `/q/CH12CD/art/invite.jpg?a=${INVITE}`, { ua: WA_IOS });
    await req(srv, `/q/CH12CD/art/invite.jpg?a=${INVITE}`, { ua: PHONE });
    await req(srv, `/q/CH12CD/art/invite.jpg?a=${INVITE}`, { ua: WA, method: 'HEAD' });
    expect(edge().map((p) => [p.kind, p.ua, p.head])).toEqual([['invite', 'wa_i', false], ['invite', 'browser', false], ['invite', 'wa_a', true]]);
  });

  test('a picture the bot cannot give is logged as a miss, and still answered as before', async () => {
    answer = (url) => (url.indexOf('/art/') >= 0 ? jsonRes(404, { error: 'not_found' }) : jsonRes(200, payload()));
    const res = await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`, { ua: WA });
    expect(res.status).toBe(404);
    expect(edge()[0]).toEqual(expect.objectContaining({ kind: 'card', from: 'none', status: 404 }));
  });
});
