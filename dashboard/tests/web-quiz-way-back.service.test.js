/**
 * An expired, forged or closed child link on the portal is never a dead end (switch web_quiz_closed_way_back ON, default
 * OFF): the closed page
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
 * (delete the file and run this once: that run records it and fails, the next run checks it). The bot is the network boundary (a fake fetch); the switch's table read is a fake client.
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
// no golden file → this run records one and fails (never a silent pass); no env knob
const RECORD = !fs.existsSync(GOLDEN_FILE);
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

/**
 * A table client whose app_settings row for web_quiz_closed_way_back is `row` (undefined → no row; 'throw' → the read
 * throws). quiz_one_door always reads true: the way back rides its own switch only.
 */
function settingsClient(row) {
  return {
    from: () => ({
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => {
            if (row === 'throw') throw new Error('app_settings down');
            if (row === 'error') return { data: null, error: { message: 'down' } };
            if (row === 'null-value' && key === 'web_quiz_closed_way_back') return { data: { value: null }, error: null };
            if (key === 'quiz_one_door') return { data: { value: true }, error: null };
            return { data: key === 'web_quiz_closed_way_back' && row !== undefined ? { value: row } : null, error: null };
          },
        }),
      }),
    }),
  };
}
const resetSwitch = () => { try { require('../lib/closed-way-back-switch')._reset(); } catch (_) { /* not on this code */ } };

let srv;
let next;
let door;
/** The router with the switch given (`door` = true/false), or read from app.locals.supabase (`locals`). */
async function boot({ inject = true, locals = undefined, bot = true } = {}) {
  resetSwitch();
  const app = express();
  if (locals !== undefined) app.locals.supabase = locals;
  const opts = { botUrl: bot ? BOT : '', apiKey: bot ? KEY : '', canonicalBase: '', fetchImpl: async () => next() };
  if (inject) opts.wayBackOn = () => door;
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
    app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), wayBackOn: async () => true }));
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
    app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), wayBackOn: async () => true }));
    await new Promise((r) => { srv = app.listen(0, r); });
    const r = await req(srv, `/quiz/go/${GO_TOK}`);
    expectOneTap(r.body, WA, [UR, EN]);
    expect(r.body.match(/wa\.me/g)).toHaveLength(1);
    expect(r.body).not.toContain('>Open WhatsApp<');
  });
});

