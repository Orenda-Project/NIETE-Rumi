/**
 * The child home's first open in one response (web_quiz_home_inline) for EVERY new phone, not only after a child's page
 * went through this portal process.
 *
 * The early head follows what this process learned. Live on sandbox, after each deploy a process had learned the switch
 * only from a child's server render; a new phone's server render is locked (it keeps what was learned: nothing), and its
 * child arrives on the page's own /api/wq/hub call, which taught nothing. So a run of new phones got the plain 7 K page
 * (Home ready ~3.7 s) until some phone with its device cookie opened a hub, then the 83 K inline one (~2.7 s).
 * Rows here: with the switch on,
 *   - a locked answer is enough: the next new phones' heads carry wq.css, the look's files, wq-tel and hub.js;
 *   - the page's own /api/wq/hub answer for a child (the unlock) teaches the home's scripts, as a server render does;
 *   - the portal's learner (edge learn) saying `home_inline: true`: the first new phone after a deploy carries them too.
 * Off: unchanged (home-inline's own golden).
 *
 * The bot is the network boundary (a fake fetch answering by path; held answers released by hand). No first-party
 * module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const HomeInline = require('../routes/web-quiz-home-inline');
const HomePre = require('../routes/web-quiz-home-preload');
const EarlyUnlock = require('../routes/web-quiz-early-unlock');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true, home_pre: true,
  home_v3: true, adv: true, one_button: true, play: { first: null }, home_inline: true,
  ui: extra.lang === 'ur' ? { ur2: true, adv: true } : { adv: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, home_pre: true, home_inline: true, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const settle = () => new Promise((r) => setTimeout(r, 20));

function request(srv, method, p, { onFirstChunk, onChunk, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

/** The bot: /edge answers `edge`; every other call takes the next answer in line ({ hold: true, res } waits for release()). */
function fakeBot({ edge = null, pages = [] }) {
  let held = [];
  const fetchImpl = (url) => {
    if (url.endsWith('/api/internal/wq/edge')) return Promise.resolve(jsonRes(200, edge || { learn: false }));
    const p = pages.shift();
    if (p && p.hold) return new Promise((r) => held.push(() => r(p.res)));
    return Promise.resolve(p);
  };
  return { fetchImpl, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}
const timers = () => ({ set: () => ({ unref() {} }), clear() {}, after: () => ({ unref() {} }), cancel() {} });

function build(fetchImpl, edgeLearn) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...(edgeLearn ? { edgeLearn } : {}) }));
  return app;
}

/** A new phone's open (no cookie) whose bot answer is held until the head went: the whole page. */
async function newPhone(srv, bot) {
  let answered = false;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await request(srv, 'GET', `/h/${TOKEN}`, { onFirstChunk: () => setTimeout(answer, 50) });
  clearTimeout(fallback);
  return res.body;
}

const fileOf = (u) => u.split('?')[0].replace('/wq/', '');
/** The files the page carries in itself (stylesheets and scripts), by name, in order. */
function carried(html) {
  const out = [];
  const rx = /<link rel="wq-src" href="([^"]+)"><style>|<script type="text\/x-wq" src="([^"]+)"/g;
  let m;
  while ((m = rx.exec(html))) out.push(fileOf(m[1] || m[2]));
  return out;
}
// What every carrying head holds (the look's own files ride with the look the edge learned, as today)
const HEAD_ONLY = ['wq.css', 'wq-tel.js', 'hub.js'];

describe('web_quiz_home_inline: every new phone gets the inline Home', () => {
  let srv;
  beforeEach(() => { HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset(); });
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  for (const lang of ['en', 'ur']) {
    test(`${lang}: a fresh process that has seen only locked answers: two new phones in a row both get the inline page`, async () => {
      const L = () => jsonRes(200, LOCKED({ lang, ui: lang === 'ur' ? { ur2: true, adv: true } : { adv: true } }));
      const bot = fakeBot({ pages: [L(), { hold: true, res: L() }, { hold: true, res: L() }] });
      srv = await start(build(bot.fetchImpl));
      await request(srv, 'GET', `/h/${TOKEN}`); // the first page after a deploy: a new phone (teaches `fast` and the switch)
      const a = await newPhone(srv, bot);
      const b = await newPhone(srv, bot);
      expect(carried(a)).toEqual(expect.arrayContaining(HEAD_ONLY));
      expect(carried(b)).toEqual(expect.arrayContaining(HEAD_ONLY));
      expect(a).toContain('(function(d,w,L,v){'); // the tail runs what the head carried
    });
  }

  test('the page\'s own /api/wq/hub answer for a child (the unlock) teaches the home\'s scripts: the next new phone carries the home and the corner too', async () => {
    const bot = fakeBot({ pages: [jsonRes(200, LOCKED()), jsonRes(200, HUB()), { hold: true, res: jsonRes(200, LOCKED()) }] });
    srv = await start(build(bot.fetchImpl));
    await request(srv, 'GET', `/h/${TOKEN}`);
    const api = await request(srv, 'POST', `/api/wq/hub/${TOKEN}`, { body: { kid: KID } });
    expect(api.status).toBe(200);
    const page = await newPhone(srv, bot);
    expect(carried(page)).toEqual(expect.arrayContaining([...HEAD_ONLY, 'wq-home.js', 'hub-play.js']));
  });

  test('the portal\'s learner says home_inline (edge learn, before any page): the FIRST new phone after a deploy gets the inline page', async () => {
    const bot = fakeBot({ edge: { learn: true, fast: true, brand: 'niete', rt: false, ui: { adv: true }, one_face: false, wait_ux: false, home_inline: true }, pages: [{ hold: true, res: jsonRes(200, LOCKED()) }] });
    srv = await start(build(bot.fetchImpl, { timers: timers() }));
    await settle();
    const page = await newPhone(srv, bot);
    expect(carried(page)).toEqual(expect.arrayContaining(['wq.css', 'wq-tel.js', 'hub.js']));
  });

  test('the switch off on a locked answer (no `home_inline`): the next new phone gets today\'s page (nothing carried)', async () => {
    const bot = fakeBot({ pages: [jsonRes(200, LOCKED()), jsonRes(200, LOCKED({ home_inline: undefined })), { hold: true, res: jsonRes(200, LOCKED({ home_inline: undefined })) }] });
    srv = await start(build(bot.fetchImpl));
    await request(srv, 'GET', `/h/${TOKEN}`);
    await request(srv, 'GET', `/h/${TOKEN}`);
    const page = await newPhone(srv, bot);
    expect(carried(page)).toEqual([]);
  });
});
