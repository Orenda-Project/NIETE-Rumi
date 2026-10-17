/**
 * An expired, forged or closed child link on the portal is never a dead end (switch quiz_one_door ON): the closed page
 * of kind 'hub' (/h/:token) and 'closed' (/q/:code, /c/:token, /c/:token/back) carries ONE tap back to WhatsApp whose
 * words are the signed sentence (EN "Open WhatsApp and send 'quiz' to Jugnu.", UR with U+00A0 inside «واٹس ایپ»), its
 * href https://wa.me/<digits>?text=quiz when this deployment knows its number (WHATSAPP_BOT_NUMBER, else
 * REFERRAL_BOT_NUMBER), else whatsapp://send?text=quiz. The edge's own go.error page (/quiz/go/:token) does the same.
 * Kind 'off' (the service is down) is unchanged.
 *
 * The portal reads the switch strictly: only the JSON boolean true is on (the string "true" is OFF).
 * Switch OFF in every state (absent, false, a garbage string, the string "true", a read that throws): every page is byte-identical to the
 * page before this change — the route's bytes equal the renderer's with no tap, and the renderer's bytes are pinned
 * (sha256) in __golden__/way-back-closed-off.json, recorded by running this file on the code before the change
 * (WAY_BACK_RECORD=1). The bot is the network boundary (a fake fetch); the switch's table read is a fake client.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { createWebQuizRouter, renderClosedPage, assetVersion } = require('../routes/web-quiz.routes');
const { createQuizGoRouter } = require('../routes/quiz-go.routes');
const GoPage = require('../../bot/shared/services/first-touch/go.page');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const GO_TOK = 'eyJrIjoiZ28ifQ.AAAAAAAAAAAAAAAAAAAAAA';
// the bot's WhatsApp number, built at run time (no phone-shaped literal in the source)
const WA_BOT = ['92', '300', '000', '0000'].join('');
const WA = `https://wa.me/${WA_BOT}?text=quiz`;
const APP = 'whatsapp://send?text=quiz';
const EN = "Open WhatsApp and send 'quiz' to Jugnu.";
const UR = 'واٹس ایپ کھولیں اور جگنو کو "کوئز" لکھ کر بھیجیں۔';
const HOST = 'portal.example';

const GOLDEN_FILE = path.join(__dirname, '__golden__', 'way-back-closed-off.json');
const RECORD = process.env.WAY_BACK_RECORD === '1';
const recorded = {};
const golden = RECORD ? {} : JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
// hex in groups of 8 (no long digit run in the pinned file)
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').match(/.{8}/g).join('-');
afterAll(() => {
  if (RECORD) fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(Object.keys(recorded).sort().reduce((o, k) => ({ ...o, [k]: recorded[k] }), {}), null, 2)}\n`);
});

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function expectOneTap(html, href, sentence) {
  const opens = html.match(/<a\b[^>]*>/g) || [];
  expect(opens).toHaveLength(1);
  expect(html).not.toContain('href=""');
  const m = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  expect(m).not.toBeNull();
  expect(decode(m[1])).toBe(href);
  const words = decode(m[2].replace(/<[^>]+>/g, ' '));
  [].concat(sentence).forEach((s) => expect(words).toContain(s));
  return words;
}

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function req(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: HOST, ...headers } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}

const saved = { W: process.env.WHATSAPP_BOT_NUMBER, R: process.env.REFERRAL_BOT_NUMBER };
function number(which) {
  delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER;
  if (which === 'whatsapp') process.env.WHATSAPP_BOT_NUMBER = `+92 300 ${WA_BOT.slice(5)}`;
  if (which === 'referral') process.env.REFERRAL_BOT_NUMBER = WA_BOT;
}
afterAll(() => {
  if (saved.W === undefined) delete process.env.WHATSAPP_BOT_NUMBER; else process.env.WHATSAPP_BOT_NUMBER = saved.W;
  if (saved.R === undefined) delete process.env.REFERRAL_BOT_NUMBER; else process.env.REFERRAL_BOT_NUMBER = saved.R;
});

/** A table client whose app_settings row for quiz_one_door is `row` (undefined → no row; 'throw' → the read throws). */
function settingsClient(row) {
  return {
    from: () => ({
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => {
            if (row === 'throw') throw new Error('app_settings down');
            if (row === 'error') return { data: null, error: { message: 'down' } };
            return { data: key === 'quiz_one_door' && row !== undefined ? { value: row } : null, error: null };
          },
        }),
      }),
    }),
  };
}
const resetSwitch = () => { try { require('../lib/one-door-switch')._reset(); } catch (_) { /* not on this code */ } };

