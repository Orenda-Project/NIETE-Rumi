/**
 * A closed class link on a phone that holds a child (app_settings web_quiz_link_known_child): when the bot's closed answer
 * says `known: true` (the switch is on), the closed-quiz page asks the bot once (POST /api/internal/wq/known/home, this
 * phone's wq_dv cookie as x-wq-device; never without the cookie; at most 1.5 s) and, when the bot answers
 * this phone's home, carries ONE button to it under the teacher line; a phone that holds nobody gets the "/quiz on
 * WhatsApp" line instead. Switch off (no `known` in the closed answer: the edge never asks; or the bot says {on:false},
 * an error, or an older bot): today's page, byte-identical. With web_quiz_closed_way_back ON too (the router's own
 * option, its cached read's stand-in), the page has ONE button, never two: this phone's home, else the tap back to
 * WhatsApp (and no "/quiz" line beside it). The bot is the network boundary (a fake fetch); no first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderClosedPage, assetVersion } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const DEV = 'dddddddddddddddddddddd';
const HOME = '/h/eyJrIjoiaCIsImlkcyI6WyJ4Il19.AbCdEfGhIjKlMnOpQrStUv?from=link';
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out, headers: res.headers }));
    });
    r.on('error', reject); r.end();
  });
}

let srv; let calls; let quiz; let home; let back;
beforeEach(async () => {
  calls = [];
  quiz = jsonRes(410, { error: 'expired', lang: 'en', known: true });
  home = jsonRes(200, { on: true, home: HOME });
  back = false;
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    if (url.indexOf('/known/home') >= 0) { if (home === 'hang') return new Promise(() => {}); if (home instanceof Error) throw home; return home; }
    return quiz;
  }, wayBackOn: () => back }));
  srv = await start(app);
});
afterEach(() => new Promise((r) => srv.close(r)));
const homeCalls = () => calls.filter((c) => c.url.indexOf('/api/internal/wq/known/home') >= 0);
// the buttons and links of the page's own section (the closed words, then at most one button)
const links = (body) => (body.split('<section class="wq-screen wq-closed">')[1] || '').split('</section>')[0].match(/<a /g) || [];
const today = (lang = 'en') => renderClosedPage({ lang, kind: 'closed', origin: `http://127.0.0.1:${srv.address().port}`, assetV: assetVersion(), brandKey: null });

describe('switch on', () => {
  test('a phone that holds its child: the closed page keeps its words and adds ONE button to the child\'s home', async () => {
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(res.status).toBe(410);
    expect(homeCalls()).toHaveLength(1);
    expect(homeCalls()[0].opts.headers['x-wq-device']).toBe(DEV);
    expect(res.body).toContain('This quiz has closed');
    expect(res.body).toContain('Ask your teacher for a new link.');
    expect(res.body).toContain(`<a class="wq-btn wq-go" href="${HOME.replace('&', '&amp;')}">Go to my home page</a>`);
    expect(res.headers['cache-control']).toBe('private, no-store');   // it carries a hub token
  });

  test('Urdu: «اپنے ہوم پیج پر جائیں»', async () => {
    quiz = jsonRes(410, { error: 'expired', lang: 'ur', known: true });
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(res.body).toContain('اپنے ہوم پیج پر جائیں');
    expect(res.body).toContain('یہ کوئز بند ہو چکا ہے');
  });

  test('a phone that holds nobody (a forwarded link, no cookie): no button, the "/quiz on WhatsApp" line beside the teacher line, and the bot is not asked', async () => {
    const res = await get(srv, '/q/AB12CD');
    expect(res.status).toBe(410);
    expect(res.body).not.toContain('wq-btn');
    expect(res.body).toContain('Ask your teacher for a new link.');
    expect(res.body).toContain('Send /quiz on WhatsApp to get a new one.');
    expect(homeCalls()).toHaveLength(0);
  });

  test('a phone the bot finds holding nobody: the same line, no button', async () => {
    home = jsonRes(200, { on: true, home: null });
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(homeCalls()).toHaveLength(1);
    expect(res.body).not.toContain('wq-btn');
    expect(res.body).toContain('Send /quiz on WhatsApp to get a new one.');
  });

  test('a home of the wrong shape is never drawn (an outside link, a script): no button', async () => {
    for (const bad of ['https://evil.test/h/x?from=link', '/h/x?from=link"><script>', 'javascript:alert(1)', 42]) {
      home = jsonRes(200, { on: true, home: bad });
      const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      expect(res.body).not.toContain('wq-btn');
      expect(res.body).not.toContain('evil.test');
    }
  });
});

describe('golden: today\'s page, byte-identical', () => {
  for (const [name, known] of [['switch off: no `known` in the closed answer', undefined], ['`known` that is not true', 'true']]) {
    test(`${name}: the bot is never asked, and the headers are today's`, async () => {
      quiz = jsonRes(410, { error: 'expired', lang: 'en' });
      const before = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      if (known !== undefined) quiz = jsonRes(410, { error: 'expired', lang: 'en', known });
      const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      expect(res.status).toBe(410);
      expect(homeCalls()).toHaveLength(0);
      expect(res.body).toBe(today());
      expect(res.headers['cache-control']).toBe(before.headers['cache-control']);
      expect(res.headers['cache-control']).not.toBe('private, no-store');
    });
  }

  test('a bot that never answers about the home: today\'s page within 1.5 s', async () => {
    home = 'hang';
    const t0 = Date.now();
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(res.body).toBe(today());
  });

  for (const [name, reply] of Object.entries({
    'the bot\'s switch off': () => jsonRes(200, { on: false }),
    'the bot answers an error': () => jsonRes(503, { error: 'off' }),
    'an older bot (no such route)': () => ({ status: 404, ok: false, headers: { get: () => 'text/html' }, text: async () => 'Cannot POST' }),
    'the bot is unreachable': () => new Error('down'),
  })) {
    test(name, async () => {
      home = reply();
      const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      expect(res.status).toBe(410);
      expect(res.body).toBe(today());
    });
  }

  test('a quiz that is open never asks; a not-open bot (503) never asks', async () => {
    quiz = jsonRes(503, { error: 'off' });
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(res.status).toBe(503);
    expect(homeCalls()).toHaveLength(0);
  });

  test('renderClosedPage with no home options is today\'s page', () => {
    expect(renderClosedPage({ lang: 'en', kind: 'closed', origin: 'o', home: undefined })).toBe(renderClosedPage({ lang: 'en', kind: 'closed', origin: 'o' }));
  });
});

describe('with the way back to WhatsApp ON too: ONE button, never two', () => {
  beforeEach(() => { back = true; });
  for (const lang of ['en', 'ur']) {
    test(`${lang}: a phone that holds its child → only its home`, async () => {
      quiz = jsonRes(410, { error: 'expired', lang, known: true });
      const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      expect(links(res.body)).toHaveLength(1);
      expect(res.body).toContain(`href="${HOME}"`);
      expect(res.body).not.toContain('data-tap="open_whatsapp"');
    });

    test(`${lang}: a fresh phone → only the tap back to WhatsApp, no "/quiz" line beside it`, async () => {
      quiz = jsonRes(410, { error: 'expired', lang, known: true });
      const res = await get(srv, '/q/AB12CD');
      expect(links(res.body)).toHaveLength(1);
      expect(res.body).toContain('data-tap="open_whatsapp"');
      expect(res.body).not.toContain('Send /quiz on WhatsApp');
      expect(res.body).not.toContain('⁦/quiz⁩');
      expect(homeCalls()).toHaveLength(0);
    });
  }

  test('a phone the bot finds holding nobody → only the tap', async () => {
    home = jsonRes(200, { on: true, home: null });
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(links(res.body)).toHaveLength(1);
    expect(res.body).toContain('data-tap="open_whatsapp"');
    expect(res.body).not.toContain('Send /quiz on WhatsApp');
  });

  test('no answer from the bot (unreachable, an error, never answers) → the tap, never no button', async () => {
    for (const reply of [new Error('down'), jsonRes(503, { error: 'off' }), 'hang']) {
      home = reply;
      const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
      expect(links(res.body)).toHaveLength(1);
      expect(res.body).toContain('data-tap="open_whatsapp"');
    }
  });

  test('the class link\'s switch off: the bot is never asked, the tap as the way back builds it', async () => {
    quiz = jsonRes(410, { error: 'expired', lang: 'en' });
    const res = await get(srv, '/q/AB12CD', { cookie: `wq_dv=${DEV}` });
    expect(homeCalls()).toHaveLength(0);
    expect(links(res.body)).toHaveLength(1);
    expect(res.body).toContain('data-tap="open_whatsapp"');
  });
});
