/**
 * The share follow-ups on a page whose language is not its lesson's (app_settings web_quiz_share_page_lang, the answer's
 * `share_page_lang`; default OFF; off, today's bytes):
 *
 *   LP-1  "Challenge a friend" shares /q/<challenge code>?lang=<page language>, and the friend's preview of it speaks that
 *         language (html lang, og:title, the wide invite picture drawn in it: &l=)
 *   EN-1  Jugnu's end-of-quiz line is the page's language, not the lesson's
 *   VS-1  a replay of a friend's challenge compares with the child's own first try ("Your first try 4/7"), never names it
 *   CF-1  the end screen's confetti falls behind the card (wq-juice wqj-back, z-index 0 under the screen), never over the headline
 *
 * The bot is the network boundary (fake fetch); the switch is the router's injected reader; the page runs in the harness.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { page, flush } = require('./wq-page-harness');

/* ---------------- LP-1: the page's challenge link ---------------- */
const kid = { chip: 'c1', first: 'Zara', animal: 'owl' };
const finished = (card = {}, extra = {}) => ({ wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [],
  result: { card: { first: 'Zara', animal: 'owl', correct: 4, total: 7, ...card }, challenge_code: 'CH12AB', ...extra } } });

function chalLink(opts) {
  const p = page(opts);
  p.wq.card();
  p.els['#wq-chal'].fire('click');
  return (/https:\/\/example\.test\/q\/CH12AB[^"<\s]*/.exec(p.html()) || [])[0];
}

describe('LP-1 the challenge link carries the page language', () => {
  test('on: an English page of an Urdu lesson shares ?lang=en; an Urdu page ?lang=ur', () => {
    expect(chalLink({ lang: 'ur', store: finished(), bootExtra: { ui_lang: 'en', share_page_lang: true } })).toBe('https://example.test/q/CH12AB?lang=en');
    expect(chalLink({ lang: 'ur', store: finished(), bootExtra: { share_page_lang: true } })).toBe('https://example.test/q/CH12AB?lang=ur');
  });
  test('off: today\'s link, no lang', () => {
    expect(chalLink({ lang: 'ur', store: finished(), bootExtra: { ui_lang: 'en' } })).toBe('https://example.test/q/CH12AB');
    expect(chalLink({ lang: 'ur', store: finished(), bootExtra: { ui_lang: 'en', share_page_lang: 'true' } })).toBe('https://example.test/q/CH12AB');
  });
});

/* ---------------- LP-1: the friend's preview of it ---------------- */
const BOT = 'http://bot.test';
const WA = 'WhatsApp/2.24.20.89 A';
const INV = 'i.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const payload = (quiz = {}) => ({
  quiz: { id: 'q', code: 'FR13ND', topic: 'Proper Fraction', lang: 'ur', dir: 'rtl', n: 7, questions: [], ...quiz },
  cls: { label: '', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: { invite: INV },
  invited: true, challenge: { first: 'Zara', correct: 4, total: 7 },
});
function req(srv, p, { ua = WA } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'GET', agent: false, headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}
const servers = [];
async function start({ on = false, quiz } = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({
    botUrl: BOT, apiKey: 'k', now: () => 1_000_000, linkLangOn: async () => false, linkLangEnOn: async () => false, pageLangOn: async () => on === true,
    fetchImpl: async () => jsonRes(200, payload(quiz)),
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));
const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1]);
const htmlTag = (html) => (/<html[^>]*>/.exec(String(html)) || [])[0];

describe('LP-1 the challenge link\'s preview speaks the link\'s language', () => {
  test('on: an Urdu lesson\'s challenge link with ?lang=en previews lang="en", the English title, the English invite picture', async () => {
    const res = await req(await start({ on: true }), '/q/FR13ND?lang=en');
    expect(res.status).toBe(200);
    expect(htmlTag(res.body)).toMatch(/^<html lang="en" dir="ltr"/);
    const english = await req(await start({ quiz: { lang: 'en', dir: 'ltr' } }), '/q/FR13ND');
    expect(meta(res.body, 'title')).toBe(meta(english.body, 'title'));
    expect(meta(res.body, 'title')).not.toMatch(/[؀-ۿ]/);
    expect(meta(res.body, 'image')).toMatch(/\/q\/FR13ND\/art\/invite\.jpg\?a=[^"]+&amp;l=en$|\/q\/FR13ND\/art\/invite\.jpg\?a=[^"]+&l=en$/);
  });
  test('on: an English lesson\'s challenge link with ?lang=ur previews in Urdu with the Urdu picture', async () => {
    const res = await req(await start({ on: true, quiz: { lang: 'en', dir: 'ltr' } }), '/q/FR13ND?lang=ur');
    expect(htmlTag(res.body)).toMatch(/^<html lang="ur" dir="rtl"/);
    expect(meta(res.body, 'image')).toMatch(/l=ur$/);
  });
  test('on, the link\'s lang is the lesson\'s own: the same preview as with no lang', async () => {
    const plain = await req(await start({ on: true }), '/q/FR13ND');
    const same = await req(await start({ on: true }), '/q/FR13ND?lang=ur');
    expect(htmlTag(same.body)).toBe(htmlTag(plain.body));
    expect(meta(same.body, 'title')).toBe(meta(plain.body, 'title'));
  });
  test('off: ?lang=en previews exactly as the link with no lang (today\'s Urdu preview)', async () => {
    const off = await req(await start({ on: false }), '/q/FR13ND?lang=en');
    const plain = await req(await start({ on: false }), '/q/FR13ND');
    expect(String(off.body).replace(/lang=en/g, '')).toBe(String(plain.body));
    expect(htmlTag(off.body)).toMatch(/^<html lang="ur"/);
  });
});