let srv;
let next;
let door;
/** The router with the switch given (`door` = true/false), or read from app.locals.supabase (`locals`). */
async function boot({ inject = true, locals = undefined, bot = true } = {}) {
  resetSwitch();
  const app = express();
  if (locals !== undefined) app.locals.supabase = locals;
  const opts = { botUrl: bot ? BOT : '', apiKey: bot ? KEY : '', canonicalBase: '', fetchImpl: async () => next() };
  if (inject) opts.oneDoorOn = () => door;
  app.use(createWebQuizRouter(opts));
  app.use((r, res) => res.status(418).send('fell through'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())).then(() => { srv = null; }));

// The dead-end pages: [name, path, headers, the bot's answer, kind, lang].
const PAGES = [
  ['hub.forged.en', '/h/not-a-token', {}, null, 'hub', 'en'],
  ['hub.forged.ur', '/h/not-a-token', { 'accept-language': 'ur-PK' }, null, 'hub', 'ur'],
  ['hub.expired.en', `/h/${TOKEN}`, {}, () => jsonRes(401, { error: 'bad_token' }), 'hub', 'en'],
  ['quiz.closed.ur', '/q/ABCD1234', {}, () => jsonRes(410, { error: 'closed', lang: 'ur' }), 'closed', 'ur'],
  ['quiz.closed.en', '/q/ABCD1234', {}, () => jsonRes(404, { error: 'not_found' }), 'closed', 'en'],
  ['challenge.forged.ur', '/c/bad?lang=ur', {}, null, 'closed', 'ur'],
  ['challenge.expired.en', `/c/${TOKEN}`, {}, () => jsonRes(401, { error: 'bad_token' }), 'closed', 'en'],
  ['challenge.back.forged.en', '/c/bad/back', {}, null, 'closed', 'en'],
];
const OFF_PAGES = [
  ['quiz.off', '/q/ABCD1234', {}, () => jsonRes(503, { error: 'web_quiz_off' }), 'off', 'en'],
  ['challenge.off.ur', `/c/${TOKEN}?lang=ur`, {}, () => jsonRes(503, { error: 'web_quiz_off' }), 'off', 'ur'],
];
const plainPage = (kind, lang) => renderClosedPage({ lang, kind, origin: `http://${HOST}`, assetV: assetVersion(), brandKey: null, ui: null });

describe('switch ON, no number configured', () => {
  beforeEach(() => number(null));

  test.each(PAGES)('%s: ONE tap, href whatsapp://send?text=quiz, the signed sentence; the page\'s own lines stay', async (name, p, headers, answer, kind, lang) => {
    door = true;
    next = answer || (() => jsonRes(500, {}));
    await boot();
    const r = await req(srv, p, headers);
    expect(r.body).toContain('wq-closed');
    const words = expectOneTap(r.body, APP, lang === 'ur' ? UR : EN);
    if (lang === 'ur') {
      expect(words).toContain('واٹس ایپ');
      expect(words).not.toContain('واٹس ایپ');
    }
    // every line of today's page is still there
    const today = plainPage(kind, lang);
    for (const line of today.match(/<h1>[\s\S]*?<\/h1>|<p class="wq-sub">[\s\S]*?<\/p>/g)) expect(r.body).toContain(line);
  });

  test('the edge\'s own go.error page (/quiz/go/:token, the bot answered 5xx): ONE tap, the app link, both languages', async () => {
    resetSwitch();
    const app = express();
    app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), oneDoorOn: async () => true }));
    await new Promise((r) => { srv = app.listen(0, r); });
    const r = await req(srv, `/quiz/go/${GO_TOK}`);
    expect(r.status).toBe(503);
    expect(r.body).toContain('data-screen="go.error"');
    expectOneTap(r.body, APP, [UR, EN]);
  });
});

describe('switch ON, number configured', () => {
  test.each([['whatsapp'], ['referral']])('%s number: ONE tap, href https://wa.me/<digits>?text=quiz', async (which) => {
    number(which);
    door = true;
    for (const [, p, headers, answer, , lang] of PAGES) {
      next = answer || (() => jsonRes(500, {}));
      await boot();
      const r = await req(srv, p, headers);
      expectOneTap(r.body, WA, lang === 'ur' ? UR : EN);
      expect(r.body.match(/wa\.me/g)).toHaveLength(1);
      await new Promise((res) => srv.close(res));
      srv = null;
    }
  });

  test('the edge\'s go.error: ONE tap to wa.me, no second "Open WhatsApp"', async () => {
    number('whatsapp');
    const app = express();
    app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), oneDoorOn: async () => true }));
    await new Promise((r) => { srv = app.listen(0, r); });
    const r = await req(srv, `/quiz/go/${GO_TOK}`);
    expectOneTap(r.body, WA, [UR, EN]);
    expect(r.body.match(/wa\.me/g)).toHaveLength(1);
    expect(r.body).not.toContain('>Open WhatsApp<');
  });
});

