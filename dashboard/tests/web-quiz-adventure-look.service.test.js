/**
 * The adventure look (app_settings web_quiz_adventure_look, carried by the bot's quiz, hub and challenge menu answers as
 * `adv: true`): every child page puts ONE class on <html> (`wq-adv`) and links the look's stylesheet and kit
 * (wq-adventure.css, wq-adv.js) right after wq.css, so the look is a pure override of today's token layer. The shells
 * that call no bot (library, closed) follow the last answer. Switch off (the key absent): today's pages, byte for byte
 * (the one-face golden files, captured before either switch).
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');
const { QUIZ, HUB, MENU, HUB_TOKEN, ORIGIN, ASSET_V, cases } = require('./fixtures/one-urdu-face-cases');

const GOLDEN = require('./fixtures/one-urdu-face-off-golden.json');
const GOLDEN_FAST = require('./fixtures/one-urdu-face-off-fast-golden.json');
const PUB = path.join(__dirname, '..', 'public', 'wq');

const htmlTag = (html) => html.match(/<html [^>]*>/)[0];
const advTags = (html) => html.match(/<link rel="stylesheet" href="\/wq\/wq-adventure\.css\?v=[0-9a-f]{10}">\n<script src="\/wq\/wq-adv\.js\?v=[0-9a-f]{10}" defer><\/script>/g) || [];
// an ON page with the look taken out: the class, the two tags and the boot's own copy of the field
const unlook = (html) => html
  .replace(/ class="wq-adv"/, '').replace(/ wq-adv"/, '"')
  .replace(/\n<link rel="stylesheet" href="\/wq\/wq-adventure\.css\?v=[0-9a-f]{10}">\n<script src="\/wq\/wq-adv\.js\?v=[0-9a-f]{10}" defer><\/script>/, '')
  .replace(/,"ui":\{"adv":true\}/g, '').replace(/,"adv":true/g, '');

// the pages with `adv: true` on every bot answer, and `ui.adv` on the shells (what the router keeps from the last one)
function advCases({ fast = false, oneFace } = {}) {
  const more = { ...(fast ? { fast: true } : {}), ...(oneFace ? { one_face: true } : {}), adv: true };
  const shell = (ui) => ({ ...(ui || {}), ...(oneFace ? { uf: true } : {}), adv: true });
  const out = {};
  for (const lang of ['en', 'ur']) {
    for (const [look, ui] of [['plain', null], ['ur2', { ur2: true }]]) {
      const x = ui ? { ...more, ui } : more;
      out[`quiz_${lang}_${look}`] = R.renderQuizPage({ payload: QUIZ(lang, x), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ASSET_V });
      out[`hub_${lang}_${look}`] = R.renderHubPage({ payload: HUB(lang, x), token: HUB_TOKEN, origin: ORIGIN, assetV: ASSET_V });
      out[`lib_${lang}_${look}`] = R.renderLibPage({ hub: HUB_TOKEN, kid: 'k1', lang, origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui: shell(ui) });
      out[`challenge_${lang}_${look}`] = R.renderChallengePage({ menu: MENU(lang, { ...x, ui: shell(ui) }), token: HUB_TOKEN, kid: null, origin: ORIGIN, assetV: ASSET_V, chV: 'ch1', brandKey: 'niete' });
      out[`closed_${lang}_${look}`] = R.renderClosedPage({ lang, kind: 'closed', origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui: shell(ui) });
    }
  }
  return out;
}

describe('the adventure look off: every child page is today\'s, byte for byte', () => {
  it.each([['fast page off', false, GOLDEN], ['fast page on', true, GOLDEN_FAST]])('%s', (_n, fast, golden) => {
    const off = cases(R, { fast });
    for (const k of Object.keys(golden)) expect(off[k]).toBe(golden[k]);
    for (const k of Object.keys(off)) expect(off[k]).not.toMatch(/wq-adv/);
  });
});

describe.each([['fast page off', false], ['fast page on', true]])('the adventure look on (%s)', (_n, fast) => {
  const on = advCases({ fast });
  const off = cases(R, { fast });

  it.each(Object.keys(on))('%s: <html> carries wq-adv, the look is linked once right after wq.css, and nothing else changes', (name) => {
    expect(htmlTag(on[name])).toMatch(/ class="(wq-ur2 )?wq-adv"/);
    expect(advTags(on[name])).toHaveLength(1);
    expect(on[name]).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=[^"]+">\n<link rel="stylesheet" href="\/wq\/wq-adventure\.css/);
    expect(unlook(on[name])).toBe(off[name]);
  });

  it('with the one Urdu face too: both classes, one face', () => {
    const both = advCases({ fast, oneFace: true });
    expect(htmlTag(both.hub_ur_ur2)).toBe('<html lang="ur" dir="rtl" class="wq-ur2 wq-uf wq-adv">');
    expect(htmlTag(both.hub_ur_plain)).toBe('<html lang="ur" dir="rtl" class="wq-uf wq-adv">');
    expect(htmlTag(both.hub_en_plain)).toBe('<html lang="en" dir="ltr" class="wq-uf wq-adv">');
    expect(htmlTag(advCases({ fast }).hub_en_plain)).toBe('<html lang="en" dir="ltr" class="wq-adv">');
  });

  it.each([['the string true', 'true'], ['1', 1], ['false', false], ['an object', { on: true }]])('adv = %s is off (JSON true only)', (_x, value) => {
    const page = R.renderHubPage({ payload: HUB('en', { ...(fast ? { fast: true } : {}), adv: value }), token: HUB_TOKEN, origin: ORIGIN, assetV: ASSET_V });
    expect(htmlTag(page)).not.toMatch(/wq-adv/);
    expect(advTags(page)).toHaveLength(0);
  });
});

describe('the look\'s files', () => {
  it('both are served from /wq and stay inside their byte caps (the look\'s CSS ≤ 8 KB gzip; the kit, with its stamps and trail, ≤ 8 KB gzip)', () => {
    const zlib = require('zlib');
    expect(zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adventure.css'))).length).toBeLessThanOrEqual(8 * 1024);
    expect(zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adv.js'))).length).toBeLessThanOrEqual(8 * 1024);
  });

  it('every rule in the stylesheet is scoped under html.wq-adv (or an @media/@keyframes holding only such rules)', () => {
    const css = fs.readFileSync(path.join(PUB, 'wq-adventure.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [];
    // top-level and @media-nested selectors; @keyframes bodies are skipped
    const body = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '').replace(/\}\s*\}/g, '}');
    body.replace(/([^{}]+)\{[^{}]*\}/g, (_m, sel) => { sel.split(',').forEach((s) => selectors.push(s.trim())); return ''; });
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((s) => s && !/^html\.wq-adv\b/.test(s))).toEqual([]);
  });
});

// ── through the router ────────────────────────────────────────────────────────────────────────────────
const BOT = 'http://bot.test';
function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
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

describe('the adventure look through the router', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('hub, then the library, challenge and closed shells: the look on each', async () => {
    srv = await start(build([jsonRes(200, HUB('ur', { adv: true })), jsonRes(200, MENU('ur', { adv: true }))]));
    const hub = await get(srv, `/h/${HUB_TOKEN}?nf=1`, { 'accept-language': 'ur' });
    expect(hub.status).toBe(200);
    expect(advTags(hub.body)).toHaveLength(1);
    const lib = await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=ur`);
    expect(advTags(lib.body)).toHaveLength(1);
    expect(htmlTag(lib.body)).toMatch(/wq-adv/);
    const ch = await get(srv, `/c/${HUB_TOKEN}?lang=ur`);
    expect(advTags(ch.body)).toHaveLength(1);
    const closed = await get(srv, '/c/bad?lang=ur');
    expect(closed.status).toBe(404);
    expect(htmlTag(closed.body)).toMatch(/wq-adv/);
  });

  it('the fast hub: a head sent before the answer without the look gets it from one inline line (class, sheet, kit)', async () => {
    srv = await start(build([jsonRes(200, HUB('en', { fast: true })), jsonRes(200, HUB('en', { fast: true, adv: true }))]));
    await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'en' }); // teaches this edge the fast page is on (the look off)
    const res = await get(srv, `/h/${HUB_TOKEN}`, { 'accept-language': 'en' });
    expect(res.status).toBe(200);
    expect(res.chunks[0]).not.toMatch(/wq-adv/);
    expect(res.body).toMatch(/h\.classList\.add\("wq-adv"\)/);
    expect(res.body).toMatch(/wq-adventure\.css\?v=[0-9a-f]{10}/);
  });

  it('a payload without the switch after one with it: the shells go back to today\'s look', async () => {
    srv = await start(build([jsonRes(200, HUB('en', { adv: true })), jsonRes(200, HUB('en', {}))]));
    await get(srv, `/h/${HUB_TOKEN}?nf=1`);
    await get(srv, `/h/${HUB_TOKEN}?nf=1`);
    const lib = await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=en`);
    expect(lib.body).not.toMatch(/wq-adv/);
  });

  it('the hub answer (unlock, pick) carries the look\'s version only when it says adv: true, so a first open can take the look', async () => {
    srv = await start(build([jsonRes(200, HUB('en', { adv: true })), jsonRes(200, HUB('en', { adv: true, one_button: true })), jsonRes(200, HUB('en', {}))]));
    const page = await get(srv, `/h/${HUB_TOKEN}?nf=1`);
    const v = page.body.match(/wq-adventure\.css\?v=([0-9a-f]{10})/)[1];
    const on = JSON.parse((await get(srv, `/api/wq/hub/${HUB_TOKEN}`)).body);
    expect(on.adv_v).toBe(v);
    const off = JSON.parse((await get(srv, `/api/wq/hub/${HUB_TOKEN}`)).body);
    expect(off).toEqual(JSON.parse(JSON.stringify(HUB('en', {}))));
  });

  it('the shared card page never carries the look (its own server-drawn picture)', async () => {
    srv = await start(build([jsonRes(200, HUB('en', { adv: true })), jsonRes(200, { lang: 'en', first: 'Test', deed_text: 'Test', ret: { text: 'Test', cta: 'Go', href: 'https://wa.me/0000000000?text=hi' } })]));
    await get(srv, `/h/${HUB_TOKEN}?nf=1`);
    const card = await get(srv, `/k/${'c'.repeat(40)}`);
    expect(card.status).toBe(200);
    expect(card.body).not.toMatch(/wq-adv/);
  });
});
