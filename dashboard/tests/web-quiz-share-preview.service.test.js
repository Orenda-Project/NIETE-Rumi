/**
 * The link preview of a shared link is built on the SENDER's phone, in the WhatsApp composer, while the
 * child is about to tap send: WhatsApp fetches the page (often a HEAD, then a GET) and then its og:image.
 * Each full page render asks the bot for the whole quiz (2-3 s), so the preview arrived after the message
 * had gone, and the group got text + link with no picture.
 *
 * The edge now answers a link-preview fetch (WhatsApp's own user agent, other preview bots, any HEAD) from
 * what it already knows about the code, without asking the bot, and keeps each share picture's bytes, so the
 * preview is ready in well under a second. A child's own browser is never given the preview answer.
 * The bot is the network boundary (fake fetch); nothing first-party is mocked.
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
const WA = 'WhatsApp/2.24.20.89 A';
const WA_IOS = 'WhatsApp/2.24.19.78 I';
const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';
// A browser whose user agent merely MENTIONS WhatsApp is a child's browser, not the preview fetcher.
const PHONE_WA = `${PHONE} WhatsApp/2.24.20.89`;

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
  art: { class: CLASS, invite: null, schools: SCHOOLS }, ...extra,
});

function req(srv, path, { ua = PHONE, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers: { host: 'portal.example', 'user-agent': ua } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv; let calls; let answer; let clock;
async function start() {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, now: () => clock, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return answer(url); } }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
beforeEach(async () => {
  calls = [];
  clock = 1_000_000;
  answer = (url) => (url.indexOf('/art/') >= 0 ? jpegRes() : jsonRes(200, payload()));
  await start();
});
afterEach(() => new Promise((r) => srv.close(r)));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;
const quizCalls = () => calls.filter((c) => c.url.indexOf('/api/internal/wq/quiz/') >= 0).length;
// Every time the edge asks the bot about a page: a quiz render, or the light og facts.
const pageCalls = () => calls.filter((c) => /\/api\/internal\/wq\/(quiz|og)\//.test(c.url)).length;
const artCalls = () => calls.filter((c) => c.url.indexOf('/api/internal/wq/art/') >= 0).length;

describe('the preview fetch is answered without the bot once the code is known', () => {
  test("a child's card share: the page the child played on is known, so WhatsApp's fetch of the card link never waits for the quiz", async () => {
    await req(srv, '/q/AB12CD'); // the child's own page load
    expect(quizCalls()).toBe(1);
    const res = await req(srv, `/q/AB12CD?a=${CARD}`, { ua: WA });
    expect(res.status).toBe(200);
    expect(quizCalls()).toBe(1);
    expect(meta(res.body, 'image')).toBe(`http://portal.example/q/AB12CD/art/card.jpg?a=${CARD}`);
    expect(meta(res.body, 'title')).toContain('Fractions');
    expect(meta(res.body, 'description')).toBeTruthy();
    expect(meta(res.body, 'url')).toBe('http://portal.example/q/AB12CD');
    // a preview answer is a head the crawler reads, not a page: no quiz payload rides in it
    expect(String(res.body)).not.toContain('id="boot"');
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  test('a HEAD (how a phone first checks a link) warms the code; the GET after it never asks the bot again', async () => {
    const h = await req(srv, '/q/CH12CD', { method: 'HEAD', ua: WA });
    expect(h.status).toBe(200);
    expect(h.headers['content-type']).toMatch(/text\/html/);
    expect(pageCalls()).toBe(1);
    const g = await req(srv, '/q/CH12CD', { ua: WA });
    expect(g.status).toBe(200);
    expect(pageCalls()).toBe(1);
  });

  test('the class table and the school league links preview from the same knowledge (one quiz call in all)', async () => {
    await req(srv, '/q/AB12CD');
    const t = await req(srv, '/q/AB12CD/class?v=4', { ua: WA_IOS });
    const s = await req(srv, '/q/AB12CD/schools?v=2026100709', { ua: FB });
    expect(quizCalls()).toBe(1);
    expect(meta(t.body, 'image')).toBe(`http://portal.example/q/AB12CD/art/class.jpg?a=${CLASS}&v=4`);
    expect(meta(t.body, 'url')).toBe('http://portal.example/q/AB12CD/class');
    expect(meta(s.body, 'image')).toBe(`http://portal.example/q/AB12CD/art/schools.jpg?a=${SCHOOLS}&v=2026100709`);
  });

  test('a challenge code previews as the invite with the challenge title, from the knowledge the warm-up left', async () => {
    answer = (url) => (url.indexOf('/art/') >= 0 ? jpegRes() : jsonRes(200, payload({ art: { class: CLASS, invite: INVITE }, challenge: { first: 'Amal', correct: 5, total: 7 }, invited: true })));
    await req(srv, '/q/CH12CD', { method: 'HEAD' });
    const res = await req(srv, '/q/CH12CD', { ua: WA });
    expect(pageCalls()).toBe(1);
    expect(meta(res.body, 'image')).toBe(`http://portal.example/q/CH12CD/art/invite.jpg?a=${INVITE}`);
    expect(meta(res.body, 'title')).toContain('5/7');
  });

  test('an Urdu quiz previews in Urdu (the head keeps lang and dir)', async () => {
    answer = () => jsonRes(200, payload({ quiz: { id: 'q', code: 'UR12CD', topic: 'کسر', lang: 'ur', dir: 'rtl', n: 7, questions: [] } }));
    await req(srv, '/q/UR12CD');
    const res = await req(srv, '/q/UR12CD', { ua: WA });
    expect(quizCalls()).toBe(1);
    expect(String(res.body)).toMatch(/<html lang="ur" dir="rtl">/);
    expect(meta(res.body, 'title')).toContain('کسر');
  });

  test('the knowledge expires: an hour later the preview asks the bot again', async () => {
    await req(srv, '/q/AB12CD');
    clock += 61 * 60 * 1000;
    await req(srv, '/q/AB12CD', { ua: WA });
    expect(pageCalls()).toBe(2);
  });
});

describe("a child's browser is never given the preview answer", () => {
  test('a phone browser always gets the live page from the bot, boot JSON and all', async () => {
    await req(srv, '/q/AB12CD');
    const res = await req(srv, '/q/AB12CD');
    expect(quizCalls()).toBe(2);
    expect(String(res.body)).toContain('id="boot"');
  });

  test("WhatsApp's own browser (its user agent mentions WhatsApp after Mozilla) gets the live page", async () => {
    await req(srv, '/q/AB12CD');
    const res = await req(srv, '/q/AB12CD', { ua: PHONE_WA });
    expect(quizCalls()).toBe(2);
    expect(String(res.body)).toContain('id="boot"');
  });

  test('a closed code is never remembered: the next preview fetch asks again and gets the closed page', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    const a = await req(srv, '/q/ZZ12CD', { ua: WA });
    const b = await req(srv, '/q/ZZ12CD', { ua: WA });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(quizCalls()).toBe(2);
  });
});

describe('the share picture is kept at the edge once drawn', () => {
  test('the card opening fetched it once; the preview fetch is answered from the edge with the same bytes', async () => {
    const a = await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`);
    const b = await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`, { ua: WA });
    expect(artCalls()).toBe(1);
    expect(b.status).toBe(200);
    expect(b.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(a.body, b.body)).toBe(0);
    expect(b.headers['cache-control']).toBe('public, max-age=86400');
  });

  test('the square file and the 1200x630 picture are kept apart', async () => {
    await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`);
    await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}&f=sq`);
    expect(artCalls()).toBe(2);
  });

  test('a class picture moves as children play: kept two minutes, then drawn again', async () => {
    await req(srv, `/q/AB12CD/art/class.jpg?a=${CLASS}`);
    await req(srv, `/q/AB12CD/art/class.jpg?a=${CLASS}&v=3`, { ua: WA });
    expect(artCalls()).toBe(1);
    clock += 121 * 1000;
    await req(srv, `/q/AB12CD/art/class.jpg?a=${CLASS}&v=3`, { ua: WA });
    expect(artCalls()).toBe(2);
  });

  test('a picture the bot could not draw is never kept', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    expect((await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`)).status).toBe(404);
    answer = () => jpegRes();
    expect((await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}`)).status).toBe(200);
    expect(artCalls()).toBe(2);
  });
});

describe('several portal workers: what one learned, another can ask the bot for in one light call', () => {
  // The portal runs several worker processes (cluster.js); each has its own memory. A second router stands in for
  // a second worker, sharing the same fake bot.
  let srv2;
  const ogBody = () => ({ quiz: { lang: 'en', topic: 'Fractions', n: 7 }, cls: { label: 'Class 5' }, challenge: null,
    art: { class: CLASS, invite: null, schools: SCHOOLS }, brand: 'niete', invited: false });
  beforeEach(async () => {
    answer = (url) => (url.indexOf('/art/') >= 0 ? jpegRes() : url.indexOf('/api/internal/wq/og/') >= 0 ? jsonRes(200, ogBody()) : jsonRes(200, payload()));
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, now: () => clock, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return answer(url); } }));
    await new Promise((r) => { srv2 = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv2.close(r)));
  const ogCalls = () => calls.filter((c) => c.url.indexOf('/api/internal/wq/og/') >= 0).length;

  test("a preview fetch on a worker that never saw the code asks the bot's og facts, never the whole quiz", async () => {
    await req(srv, '/q/AB12CD'); // worker 1: the child's page load
    const res = await req(srv2, `/q/AB12CD?a=${CARD}`, { ua: WA }); // worker 2: WhatsApp's preview fetch
    expect(quizCalls()).toBe(1);
    expect(ogCalls()).toBe(1);
    expect(calls.find((c) => c.url.indexOf('/og/') >= 0).url).toBe(`${BOT}/api/internal/wq/og/AB12CD`);
    expect(meta(res.body, 'image')).toBe(`http://portal.example/q/AB12CD/art/card.jpg?a=${CARD}`);
    expect(meta(res.body, 'title')).toContain('Fractions');
    // and that worker now knows it too
    await req(srv2, `/q/AB12CD?a=${CARD}`, { method: 'HEAD', ua: WA });
    expect(ogCalls()).toBe(1);
  });

  test('a HEAD warm-up on a fresh worker uses the light call as well', async () => {
    const h = await req(srv2, '/q/CH12CD', { method: 'HEAD' });
    expect(h.status).toBe(200);
    expect(ogCalls()).toBe(1);
    expect(quizCalls()).toBe(0);
  });

  test('a bot that does not answer og facts (not deployed yet, or the code is closed) falls back to the full page path', async () => {
    answer = (url) => (url.indexOf('/api/internal/wq/og/') >= 0 ? jsonRes(404, {}) : jsonRes(200, payload()));
    const res = await req(srv2, '/q/AB12CD', { ua: WA });
    expect(res.status).toBe(200);
    expect(quizCalls()).toBe(1);
    expect(meta(res.body, 'image')).toBe('http://portal.example/wq/og.jpg');
  });

  test('a closed code still gets its closed page', async () => {
    answer = (url) => (url.indexOf('/api/internal/wq/og/') >= 0 ? jsonRes(410, { error: 'expired', lang: 'en' }) : jsonRes(410, { error: 'expired', lang: 'en' }));
    const res = await req(srv2, '/q/AB12CD', { ua: WA });
    expect(res.status).toBe(410);
  });
});