describe('the switch read from app_settings (app.locals.supabase): only the JSON boolean true is on', () => {
  test.each([[true]])('web_quiz_closed_way_back = %j → the tap (once the cached read has landed)', async (value) => {
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
  const OFF_STATES = [['absent', undefined], ['false', false], ['yes', 'yes'], ['string "true"', 'true'], ['quoted string "true"', '"true"'],
    ['number 1', 1], ['object', {}], ['null', 'null-value'], ['throws', 'throw'], ['error', 'error'], ['no client', null]];

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
      for (const wayBackOn of [async () => false, undefined]) {
        resetSwitch();
        const app = express();
        app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), ...(wayBackOn ? { wayBackOn } : {}) }));
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

describe('the closed page never waits on the switch (read from the cache only)', () => {
  /** settingsClient(true) whose app_settings read answers after `delayMs`. */
  function slowClient(delayMs) {
    const c = settingsClient(true);
    return {
      from: (t) => {
        const b = c.from(t);
        return { select: (...s) => { const q = b.select(...s); return { eq: (...e) => { const m = q.eq(...e); return { maybeSingle: async () => { await new Promise((r) => setTimeout(r, delayMs)); return m.maybeSingle(); } }; } }; } };
      },
    };
  }

  test('cold cache, switch ON behind a slow read: the first page is today\'s bytes at once; the next one, after the read, has the tap', async () => {
    number('whatsapp');
    next = () => jsonRes(500, {});
    await boot({ inject: false, locals: slowClient(300) });
    const t0 = Date.now();
    const first = await req(srv, '/h/not-a-token');
    expect(Date.now() - t0).toBeLessThan(250);
    expect(first.body).toBe(plainPage('hub', 'en'));
    await new Promise((r) => setTimeout(r, 400));
    const second = await req(srv, '/h/not-a-token');
    expectOneTap(second.body, WA, EN);
  });
});

describe('the /h/ closed page speaks the link\'s language (switch ON): ?lang=, then the token\'s own lang, then the phone', () => {
  /** A hub token shaped like the join's (its payload carries `lang`); the signature is not checked by the page. */
  const tokenWith = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.AbCdEfGhIjKlMnOpQrStUv`;
  const JOIN_UR = tokenWith({ k: 'h', ids: [], pr: 1, lang: 'ur', exp: 1 });
  const JOIN_EN = tokenWith({ k: 'h', ids: [], pr: 1, lang: 'en', exp: 1 });
  const ROWS = [
    ['forged, ?lang=ur, an English phone → Urdu', '/h/not-a-token?lang=ur', { 'accept-language': 'en' }, null, UR],
    ['expired, ?lang=ur, an English phone → Urdu', `/h/${TOKEN}?lang=ur`, { 'accept-language': 'en-US' }, () => jsonRes(401, { error: 'bad_token' }), UR],
    ['expired, ?lang=en, an Urdu phone → English', `/h/${TOKEN}?lang=en`, { 'accept-language': 'ur-PK' }, () => jsonRes(401, { error: 'bad_token' }), EN],
    ['expired join token (lang ur), no query, an English phone → Urdu', `/h/${JOIN_UR}`, { 'accept-language': 'en' }, () => jsonRes(401, { error: 'bad_token' }), UR],
    ['expired join token (lang en), no query, an Urdu phone → English', `/h/${JOIN_EN}`, { 'accept-language': 'ur-PK' }, () => jsonRes(401, { error: 'bad_token' }), EN],
    ['?lang= beats the token: join token (lang ur) + ?lang=en → English', `/h/${JOIN_UR}?lang=en`, { 'accept-language': 'ur-PK' }, () => jsonRes(401, { error: 'bad_token' }), EN],
    ['neither (no query, no lang in the token) → the phone, as today: Urdu phone', `/h/${TOKEN}`, { 'accept-language': 'ur-PK' }, () => jsonRes(401, { error: 'bad_token' }), UR],
    ['?lang=fr is not a language here → the phone: English', '/h/not-a-token?lang=fr', { 'accept-language': 'en' }, null, EN],
  ];
  test.each(ROWS)('%s', async (name, p, headers, answer, sentence) => {
    number('whatsapp');
    door = true;
    next = answer || (() => jsonRes(500, {}));
    await boot();
    const r = await req(srv, p, headers);
    const words = expectOneTap(r.body, WA, sentence);
    expect(words).not.toContain(sentence === UR ? EN : UR);
    expect(r.body).toContain(`lang="${sentence === UR ? 'ur' : 'en'}"`);
  });

  test('switch OFF: ?lang=ur on an English phone is today\'s English page, byte for byte', async () => {
    number('whatsapp');
    door = false;
    for (const [p, answer] of [['/h/not-a-token?lang=ur', null], [`/h/${TOKEN}?lang=ur`, () => jsonRes(401, { error: 'bad_token' })], [`/h/${JOIN_UR}`, () => jsonRes(401, { error: 'bad_token' })]]) {
      next = answer || (() => jsonRes(500, {}));
      await boot();
      const r = await req(srv, p, { 'accept-language': 'en' });
      expect(r.body).toBe(plainPage('hub', 'en'));
      await new Promise((res) => srv.close(res));
      srv = null;
    }
  });
});

describe('every other closed-page kind speaks the link\'s language too (switch ON); OFF stays today\'s', () => {
  const tokenWith = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.AbCdEfGhIjKlMnOpQrStUv`;
  const CH_UR = tokenWith({ k: 'c', sid: 'a', ex: 1, r: 'b', l: 'ur', exp: 1 });
  const gone = () => jsonRes(401, { error: 'bad_token' });
  // [name, path, headers, the bot's answer, the sentence ON, today's kind + lang (OFF)]
  const KINDS = [
    ['/q/ closed (the quiz says en) + ?lang=ur → Urdu', '/q/ABCD1234?lang=ur', {}, () => jsonRes(404, { error: 'not_found' }), UR, ['closed', 'en']],
    ['/q/ closed (the quiz says ur) + ?lang=en → English', '/q/ABCD1234?lang=en', {}, () => jsonRes(410, { error: 'closed', lang: 'ur' }), EN, ['closed', 'ur']],
    ['/c/ expired, the token\'s own l=ur, no query → Urdu', `/c/${CH_UR}`, {}, gone, UR, ['closed', 'en']],
    ['/k/ forged + ?lang=ur → Urdu', '/k/x?lang=ur', {}, null, UR, ['closed', 'en']],
    ['/lib/ forged + ?lang=ur → Urdu', '/lib/x?lang=ur', {}, null, UR, ['closed', 'en']],
    ['/j/ forged + ?lang=ur → Urdu', '/j/x?lang=ur', {}, null, UR, ['closed', 'en']],
  ];
  test.each(KINDS)('ON: %s', async (name, p, headers, answer, sentence) => {
    number('whatsapp');
    door = true;
    next = answer || (() => jsonRes(500, {}));
    await boot();
    const r = await req(srv, p, headers);
    const words = expectOneTap(r.body, WA, sentence);
    expect(words).not.toContain(sentence === UR ? EN : UR);
    expect(r.body).toContain(`lang="${sentence === UR ? 'ur' : 'en'}"`);
  });
  test.each(KINDS)('OFF: %s is today\'s page, byte for byte', async (name, p, headers, answer, sentence, [kind, lang]) => {
    number('whatsapp');
    door = false;
    next = answer || (() => jsonRes(500, {}));
    await boot();
    const r = await req(srv, p, headers);
    expect(r.body).toBe(plainPage(kind, lang));
  });

  const goEdge = async (p, headers, wayBackOn) => {
    resetSwitch();
    const app = express();
    app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(503, {}), ...(wayBackOn ? { wayBackOn } : {}) }));
    await new Promise((r) => { srv = app.listen(0, r); });
    return req(srv, p, headers);
  };
  test('ON: the edge\'s go.error + ?lang=ur on an English phone → the Urdu-only page', async () => {
    number(null);
    const r = await goEdge(`/quiz/go/${GO_TOK}?lang=ur`, { 'accept-language': 'en' }, async () => true);
    const words = expectOneTap(r.body, APP, [UR]);
    expect(words).not.toContain(EN);
  });
  test('ON: the edge\'s go.error + ?lang=en on an Urdu phone → the page with its English lines (the door has no English-only page)', async () => {
    number(null);
    const r = await goEdge(`/quiz/go/${GO_TOK}?lang=en`, { 'accept-language': 'ur-PK' }, async () => true);
    expectOneTap(r.body, APP, [UR, EN]);
  });
  test('OFF: the edge\'s go.error with ?lang= is today\'s (the phone decides)', async () => {
    number(null);
    let r = await goEdge(`/quiz/go/${GO_TOK}?lang=ur`, { 'accept-language': 'en' }, async () => false);
    expect(r.body).toBe(GoPage.buildMessagePage({ id: 'go.error', lang: 'bi', bot: null }).html);
    await new Promise((res) => srv.close(res));
    srv = null;
    r = await goEdge(`/quiz/go/${GO_TOK}?lang=en`, { 'accept-language': 'ur-PK' }, async () => false);
    expect(r.body).toBe(GoPage.buildMessagePage({ id: 'go.error', lang: 'ur', bot: null }).html);
  });
});

test('the switch-off goldens are pinned (a missing file is recorded by this run, which then fails)', () => {
  expect({ goldenFile: path.basename(GOLDEN_FILE), recorded: RECORD }).toEqual({ goldenFile: path.basename(GOLDEN_FILE), recorded: false });
});
