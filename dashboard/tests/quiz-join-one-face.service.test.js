/**
 * The join page and the one Urdu face (web_quiz_one_face, decided by the bot: its join answer says `one_face: true`).
 * On: the Urdu page preloads and draws with wq-nastaliq-6 (the face the home uses) and never names wq-nastaliq-5.
 * Off (the default, anything but the boolean true): every page the join route draws is byte for byte today's, held by
 * a golden recorded from the code before this change (join-off-golden.json: both languages, practice, the notes).
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { createQuizJoinRouter, renderJoinPage, renderJoinNote, WAIT_CSS, EARLY_TAP } = require('../routes/quiz-join.routes');
const GOLDEN = require('./fixtures/join-off-golden.json');

const F5 = 'wq-nastaliq-5.woff2';
const F6 = 'wq-nastaliq-6.woff2';
const BOT_NO = ['92', '000', '0000', '100'].join('');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const tok = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'s'.repeat(22)}`;
const J = tok({ k: 'j', n: 'N'.repeat(22), l: 'ur', exp: 4102444800 });
const T = 'T.' + 's'.repeat(22);
const unbot = (s) => s.split('__BOT__').join(BOT_NO);

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function get(srv, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'quiz.example.org' } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}
async function withPage(status, body, fn) {
  const fetchImpl = async (url) => (url.includes('/api/internal/wq/join/page/') ? jsonRes(status, body) : jsonRes(404, {}));
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  app.use(createQuizJoinRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, logEvent: () => {} }));
  app.use((r, res) => res.status(418).send('the portal page'));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try { return await fn(srv); } finally { await new Promise((r) => srv.close(r)); }
}

const OFF_PROPS = [['absent', {}], ['false', { one_face: false }], ['the string true', { one_face: 'true' }], ['yes', { one_face: 'yes' }], ['1', { one_face: 1 }], ['an object', { one_face: { enabled: true } }]];
const render = (key, extra = {}) => {
  const [kind, lang, a, b] = key.split('|');
  const bot = (kind === 'page' && b === 'bot') || (kind === 'note' && b === 'true') ? BOT_NO : null;
  if (kind === 'note') return renderJoinNote({ lang, kind: a, bot, ...extra });
  return renderJoinPage({ token: b === 'bot' ? 'T' : T, lang, practice: a === 'true', assetV: 'av', jsV: 'jv', bot, ...extra });
};

describe('off: every page is today\'s, byte for byte', () => {
  test('the golden has the rows it should (the Urdu and English page, practice, the notes), each on the plain face', () => {
    expect(Object.keys(GOLDEN).length).toBe(14);
    Object.values(GOLDEN).forEach((html) => { expect(html).toContain(F5); expect(html).not.toContain(F6); });
  });
  test.each(Object.keys(GOLDEN))('%s', (key) => {
    expect(render(key)).toBe(unbot(GOLDEN[key]));
    expect(render(key, { oneFace: false })).toBe(unbot(GOLDEN[key]));
    expect(render(key, { oneFace: 'true' })).toBe(unbot(GOLDEN[key]));
  });
  test('the Urdu first page still preloads the plain face', () => {
    expect(GOLDEN['page|ur|false']).toContain(`<link rel="preload" href="/wq/fonts/${F5}" as="font" type="font/woff2" crossorigin>`);
  });
  test.each(OFF_PROPS)('through the route, the bot field %s: the page is the golden', async (_n, extra) => {
    await withPage(200, { ok: true, lang: 'ur', practice: false, ...extra }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain(F5);
      expect(res.body).not.toContain(F6);
      expect(res.body.replace(/\/wq\/join\.js\?v=[^"]*/, '').replace(/"v":"[^"]*"/, '').replace(/"t":"[^"]*"/, ''))
        .toBe(GOLDEN['page|ur|false'].replace(/\/wq\/join\.js\?v=[^"]*/, '').replace(/"v":"[^"]*"/, '').replace(/"t":"[^"]*"/, ''));
    });
  });
});

