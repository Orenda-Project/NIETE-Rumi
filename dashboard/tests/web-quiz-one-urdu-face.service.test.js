/**
 * One Urdu face per page (web_quiz_fast on): every child page names ONE Nastaliq file, wq-nastaliq-6 (the polished
 * face), whether the polished look is on or off, and the stylesheet draws the plain look with it too, so no page
 * ever fetches wq-nastaliq-5 as well. Switch off: today's pages, byte for byte.
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

describe('one Urdu face: switch on, every Urdu child page names wq-nastaliq-6 and nothing else', () => {
  const on = cases(R, { fast: true });

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

  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('the fast first page (quiz, plain look): the head sent before the bot answers names only -6', async () => {
    const ur = QUIZ('ur', { fast: true });
    srv = await start(build([jsonRes(200, ur), jsonRes(200, ur)]));
    await get(srv, '/q/AB12CD'); // teaches this edge the switch is on and the code's language
    const res = await get(srv, '/q/AB12CD');
    expect(res.status).toBe(200);
    expect(fontPreloads(res.chunks[0])).toEqual([FACE]);
    expect(nastaliqUrls(res.body)).toEqual([FACE]);
  });

  it('the fast first page (hub), then the library, challenge and closed shells: one face, -6', async () => {
    const hub = HUB('ur', { fast: true });
    srv = await start(build([jsonRes(200, hub), jsonRes(200, hub), jsonRes(200, MENU('ur'))]));
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

  it('a payload without the switch after one with it: the shells go back to today\'s face', async () => {
    srv = await start(build([jsonRes(200, HUB('ur', { fast: true })), jsonRes(200, HUB('ur'))]));
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

  it('no new font file: the one face is the polished one already served', () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'public', 'wq', 'fonts')).filter((f) => f.endsWith('.woff2')).sort();
    expect(files).toEqual([1, 2, 3, 4, 5, 6].map((i) => `wq-nastaliq-${i}.woff2`));
  });
});

describe('one Urdu face: switch off, today\'s pages byte for byte', () => {
  const off = cases(R);
  it.each(Object.keys(GOLDEN))('%s', (name) => {
    expect(off[name]).toBe(GOLDEN[name]);
  });
});
