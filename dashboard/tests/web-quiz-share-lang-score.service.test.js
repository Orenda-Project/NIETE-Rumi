/**
 * The edge and page half of two share fixes (each its own switch, default OFF; off, today's bytes):
 *
 *   web_quiz_share_pic_lang      the page asks its share pictures in its own language (&l=en|ur, only when the bot's
 *                                payload says pic_lang); the edge passes it to the bot and keeps each language apart,
 *                                so an English share never gets the Urdu picture the edge kept for the same id
 *   web_quiz_share_link_lang_en  an English card's link (`/q/<code>?k=…&lang=en`) previews in English, an Urdu lesson's
 *                                too; the short link /s/<id> redirects to it
 *
 * The bot is the network boundary (fake fetch); the switch is the router's injected reader; the page runs in the harness.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { page } = require('./wq-page-harness');

const BOT = 'http://bot.test';
const WA = 'WhatsApp/2.24.20.89 A';
const CHIP = '0123456789abcdef';
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const MINE = 'l.DwjiGhssTV6PkKGyw9Tl9g.yzabcdefghij';
const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';

const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const jpegRes = (b) => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, b]), text: async () => '' });
const payload = (quiz = {}) => ({
  quiz: { id: 'q', code: 'AB12CD', topic: 'Proper Fraction', lang: 'ur', dir: 'rtl', n: 6, questions: [], ...quiz },
  cls: { label: '', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: {},
});

function req(srv, path, { ua = 'Mozilla/5.0 (Linux; Android 13) Chrome/129 Mobile' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', agent: false, headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

const servers = [];
let calls;
async function start({ en = false, quiz, short } = {}) {
  calls = [];
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({
    botUrl: BOT, apiKey: 'k', now: () => 1_000_000, linkLangOn: async () => false, linkLangEnOn: async () => en === true,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.indexOf('/art/') >= 0) return jpegRes(/[?&]l=en/.test(url) ? 1 : /[?&]l=ur/.test(url) ? 2 : 0);
      if (/\/card\/s\/[^/]+$/.test(url)) return jsonRes(200, short);
      return jsonRes(200, payload(quiz));
    },
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1]);
const htmlTag = (html) => (/<html[^>]*>/.exec(String(html)) || [])[0];

describe('an English card\'s link previews in English (web_quiz_share_link_lang_en)', () => {
  test('on: an Urdu lesson\'s preview from an English card\'s link is lang="en", with the English title and line', async () => {
    const res = await req(await start({ en: true }), `/q/AB12CD?k=${CHIP}&lang=en`, { ua: WA });
    expect(res.status).toBe(200);
    expect(htmlTag(res.body)).toMatch(/^<html lang="en" dir="ltr"/);
    const english = await req(await start({ en: false, quiz: { lang: 'en', dir: 'ltr' } }), `/q/AB12CD?k=${CHIP}`, { ua: WA });
    expect(meta(res.body, 'title')).toBe(meta(english.body, 'title'));
    expect(meta(res.body, 'description')).toBe(meta(english.body, 'description'));
    expect(meta(res.body, 'title')).not.toMatch(/[؀-ۿ]/);
    // the picture is the same one the link names either way (the card's own)
    expect(meta(res.body, 'image')).toBe(meta((await req(await start({ en: false }), `/q/AB12CD?k=${CHIP}`, { ua: WA })).body, 'image'));
  });
  test('off: the English link previews exactly as the link with no lang (today\'s Urdu preview)', async () => {
    const off = await req(await start({ en: false }), `/q/AB12CD?k=${CHIP}&lang=en`, { ua: WA });
    const today = await req(await start({ en: false }), `/q/AB12CD?k=${CHIP}`, { ua: WA });
    expect(off.body.toString()).toBe(today.body.toString());
    expect(htmlTag(off.body)).toMatch(/^<html lang="ur"/);
  });
  test('on: an English lesson and a link with no lang are untouched', async () => {
    for (const [quiz, tail] of [[{ lang: 'en', dir: 'ltr' }, '&lang=en'], [undefined, '']]) {
      const on = await req(await start({ en: true, quiz }), `/q/AB12CD?k=${CHIP}${tail}`, { ua: WA });
      const off = await req(await start({ en: false, quiz }), `/q/AB12CD?k=${CHIP}${tail}`, { ua: WA });
      expect(on.body.toString()).toBe(off.body.toString());
    }
  });
  test('the short link of an English card redirects to its class link with &lang=en', async () => {
    const r = await req(await start({ en: true, short: { token: TOK, url: `/q/AB12CD?k=${TOK}&lang=en` } }), '/s/0a1b2c3d');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`/q/AB12CD?k=${TOK}&lang=en`);
  });
});

describe('the edge keeps a share picture per language (web_quiz_share_pic_lang)', () => {
  test('?l=en and ?l=ur reach the bot as such and are kept apart; each answers its own bytes', async () => {
    const srv = await start();
    const ur = await req(srv, `/q/AB12CD/art/class.jpg?a=${MINE}&l=ur`);
    const en = await req(srv, `/q/AB12CD/art/class.jpg?a=${MINE}&l=en`);
    expect(calls.filter((u) => u.indexOf('/art/') >= 0)).toEqual([`${BOT}/api/internal/wq/art/${MINE}?l=ur`, `${BOT}/api/internal/wq/art/${MINE}?l=en`]);
    expect(Buffer.compare(ur.body, en.body)).not.toBe(0);
    const again = await req(srv, `/q/AB12CD/art/class.jpg?a=${MINE}&l=en`);
    expect(Buffer.compare(again.body, en.body)).toBe(0);
    expect(calls.filter((u) => u.indexOf('/art/') >= 0)).toHaveLength(2);
  });
  test('the square size keeps its own ask: ?f=sq&l=en', async () => {
    await req(await start(), `/q/AB12CD/art/card.jpg?a=${CARD}&f=sq&l=en`);
    expect(calls).toContain(`${BOT}/api/internal/wq/art/${CARD}?f=sq&l=en`);
  });
  test('no l (or junk): the bot is asked exactly as today', async () => {
    const srv = await start();
    await req(srv, `/q/AB12CD/art/class.jpg?a=${MINE}`);
    await req(srv, `/q/AB12CD/art/card.jpg?a=${CARD}&l=fr`);
    expect(calls.filter((u) => u.indexOf('/art/') >= 0)).toEqual([`${BOT}/api/internal/wq/art/${MINE}`, `${BOT}/api/internal/wq/art/${CARD}`]);
  });
});

describe('the page asks its pictures in its own language', () => {
  const RESULT = { card: { first: 'Asad', animal: 'owl', correct: 4, total: 6, stars: 2 }, challenge_code: 'CHAL12', score: { correct: 4, total: 6 }, art: { card: CARD, class: MINE } };
  const store = { wq_s_TEST: { st: 's1', child: { first: 'Asad', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result: RESULT } };
  const arts = (p) => p.fetches.map((f) => f.url).filter((u) => u.indexOf('/art/') >= 0);
  test('pic_lang on: an Urdu lesson on an English page asks &l=en', () => {
    const p = page({ lang: 'ur', store, bootExtra: { ui_lang: 'en', pic_lang: true } });
    expect(arts(p).length).toBeGreaterThan(0);
    for (const u of arts(p)) expect(u).toMatch(/&l=en$/);
  });
  test('pic_lang on, an Urdu page: &l=ur', () => {
    const p = page({ lang: 'ur', store, bootExtra: { pic_lang: true } });
    for (const u of arts(p)) expect(u).toMatch(/&l=ur$/);
  });
  test('off: today\'s picture addresses, no l', () => {
    const p = page({ lang: 'ur', store, bootExtra: { ui_lang: 'en' } });
    expect(arts(p).length).toBeGreaterThan(0);
    for (const u of arts(p)) expect(u).not.toMatch(/[?&]l=/);
  });
});