describe('wait word x one face x early tap: the wait rule rides the sheet exactly once whenever the wait word is on', () => {
  const style = (h) => h.match(/<style>([\s\S]*?)<\/style>/)[1];
  const base = (extra) => renderJoinPage({ token: T, lang: 'ur', practice: false, assetV: 'av', jsV: 'jv', ...extra });
  const ROWS = [];
  [false, true].forEach((waitWord) => [false, true].forEach((oneFace) => [false, true].forEach((earlyTap) => ROWS.push([waitWord, oneFace, earlyTap]))));
  test.each(ROWS)('wait %s, one face %s, early tap %s', (waitWord, oneFace, earlyTap) => {
    const html = base({ waitWord, oneFace, earlyTap });
    expect(style(html).split(WAIT_CSS).length - 1).toBe(waitWord ? 1 : 0);
    if (waitWord) expect(style(html).endsWith(WAIT_CSS)).toBe(true);
    expect(html).toContain(oneFace ? F6 : F5);
    expect(html).not.toContain(oneFace ? F5 : F6);
    expect(html.includes(EARLY_TAP)).toBe(earlyTap);
  });
  test('wait word alone keeps today\'s sheet plus the rule', () => {
    expect(style(base({ waitWord: true }))).toBe(style(unbot(GOLDEN['page|ur|false'])) + WAIT_CSS);
  });
  test('through the route: wait word and one face say both, and the page carries the rule once on -6', async () => {
    await withPage(200, { ok: true, lang: 'ur', practice: false, waitWord: true, one_face: true }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(style(res.body).split(WAIT_CSS).length - 1).toBe(1);
      expect(res.body).toContain(F6);
      expect(res.body).not.toContain(F5);
    });
  });
});

describe('on: the one face', () => {
  test.each(Object.keys(GOLDEN))('%s names -6 and never -5', (key) => {
    const html = render(key, { oneFace: true });
    expect(html).toContain(F6);
    expect(html).not.toContain(F5);
    expect(html).not.toContain('"WQ Nastaliq",');
  });
  test('the Urdu first page preloads -6 once, the face is declared once, and the body stack names it', () => {
    const html = render('page|ur|false', { oneFace: true });
    expect(html).toContain(`<link rel="preload" href="/wq/fonts/${F6}" as="font" type="font/woff2" crossorigin>`);
    expect((html.match(/wq-nastaliq-/g) || []).length).toBe(2);
    expect(html).toContain('@font-face{font-family:"WQ Nastaliq 2";src:url(/wq/fonts/wq-nastaliq-6.woff2)');
    expect(html).toContain('[lang=ur] body{font-family:"WQ Nastaliq 2",');
  });
  test('the English page preloads no font, as today; practice keeps no preload either', () => {
    expect(render('page|en|false', { oneFace: true })).not.toContain('rel="preload"');
    expect(render('page|ur|true', { oneFace: true })).not.toContain('rel="preload"');
  });
  test('only the face lines change: with the face lines put back, the page is the off page', () => {
    const on = render('page|ur|false', { oneFace: true });
    const off = unbot(GOLDEN['page|ur|false']);
    const back = on.replace(/@font-face\{[^}]*\}/, off.match(/@font-face\{[^}]*\}/)[0]).replace('"WQ Nastaliq 2",', '"WQ Nastaliq",').replace(F6, F5);
    expect(back).toBe(off);
  });
  test('through the route: one_face true → the Urdu page preloads -6, never -5', async () => {
    await withPage(200, { ok: true, lang: 'ur', practice: false, one_face: true }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain(`<link rel="preload" href="/wq/fonts/${F6}"`);
      expect(res.body).not.toContain(F5);
    });
  });
  test('both ON (the fast page switch says fast: true beside one_face): the face is -6 once; fast alone leaves today\'s -5', async () => {
    await withPage(200, { ok: true, lang: 'ur', practice: false, one_face: true, fast: true }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.body).toContain(F6);
      expect(res.body).not.toContain(F5);
    });
    await withPage(200, { ok: true, lang: 'ur', practice: false, fast: true }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.body).toContain(F5);
      expect(res.body).not.toContain(F6);
    });
  });
  test('through the route: an expired link with one_face draws the note on -6; without, today\'s', async () => {
    await withPage(410, { error: 'stale', lang: 'ur', one_face: true }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.status).toBe(410);
      expect(res.body).toContain(F6);
      expect(res.body).not.toContain(F5);
    });
    await withPage(410, { error: 'stale', lang: 'ur' }, async (srv) => {
      const res = await get(srv, `/quiz/join/${J}`);
      expect(res.body).toContain(F5);
      expect(res.body).not.toContain(F6);
    });
  });
  test('the join script names no font', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'wq', 'join.js'), 'utf8');
    expect(src).not.toMatch(/nastaliq|font-face|\.woff/i);
  });
});
