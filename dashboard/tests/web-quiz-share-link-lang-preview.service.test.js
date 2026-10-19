/**
 * An Urdu child's quiz card is shared with a link that carries the card's language (`/q/<code>?k=…&lang=ur`,
 * app_settings web_quiz_share_link_lang). WhatsApp builds the message's preview from that page: with the switch on,
 * the preview speaks Urdu too (the page's <html> and its title and line), like the card picture above it and the
 * door the friend lands on. The picture is the same. Off, or an English link, the preview is today's, byte for byte.
 * The bot is the network boundary (fake fetch); the switch is the router's injected reader.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const WA = 'WhatsApp/2.24.20.89 A';
const CHIP = '0123456789abcdef';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const payload = (quiz = {}) => ({
  quiz: { id: 'q', code: 'AB12CD', topic: 'Fractions', lang: 'en', dir: 'ltr', n: 7, questions: [], ...quiz },
  cls: { label: 'Class 5', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: {},
});

function req(srv, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', headers: { host: 'portal.example', 'user-agent': WA } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}

const servers = [];
async function start({ on, quiz } = {}) {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, now: () => 1_000_000, linkLangOn: async () => on === true, fetchImpl: async () => jsonRes(200, payload(quiz)) }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(html) || [])[1]);
const htmlTag = (html) => (/<html[^>]*>/.exec(html) || [])[0];

describe("an Urdu card's link previews in Urdu (web_quiz_share_link_lang)", () => {
  test('on: the preview page of an English lesson shared from an Urdu card is lang="ur" dir="rtl", with the Urdu title and line', async () => {
    const srv = await start({ on: true });
    const res = await req(srv, `/q/AB12CD?k=${CHIP}&lang=ur`);
    expect(res.status).toBe(200);
    expect(htmlTag(res.body)).toMatch(/^<html lang="ur" dir="rtl"/);
    expect(meta(res.body, 'title')).toBe('Fractions · Class 5 کا کوئز');
    expect(meta(res.body, 'description')).toMatch(/سوال/);
  });

  test('on: the picture is the same one the English preview names', async () => {
    const ur = await req(await start({ on: true }), `/q/AB12CD?k=${CHIP}&lang=ur`);
    const en = await req(await start({ on: true }), `/q/AB12CD?k=${CHIP}`);
    expect(meta(ur.body, 'image')).toBe(meta(en.body, 'image'));
  });

  test('off: an Urdu link previews exactly as today (the link without its lang)', async () => {
    const off = await req(await start({ on: false }), `/q/AB12CD?k=${CHIP}&lang=ur`);
    const today = await req(await start({ on: false }), `/q/AB12CD?k=${CHIP}`);
    expect(off.body).toBe(today.body);
    expect(htmlTag(off.body)).toMatch(/^<html lang="en" dir="ltr"/);
  });

  test('on: an English link and a link with no lang preview exactly as with the switch off', async () => {
    for (const tail of ['', '&lang=en']) {
      const on = await req(await start({ on: true }), `/q/AB12CD?k=${CHIP}${tail}`);
      const off = await req(await start({ on: false }), `/q/AB12CD?k=${CHIP}${tail}`);
      expect(on.body).toBe(off.body);
    }
  });

  test('on: an Urdu lesson already previews in Urdu, unchanged', async () => {
    const quiz = { topic: 'کسریں', lang: 'ur', dir: 'rtl' };
    const on = await req(await start({ on: true, quiz }), `/q/AB12CD?k=${CHIP}&lang=ur`);
    const off = await req(await start({ on: false, quiz }), `/q/AB12CD?k=${CHIP}&lang=ur`);
    expect(on.body).toBe(off.body);
  });

  test('on: the class table link is not touched (only the quiz page a card opens)', async () => {
    const on = await req(await start({ on: true }), '/q/AB12CD/class?lang=ur');
    const off = await req(await start({ on: false }), '/q/AB12CD/class?lang=ur');
    expect(on.body).toBe(off.body);
  });
});