/* ---------------- EN-1: Jugnu's end line ---------------- */
const RES = { score: { correct: 3, total: 7 }, card: {} };
const endStore = { wq_s_TEST: { st: 's1', child: { first: 'Zara', chip: 'c1' }, answers: {}, queue: [], result: RES } };
async function endScreen(bootExtra, opts = {}) {
  const p = page({ lang: 'ur', store: endStore, bootExtra, api: { '/finish': RES }, voiceLang: 'ur', ...opts });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return p;
}
const bubble = (p) => /<div class="wq-say">([\s\S]*?)<\/div>/.exec(p.html())[1];

describe('EN-1 Jugnu\'s end line follows the page language', () => {
  test('on: an English page of an Urdu lesson: Jugnu speaks English', async () => {
    for (let i = 0; i < 10; i += 1) {
      const t = bubble(await endScreen({ ui_lang: 'en', share_page_lang: true }));
      expect(t).not.toMatch(/[؀-ۿ]/);
      expect(t.length).toBeGreaterThan(3);
    }
  });
  test('on: the Urdu page of the same lesson stays Urdu', async () => {
    expect(bubble(await endScreen({ share_page_lang: true }))).toMatch(/[؀-ۿ]/);
  });
  test('off: today\'s line in the lesson\'s language', async () => {
    expect(bubble(await endScreen({ ui_lang: 'en' }))).toMatch(/[؀-ۿ]/);
  });
});

/* ---------------- VS-1: a replay of a friend's challenge ---------------- */
const replay = (vs) => finished({ correct: 2, total: 7, practice: true, kept: { correct: 4, total: 7 } }, { vs });
const VS = { first: 'Testwala', correct: 4, total: 7, outcome: 'lose' };

describe('VS-1 a replay compares with the child\'s own first try', () => {
  test('on, English: "You 2/7 · Your first try 4/7", no surname', () => {
    const p = page({ lang: 'en', store: replay(VS), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toMatch(/You <bdi dir="ltr">2\/7<\/bdi> · Your first try <bdi dir="ltr">4\/7<\/bdi>/);
    expect(p.html()).not.toContain('Testwala');
    expect(p.html()).toContain('So close! Play again?');
  });
  test('on, Urdu: «آپ کی پہلی کوشش»', () => {
    const p = page({ lang: 'ur', store: replay({ ...VS, first: 'ٹیسٹ والا' }), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toContain('آپ کی پہلی کوشش');
    expect(p.html()).not.toContain('ٹیسٹ والا');
  });
  test('on, a replay that beats the first try says "New best!" once; a tie says it equals the first try', () => {
    let p = page({ lang: 'en', store: finished({ correct: 5, total: 7, practice: true, kept: { correct: 4, total: 7 } }, { vs: { ...VS, outcome: 'win' } }), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toMatch(/<div class="wq-banner wq-vs"><b>New best!<\/b><br>You <bdi dir="ltr">5\/7<\/bdi> · Your first try <bdi dir="ltr">4\/7<\/bdi>/);
    expect(p.html()).not.toContain('You beat the challenge!');
    p = page({ lang: 'en', store: finished({ correct: 4, total: 7, practice: true, kept: { correct: 4, total: 7 } }, { vs: { ...VS, outcome: 'tie' } }), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toContain('<b>Same as your first try!</b><br>You <bdi dir="ltr">4/7</bdi> · Your first try');
    p = page({ lang: 'ur', store: finished({ correct: 4, total: 7, practice: true, kept: { correct: 4, total: 7 } }, { vs: { ...VS, outcome: 'tie' } }), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toContain('<b>پہلی کوشش کے برابر!</b>');
    expect(p.html()).not.toContain('مقابلہ برابر رہا');
  });
  test('on, a first play of the challenge still names the challenger', () => {
    const p = page({ lang: 'en', store: finished({}, { vs: { first: 'Beena', correct: 3, total: 7, outcome: 'win' } }), bootExtra: { share_page_lang: true } });
    p.wq.card();
    expect(p.html()).toMatch(/You <bdi dir="ltr">4\/7<\/bdi> · Beena <bdi dir="ltr">3\/7<\/bdi>/);
  });
  test('off: today\'s strip', () => {
    const p = page({ lang: 'en', store: replay(VS) });
    p.wq.card();
    expect(p.html()).toMatch(/You <bdi dir="ltr">2\/7<\/bdi> · Testwala <bdi dir="ltr">4\/7<\/bdi>/);
  });
});

/* ---------------- CF-1: the confetti behind the card ---------------- */
describe('CF-1 the end screen\'s confetti falls behind the card', () => {
  function kit() {
    const calls = [];
    // every other call of the kit is a no-op (muted: true); finish is recorded
    const wqj = new Proxy({}, { get: (_t, k) => (k === 'finish' ? (o) => calls.push(o) : k === 'muted' ? () => true : () => null) });
    return { calls, wqj };
  }
  test('on: the page asks the kit\'s finish for the back confetti', async () => {
    const k = kit();
    await endScreen({ share_page_lang: true }, { wqj: k.wqj });
    expect(k.calls.length).toBe(1);
    expect(k.calls[0].back).toBe(true);
  });
  test('off: today\'s finish call', async () => {
    const k = kit();
    await endScreen({}, { wqj: k.wqj });
    expect(k.calls.length).toBe(1);
    expect(k.calls[0]).not.toHaveProperty('back');
  });
  test('the kit\'s back confetti sits under the screen (z-index 0, the screen is 1); the front one stays 50', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-juice.css'), 'utf8');
    expect(css).toMatch(/\.wqj-cf\.wqj-back\{z-index:0\}/);
    expect(css).toMatch(/\.wqj-cf\{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:50\}/);
  });
});