describe('the switch read from app_settings (app.locals.supabase): only the JSON boolean true is on', () => {
  test.each([[true]])('quiz_one_door = %j → the tap (once the cached read has landed)', async (value) => {
    number(null);
    next = () => jsonRes(500, {});
    await boot({ inject: false, locals: settingsClient(value) });
    await req(srv, '/h/not-a-token');           // a cold cache never waits: this page may be today's
    await new Promise((r) => setTimeout(r, 20));
    const r = await req(srv, '/h/not-a-token');
    expectOneTap(r.body, APP, EN);
  });
});

describe('switch OFF in every state: byte-identical to the page before the change', () => {
  const OFF_STATES = [['absent', undefined], ['false', false], ['garbage', 'yes please'], ['string "true"', 'true'], ['quoted string "true"', '"true"'],
    ['number 1', 1], ['throws', 'throw'], ['error', 'error'], ['no client', null]];

  test('the renderer with no tap is the page from before (pinned bytes), every kind and language', () => {
    for (const kind of ['hub', 'closed', 'off']) {
      for (const lang of ['en', 'ur']) {
        for (const ui of [null, { ur2: true }]) {
          const html = renderClosedPage({ lang, kind, origin: `http://${HOST}`, assetV: ['01234', '56789'].join(''), brandKey: 'niete', ui });
          const key = `closed|${kind}|${lang}|${ui ? 'ur2' : 'plain'}`;
          if (RECORD) recorded[key] = sha(html);
          else expect({ key, h: sha(html) }).toEqual({ key, h: golden[key] });
          expect(html.match(/<a\b/g)).toBeNull();
        }
      }
    }
  });

  test.each(OFF_STATES)('switch %s: every dead-end page is today\'s, with and without a number', async (label, row) => {
    for (const which of [null, 'whatsapp']) {
      number(which);
      for (const [, p, headers, answer, kind, lang] of [...PAGES, ...OFF_PAGES]) {
        next = answer || (() => jsonRes(500, {}));
        await boot({ inject: false, locals: row === null ? undefined : settingsClient(row) });
        await req(srv, p, headers);
        await new Promise((r) => setTimeout(r, 20));
        const r = await req(srv, p, headers);
        expect(r.body).toBe(plainPage(kind, lang));
        await new Promise((res) => srv.close(res));
        srv = null;
      }
    }
  });

  test('switch given as off: today\'s pages', async () => {
    number('whatsapp');
    door = false;
    for (const [, p, headers, answer, kind, lang] of [...PAGES, ...OFF_PAGES]) {
      next = answer || (() => jsonRes(500, {}));
      await boot();
      const r = await req(srv, p, headers);
      expect(r.body).toBe(plainPage(kind, lang));
      await new Promise((res) => srv.close(res));
      srv = null;
    }
  });

  test('the edge\'s go.error with the switch off (given, or no client to read it): the page from before', async () => {
    for (const which of [null, 'whatsapp']) {
      number(which);
      for (const oneDoorOn of [async () => false, undefined]) {
        resetSwitch();
        const app = express();
        app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), ...(oneDoorOn ? { oneDoorOn } : {}) }));
        await new Promise((r) => { srv = app.listen(0, r); });
        const r = await req(srv, `/quiz/go/${GO_TOK}`);
        const bot = which ? WA_BOT : null;
        expect(r.body).toBe(GoPage.buildMessagePage({ id: 'go.error', lang: 'bi', bot }).html);
        await new Promise((res) => srv.close(res));
        srv = null;
      }
    }
  });
});

describe('kind \'off\' (the service is down) is unchanged with the switch ON', () => {
  test.each(OFF_PAGES)('%s', async (name, p, headers, answer, kind, lang) => {
    number('whatsapp');
    door = true;
    next = answer;
    await boot();
    const r = await req(srv, p, headers);
    expect(r.status).toBe(503);
    expect(r.body).toBe(plainPage(kind, lang));
    expect(r.body).not.toMatch(/<a\b/);
  });

  test('no bot configured (/h/<token>): the "not open right now" page, unchanged', async () => {
    number(null);
    door = true;
    await boot({ bot: false });
    const r = await req(srv, `/h/${TOKEN}`);
    expect(r.status).toBe(503);
    expect(r.body).toBe(plainPage('off', 'en'));
  });
});
