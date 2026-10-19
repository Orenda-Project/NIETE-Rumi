/**
 * One Urdu face per page (app_settings web_quiz_one_face, carried by the bot's answers as `one_face: true`): every
 * child page names ONE Nastaliq file, wq-nastaliq-6 (the polished face), whether the polished look is on or off, and
 * the stylesheet draws the plain look with it too, so no page ever fetches wq-nastaliq-5 as well. Switch off (absent,
 * or any value but JSON true), with the fast page on or off: today's pages, byte for byte.
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');
const { QUIZ, HUB, MENU, HUB_TOKEN, cases } = require('./fixtures/one-urdu-face-cases');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const GOLDEN = require('./fixtures/one-urdu-face-off-golden.json');
const GOLDEN_FAST = require('./fixtures/one-urdu-face-off-fast-golden.json');
const PLAIN_FACE = '/wq/fonts/wq-nastaliq-5.woff2';
const FACE = '/wq/fonts/wq-nastaliq-6.woff2';

const nastaliqUrls = (html) => [...new Set(html.match(/\/wq\/fonts\/wq-nastaliq-[0-9]+\.woff2/g) || [])];
const fontPreloads = (html) => (html.match(/<link rel="preload" href="[^"]+" as="font"[^>]*>/g) || []).map((t) => t.match(/href="([^"]+)"/)[1]);
const htmlTag = (html) => html.match(/<html [^>]*>/)[0];
const isUr = (name) => /_ur(_|$)/.test(name);

// ── the bot, faked at the network ─────────────────────────────────────────────────────────────────────────
const BOT = 'http://bot.test';
function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}
function build(answers) {
  const fetchImpl = () => Promise.resolve(answers.shift());
  const app = express();
  app.set('trust proxy', 1);
  app.use(R.createWebQuizRouter({ botUrl: BOT, apiKey: 'test-internal-key', fetchImpl }));
  return app;
}

describe.each([['fast page off', false], ['fast page on too', true]])('one Urdu face: switch on (%s), every Urdu child page names wq-nastaliq-6 and nothing else', (_n, fast) => {
  const on = cases(R, { oneFace: true, fast });

  it.each(Object.keys(on).filter(isUr))('%s: one Nastaliq URL, -6, preloaded', (name) => {
    expect(nastaliqUrls(on[name])).toEqual([FACE]);
    expect(fontPreloads(on[name])).toEqual([FACE]);
  });

  it.each(Object.keys(on).filter((k) => isUr(k) && !k.startsWith('card')))('%s: <html> carries the one-face class', (name) => {
    expect(htmlTag(on[name])).toMatch(/^<html lang="ur" dir="rtl" class="(wq-ur2 )?wq-uf">$/);
  });

  it.each(Object.keys(on).filter((k) => !isUr(k)))('%s: an English page names no Nastaliq file', (name) => {
    expect(nastaliqUrls(on[name])).toEqual([]);
  });

});

describe('one Urdu face through the router: both switches on (web_quiz_fast and web_quiz_one_face)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('the fast first page (quiz, plain look): the head sent before the bot answers names only -6', async () => {
    const ur = QUIZ('ur', { fast: true, one_face: true });
    srv = await start(build([jsonRes(200, ur), jsonRes(200, ur)]));
    await get(srv, '/q/AB12CD'); // teaches this edge the switch is on and the code's language
    const res = await get(srv, '/q/AB12CD');
    expect(res.status).toBe(200);
    expect(fontPreloads(res.chunks[0])).toEqual([FACE]);
    expect(nastaliqUrls(res.body)).toEqual([FACE]);
  });

  it('the fast first page (hub), then the library, challenge and closed shells: one face, -6', async () => {
    const hub = HUB('ur', { fast: true, one_face: true });
    srv = await start(build([jsonRes(200, hub), jsonRes(200, hub), jsonRes(200, MENU('ur', { one_face: true }))]));
    await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'ur' });
    const res = await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'ur' });
    expect(res.status).toBe(200);
    expect(fontPreloads(res.chunks[0])).toEqual([FACE]);
    expect(nastaliqUrls(res.body)).toEqual([FACE]);
    const lib = await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=ur`);
    expect(lib.status).toBe(200);
    expect(nastaliqUrls(lib.body)).toEqual([FACE]);
    const ch = await get(srv, `/c/${HUB_TOKEN}?lang=ur`);
    expect(ch.status).toBe(200);
    expect(nastaliqUrls(ch.body)).toEqual([FACE]);
    const closed = await get(srv, '/c/bad?lang=ur');
    expect(closed.status).toBe(404);
    expect(nastaliqUrls(closed.body)).toEqual([FACE]);
  });

  it('the shared card page after a hub answer with the switch: one face, -6', async () => {
    srv = await start(build([jsonRes(200, HUB('ur', { one_face: true })), jsonRes(200, { lang: 'ur', first: 'Test', deed_text: 'ٹیسٹ', ret: { text: 'ٹیسٹ', cta: 'Go', href: 'https://wa.me/0000000000?text=hi' } })]));
    await get(srv, `/h/${HUB_TOKEN}?nf=1`, { 'accept-language': 'ur' });
    const card = await get(srv, `/k/${'c'.repeat(40)}`);
    expect(card.status).toBe(200);
    expect(fontPreloads(card.body)).toEqual([FACE]);
  });

  it('a payload without the switch after one with it: the shells go back to today\'s face', async () => {
    srv = await start(build([jsonRes(200, HUB('ur', { fast: true, one_face: true })), jsonRes(200, HUB('ur', { fast: true }))]));
    await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'ur' });
    await get(srv, `/h/${HUB_TOKEN}?nf=1`, { 'accept-language': 'ur' });
    const lib = await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=ur`);
    expect(nastaliqUrls(lib.body)).toEqual(['/wq/fonts/wq-nastaliq-5.woff2']);
    expect(lib.body).not.toMatch(/wq-uf/);
  });
});

describe('one Urdu face: the stylesheet', () => {
  it('under html.wq-uf both looks draw with "WQ Nastaliq 2" (-6, font-display swap)', () => {
    const rule = /html\.wq-uf\[lang=ur\]\{--fu:"WQ Nastaliq 2",[^}]*\}/.exec(CSS);
    expect(rule).not.toBeNull();
    // the plain look's --fu (:root) gives way to the class; the polished look's own --fu names the same face
    expect(/html\.wq-ur2\[lang=ur\]\{--fu:"WQ Nastaliq 2",/.test(CSS)).toBe(true);
    expect(/@font-face\{font-family:"WQ Nastaliq 2";src:url\(fonts\/wq-nastaliq-6\.woff2\)[^}]*font-display:swap/.test(CSS)).toBe(true);
    // every Urdu font stack in the sheet goes through --fu, so the one rule above moves both looks
    const named = CSS.match(/font-family:\s*"WQ Nastaliq[^"]*"(;src:)?/g) || [];
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((d) => !d.endsWith(';src:'))).toEqual([]);
  });

  it("no new font file for the one face: the polished one already served (-7 is the light face's, web-quiz-face-lite)", () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'public', 'wq', 'fonts')).filter((f) => f.endsWith('.woff2')).sort();
    expect(files).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => `wq-nastaliq-${i}.woff2`));
  });
});

describe('one Urdu face: switch off, today\'s pages byte for byte', () => {
  const off = cases(R);
  it.each(Object.keys(GOLDEN))('fast page off: %s', (name) => {
    expect(off[name]).toBe(GOLDEN[name]);
  });
  // The fast page switch alone (already on in production) never brings the one face: its pages stay today's, -5 preloaded.
  const fast = cases(R, { fast: true });
  it.each(Object.keys(GOLDEN_FAST))('fast page on: %s', (name) => {
    expect(fast[name]).toBe(GOLDEN_FAST[name]);
  });
  it.each(Object.keys(GOLDEN_FAST).filter((k) => isUr(k) && !k.includes('_ur2')))('fast page on, plain look: %s preloads today\'s face', (name) => {
    expect(fontPreloads(fast[name])).toEqual([PLAIN_FACE]);
  });
});

// Only JSON true is on. Any other value (the bot never sends one: its switch reads them as off and leaves the key out)
// leaves every page as today's; the value itself rides the boot JSON untouched, so it is taken out before the compare.
describe.each([['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]])(
  'one Urdu face: `one_face` as %s is off', (_n, value) => {
    const drop = (html) => html.split(`,"one_face":${JSON.stringify(value)}`).join('');
    it.each([[false, GOLDEN], [true, GOLDEN_FAST]])('fast page %s: every page byte for byte today\'s', (fastOn, golden) => {
      const pages = cases(R, { oneFace: value, fast: fastOn });
      for (const name of Object.keys(golden)) expect([name, drop(pages[name])]).toEqual([name, golden[name]]);
    });
    let srv;
    afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
    it('through the router: the hub, then the library, challenge, closed and card shells keep today\'s face', async () => {
      const card = { lang: 'ur', first: 'Test', deed_text: 'ٹیسٹ', ret: { text: 'ٹیسٹ', cta: 'Go', href: 'https://wa.me/0000000000?text=hi' } };
      srv = await start(build([jsonRes(200, HUB('ur', { fast: true, one_face: value })), jsonRes(200, HUB('ur', { fast: true, one_face: value })), jsonRes(200, MENU('ur', { one_face: value })), jsonRes(200, card)]));
      await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'ur' });
      const hub = await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'ur' });
      expect(fontPreloads(hub.chunks[0])).toEqual([PLAIN_FACE]);
      for (const res of [hub, await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=ur`), await get(srv, `/c/${HUB_TOKEN}?lang=ur`), await get(srv, '/c/bad?lang=ur'), await get(srv, `/k/${'c'.repeat(40)}`)]) {
        expect(nastaliqUrls(res.body)).toEqual([PLAIN_FACE]);
        expect(res.body).not.toMatch(/wq-uf/);
      }
    });
  });
