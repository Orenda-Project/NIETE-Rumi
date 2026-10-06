/**
 * The share pictures at the edge: every link a child shares previews as its own
 * picture (og:image), and the picture itself is served from the bot with a
 * cache any link-preview crawler may keep. The bot is the network boundary
 * (fake fetch); nothing first-party is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const CLASS = 'l.AB12CD.mnopqrstuvwx';
const INVITE = 'i.CH12CD.yzabcdefghij';
const SCHOOLS = 's.AB12CD.klmnopqrstuv';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function jpegRes() {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  return { status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => bytes, text: async () => '' };
}
const payload = (extra = {}) => ({
  quiz: { id: 'q', code: 'AB12CD', topic: 'Fractions', lang: 'en', dir: 'ltr', n: 1, questions: [] },
  cls: { label: 'Class 3', chips: [] }, live: {}, video: null, preview: false,
  art: { class: CLASS, invite: null, schools: SCHOOLS }, ...extra,
});

function get(srv, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers: { host: 'portal.example' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let srv; let calls; let answer;
beforeEach(async () => {
  calls = [];
  answer = () => jsonRes(200, payload());
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return answer(url); } }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

const ogImage = (html) => ((/<meta property="og:image" content="([^"]+)"/.exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;

describe('og:image per shared link', () => {
  test('a card link (?a=<card id>) previews as that card', async () => {
    const res = await get(srv, `/q/AB12CD?a=${CARD}`);
    expect(res.status).toBe(200);
    expect(ogImage(res.body)).toBe(`http://portal.example/q/AB12CD/art/card.jpg?a=${CARD}`);
    // the page itself is the class quiz: the id never reaches the bot's quiz call
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/quiz/AB12CD`);
  });

  test('the class view previews as the class picture; the plain link keeps the brand picture', async () => {
    expect(ogImage((await get(srv, '/q/AB12CD/class')).body)).toBe(`http://portal.example/q/AB12CD/art/class.jpg?a=${CLASS}`);
    expect(ogImage((await get(srv, '/q/AB12CD')).body)).toBe('http://portal.example/wq/og.jpg');
  });

  test("the teacher's reminder link (/q/<CODE>?v=<played>) previews as the live class picture; with no v the brand one", async () => {
    expect(ogImage((await get(srv, '/q/AB12CD?v=18')).body)).toBe(`http://portal.example/q/AB12CD/art/class.jpg?a=${CLASS}&v=18`);
    expect(ogImage((await get(srv, '/q/AB12CD?v=x1')).body)).toBe('http://portal.example/wq/og.jpg');
    expect(ogImage((await get(srv, '/q/AB12CD')).body)).toBe('http://portal.example/wq/og.jpg');
  });

  test('the school league link previews as the school board, with its hour in the picture URL', async () => {
    expect(ogImage((await get(srv, '/q/AB12CD/schools?v=2026100622')).body)).toBe(`http://portal.example/q/AB12CD/art/schools.jpg?a=${SCHOOLS}&v=2026100622`);
  });

  test('a challenge code previews as the invite, titled with the challenge', async () => {
    answer = () => jsonRes(200, payload({ art: { class: CLASS, invite: INVITE }, challenge: { first: 'Amal', correct: 7, total: 8 } }));
    const html = String((await get(srv, '/q/CH12CD')).body);
    expect(ogImage(html)).toBe(`http://portal.example/q/CH12CD/art/invite.jpg?a=${INVITE}`);
    expect(html).toContain('<meta property="og:title" content="Can you beat Amal&#39;s 7/8? · Fractions">');
  });

  test('a malformed or foreign ?a= is ignored, never echoed', async () => {
    for (const bad of ['"><script>', 'x.AB.cd', `${CLASS}`]) {
      const html = String((await get(srv, `/q/AB12CD?a=${encodeURIComponent(bad)}`)).body);
      expect(ogImage(html)).toBe('http://portal.example/wq/og.jpg');
      expect(html).not.toContain('<script>"');
    }
  });
});

describe('GET /q/:code/art/:kind.jpg', () => {
  test('forwards to the bot and answers the JPEG with a public cache', async () => {
    answer = () => jpegRes();
    const res = await get(srv, `/q/AB12CD/art/card.jpg?a=${CARD}&f=sq`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(res.body[0]).toBe(0xff);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/art/${CARD}?f=sq`);
    expect(calls[0].opts.headers['x-api-key']).toBe(KEY);
  });

  test('class and schools pictures change as children play: a short cache', async () => {
    answer = () => jpegRes();
    expect((await get(srv, `/q/AB12CD/art/class.jpg?a=${CLASS}`)).headers['cache-control']).toBe('public, max-age=600');
  });

  test('a kind that does not match its id, or a bad id: 404 without calling the bot', async () => {
    expect((await get(srv, `/q/AB12CD/art/class.jpg?a=${CARD}`)).status).toBe(404);
    expect((await get(srv, '/q/AB12CD/art/card.jpg?a=nope')).status).toBe(404);
    expect((await get(srv, `/q/AB12CD/art/selfie.jpg?a=${CARD}`)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('the bot cannot draw it: 404, never a broken image with a long cache', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    const res = await get(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
