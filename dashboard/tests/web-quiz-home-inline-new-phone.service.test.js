/**
 * A new phone's first Home carries the Home's own files (wq-home.css, wq-home.js) on EVERY open, the first after a
 * process start included (web_quiz_home_inline + web_quiz_early_unlock).
 *
 * Live on sandbox after a deploy (2 new phones × EN/UR), two opens missed it:
 *   - the first new phone after the deploy carried wq.css, wq-tel and hub.js only: the process had seen no child's answer,
 *     so the early-unlock shape was empty and the locked render's tail named no home files; wq-home.css/js were fetched
 *     after the hub answer (ready 2.2 s);
 *   - a later new phone got the plain 6.7 K page (ready 3.6 s): a child's answer that the head cannot carry (no v3 home
 *     on that one answer, the fallback home, the pack) turned the inline Home off for every later new phone.
 * Rows here: the learner's `home_v3` gives a fresh process the Home's shape (files carried from the first new phone);
 * a child's answer that cannot be carried leaves the next new phone's inline Home as it was; only an answer without
 * `home_inline` (the switch off) turns it off (home-inline-every-open's row).
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

const uiOf = (lang) => (lang === 'ur' ? { ur2: true, adv: true } : { adv: true });
const HUB = (lang, extra = {}) => ({
  lang, kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true, home_pre: true,
  home_v3: 1, adv: true, one_button: true, play: { first: null }, home_inline: true, early_unlock: true, ui: uiOf(lang),
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (lang, extra = {}) => ({ lang, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, home_pre: true, home_inline: true, early_unlock: true, adv: true, ui: uiOf(lang), ...extra });
const LEARN = (lang, extra = {}) => ({ learn: true, fast: true, brand: 'niete', rt: false, ui: uiOf(lang), one_face: false, adv: true, wait_ux: false, home_inline: true, early_unlock: true, home_v3: 1, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const settle = () => new Promise((r) => setTimeout(r, 20));

function request(srv, method, p, { onFirstChunk, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

/** The bot: /edge answers `edge` (or learn:false); every other call takes the next answer in line, held until release(). */
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
async function newPhone(srv, bot, lang) {
  let answered = false;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await request(srv, 'GET', `/h/${TOKEN}?lang=${lang}`, { onFirstChunk: () => setTimeout(answer, 50) });
  clearTimeout(fallback);
  return res.body;
}

const fileOf = (u) => u.split('?')[0].replace('/wq/', '');
/** The files the page carries in itself (stylesheets and scripts), by name. */
function carried(html) {
  const out = [];
  const rx = /<link rel="wq-src" href="([^"]+)"><style>|<script type="text\/x-wq" src="([^"]+)"/g;
  let m;
  while ((m = rx.exec(html))) out.push(fileOf(m[1] || m[2]));
  return out;
}
/** The Home's files the page leaves to the network (a stylesheet or script tag naming them). */
function fetched(html) {
  const out = [];
  const rx = /<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"[^>]* defer><\/script>/g;
  let m;
  while ((m = rx.exec(html))) out.push(fileOf(m[1] || m[2]));
  return out.filter((f) => /^wq-home\./.test(f));
}
const HOME = ['wq-home.css', 'wq-home.js'];

describe('a new phone\'s first Home carries the Home\'s own files, every open', () => {
  let srv;
  beforeEach(() => { HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset(); });
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  for (const lang of ['en', 'ur']) {
    test(`${lang}: the first new phone after a process start (the learner says home_v3; no child seen yet) carries wq-home.css and wq-home.js`, async () => {
      const bot = fakeBot({ edge: LEARN(lang), pages: [{ hold: true, res: jsonRes(200, LOCKED(lang)) }, { hold: true, res: jsonRes(200, LOCKED(lang)) }] });
      srv = await start(build(bot.fetchImpl, { timers: timers() }));
      await settle();
      const a = await newPhone(srv, bot, lang);
      const b = await newPhone(srv, bot, lang);
      expect(carried(a)).toEqual(expect.arrayContaining(HOME));
      expect(fetched(a)).toEqual([]);
      expect(carried(b)).toEqual(expect.arrayContaining(HOME));
    });

    test(`${lang}: a child's answer the head cannot carry (no v3 home on that answer; the fallback home; the pack) leaves the next new phone's inline Home on`, async () => {
      for (const odd of [{ home_v3: undefined, doors: undefined }, { home_fb: 1 }, { pack: true }]) {
        HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset();
        const bot = fakeBot({ pages: [jsonRes(200, HUB(lang)), jsonRes(200, HUB(lang, odd)), { hold: true, res: jsonRes(200, LOCKED(lang)) }] });
        const s = await start(build(bot.fetchImpl));
        await request(s, 'GET', `/h/${TOKEN}?lang=${lang}`, { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' });
        await request(s, 'POST', `/api/wq/hub/${TOKEN}`, { body: { kid: KID } });
        const page = await newPhone(s, bot, lang);
        await new Promise((r) => s.close(r));
        expect([Object.keys(odd)[0], carried(page)]).toEqual([Object.keys(odd)[0], expect.arrayContaining(['wq.css', 'wq-tel.js', 'hub.js', 'wq-home.js'])]);
      }
    });
  }
});
