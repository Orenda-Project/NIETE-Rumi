/**
 * The inline Home on EVERY open of a saved phone (app_settings web_quiz_home_inline_every, default off; the hub JSON and
 * the portal's learner say `home_every: true` only with web_quiz_home_inline on).
 *
 * With web_quiz_home_inline alone, a phone that holds the `wqhc` cookie at this version gets today's page (the ~9 K head,
 * the home's files from its cache). Measured on slow 4G + 4x CPU, those opens are ready at 2.4-2.6 s against 1.1-1.5 s
 * for the inline page: the cache a cookie promises is often not there (a cookie-only open, an evicted cache). ON, the
 * cookie no longer turns the carried files off: every open's head carries them, and no cache check rides the head.
 * Rows:
 *   - ON: a 2nd and a 3rd open with the cookie carry the files, EN and UR; the learner saying it before any page too;
 *   - the page stays per-child: a 2nd child on the same phone gets only their own name, and the page's cache headers
 *     are today's (no-cache, no ETag, no Last-Modified: nothing to replay another child's page from);
 *   - a newer saved choice wins: the answer's language fix is the one today's held page draws (the head's guess never
 *     overrides it);
 * OFF (home_inline without home_every): the cookie open is today's held page (home-inline's own rows and golden).
 *
 * The bot is the network boundary (a fake fetch answering by path; held answers released by hand). No first-party
 * module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, assetVersion } = require('../routes/web-quiz.routes');
const HomeInline = require('../routes/web-quiz-home-inline');
const HomePre = require('../routes/web-quiz-home-preload');
const EarlyUnlock = require('../routes/web-quiz-early-unlock');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const TOKEN_B = 'eyJrIjoiaCIsImlkcyI6WyJiIl0sImV4cCI6OTk5OTk5OTk5OX0.ZyXwVuTsRqPoNmLkJiHgFe';
const KID = '0123456789abcdef';
const KID_B = 'fedcba9876543210';

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
  home_v3: true, adv: true, one_button: true, wait_ux: true, wait_hops: true, wait_home: true, play: { first: null },
  home_inline: true,
  ui: extra.lang === 'ur' ? { ur2: true, adv: true } : { adv: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const EVERY = { home_every: true };
const CHILD_B = { kids: [{ chip: KID_B, first: 'Bina Testwala', animal: 'cat', grade: '2' }], kid: KID_B };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function get(srv, p, { onFirstChunk, onChunk, cookie, lang } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(cookie ? { cookie } : {}), ...(lang ? { 'accept-language': lang } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** The bot: /edge answers `edge`; every other call takes the next answer in line ({ hold: true, res } waits for release()). */
function fakeBot({ edge = null, pages = [] }) {
  let held = [];
  const fetchImpl = (url) => {
    if (url.endsWith('/api/internal/wq/edge')) return Promise.resolve(jsonRes(200, edge || { learn: false }));
    const p = pages.shift();
    if (p && p.hold) return new Promise((r) => held.push(() => r(p.res)));
    return Promise.resolve(p && p.res ? p.res : p);
  };
  return { fetchImpl, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}

function build(fetchImpl, edgeLearn) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...(edgeLearn ? { edgeLearn } : {}) }));
  return app;
}

/** What the page sent while the bot had not answered yet, and the whole page (its headers too). */
async function flushedOpen(srv, bot, { token = TOKEN, ...opts } = {}) {
  let answered = false; let early = '';
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, `/h/${token}`, {
    ...opts,
    onChunk: (c) => { if (!answered) early += c; },
    onFirstChunk: () => setTimeout(answer, 100),
  });
  clearTimeout(fallback);
  return { early, body: res.body, headers: res.headers };
}

const V = (s) => s.match(/\/wq\/hub\.js\?v=([0-9a-zA-Z]+)/)[1];
function carried(html) {
  const out = [];
  const rx = /<link rel="wq-src" href="([^"]+)"><style>|<script type="text\/x-wq" src="([^"]+)"/g;
  let m;
  while ((m = rx.exec(html))) out.push((m[1] || m[2]).split('?')[0].replace('/wq/', ''));
  return out;
}
const CHECK = /<script>\(function\(w,d\)\{w\.addEventListener\("load"[^\n]*<\/script>\n/;
// The answer's own language fix (the tail's first script) and the boot's language: what a newer saved choice decides.
const fixOf = (html) => (html.match(/<script>\(function\(h\)\{[^\n]*\}\)\(document\.documentElement\)<\/script>/) || [''])[0];
const bootLang = (html) => (html.match(/"lang":"(en|ur)"/) || [])[1];
const hold = (extra) => ({ hold: true, res: jsonRes(200, HUB(extra)) });

describe('web_quiz_home_inline_every: the inline Home on every saved-phone open', () => {
  let srv;
  beforeEach(() => { HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset(); });
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  for (const lang of ['en', 'ur']) {
    test(`${lang} ON: the 2nd and 3rd open with the cookie at this version carry the files (as the 1st), no cache check`, async () => {
      const x = { lang, ...EVERY };
      const bot = fakeBot({ pages: [jsonRes(200, HUB(x)), hold(x), hold(x), hold(x)] });
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`); // the portal learns from a child's answer
      const first = await flushedOpen(srv, bot);
      const v = V(first.body);
      const second = await flushedOpen(srv, bot, { cookie: `wqhc=${v}` });
      const third = await flushedOpen(srv, bot, { cookie: `a=1; wqhc=${v}; b=2` });
      expect(carried(first.early).length).toBe(7);
      expect(carried(second.early)).toEqual(carried(first.early));
      expect(carried(third.early)).toEqual(carried(first.early));
      expect(second.early).not.toMatch(CHECK);
      expect(second.body).toContain('(function(d,w,L,v){');
    });
  }

  test('OFF (home_inline without home_every): the cookie open is today\'s held page (nothing carried, the cache check)', async () => {
    const bot = fakeBot({ pages: [jsonRes(200, HUB()), hold({})] });
    srv = await start(build(bot.fetchImpl));
    const first = await get(srv, `/h/${TOKEN}`);
    const held = await flushedOpen(srv, bot, { cookie: `wqhc=${V(first.body)}` });
    expect(carried(held.early)).toEqual([]);
    expect(held.early).toMatch(CHECK);
  });

  test('ON then an answer without home_every (the switch turned off): the next cookie open is today\'s held page', async () => {
    const bot = fakeBot({ pages: [jsonRes(200, HUB(EVERY)), jsonRes(200, HUB()), hold({})] });
    srv = await start(build(bot.fetchImpl));
    const first = await get(srv, `/h/${TOKEN}`);
    await get(srv, `/h/${TOKEN}`, { cookie: `wqhc=${V(first.body)}` });
    const held = await flushedOpen(srv, bot, { cookie: `wqhc=${V(first.body)}` });
    expect(carried(held.early)).toEqual([]);
  });

  test('the portal\'s learner says home_every before any page: the first cookie open after a deploy carries the files', async () => {
    const edge = { learn: true, fast: true, brand: 'niete', rt: false, ui: { adv: true }, one_face: false, wait_ux: false, home_inline: true, home_v3: 1, home_every: true };
    const bot = fakeBot({ edge, pages: [hold(EVERY)] });
    srv = await start(build(bot.fetchImpl, { timers: { set: () => ({ unref() {} }), clear() {}, after: () => ({ unref() {} }), cancel() {} } }));
    await new Promise((r) => setTimeout(r, 20));
    const page = await flushedOpen(srv, bot, { cookie: `wqhc=${assetVersion()}` });
    expect(V(page.early)).toBe(assetVersion());
    expect(carried(page.early)).toEqual(expect.arrayContaining(['wq.css', 'wq-tel.js', 'wq-home.js', 'hub.js']));
    expect(page.early).not.toMatch(CHECK);
  });

  test('per child: a 2nd child on the same phone (same cookie) gets only their own name; the cache headers are today\'s', async () => {
    const bot = fakeBot({ pages: [jsonRes(200, HUB(EVERY)), hold(EVERY), hold({ ...EVERY, ...CHILD_B })] });
    srv = await start(build(bot.fetchImpl));
    const first = await get(srv, `/h/${TOKEN}`);
    const cookie = `wqhc=${V(first.body)}`;
    const a = await flushedOpen(srv, bot, { cookie });
    const b = await flushedOpen(srv, bot, { cookie, token: TOKEN_B });
    expect(carried(b.early).length).toBe(7);
    expect(a.body).toContain('Asad Testwala');
    expect(b.body).toContain('Bina Testwala');
    expect(b.body).not.toContain('Asad Testwala');
    expect(b.body).not.toContain(KID);
    for (const r of [a, b]) {
      expect(r.headers['cache-control']).toBe('no-cache');
      expect(r.headers.etag).toBeUndefined();
      expect(r.headers['last-modified']).toBeUndefined();
    }
  });

  test('a newer saved choice wins: the head guessed EN (an English phone), the answer says UR; the page ends in the answer\'s language exactly as today\'s held page', async () => {
    const run = async (extra) => {
      HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset();
      const bot = fakeBot({ pages: [jsonRes(200, HUB(extra)), hold({ ...extra, lang: 'ur' })] });
      const s = await start(build(bot.fetchImpl));
      try {
        const first = await get(s, `/h/${TOKEN}`, { lang: 'en-US' });
        return await flushedOpen(s, bot, { cookie: `wqhc=${V(first.body)}`, lang: 'en-US' });
      } finally { await new Promise((r) => s.close(r)); }
    };
    const today = await run({});
    const every = await run(EVERY);
    expect(carried(every.early).length).toBe(7);
    expect(bootLang(every.body)).toBe('ur');
    expect(fixOf(every.body)).not.toBe('');
    expect(fixOf(every.body)).toBe(fixOf(today.body));
    expect(every.early.match(/<html[^>]*>/)[0]).toBe(today.early.match(/<html[^>]*>/)[0]);
  });

  // The next stop drawn from the inline page is the hub answer's own, for the same open: no swap after paint.
  for (const lang of ['en', 'ur']) {
    test(`${lang}: the inline page's next === the hub answer's next, on a 1st open and on a cookie open`, async () => {
      const next = { kind: 'quiz', offer: 'Off3rT3st1', href: '/q/AB12CD', title: 'Plants', source: 'ranked', pos: 0 };
      const x = { lang, ...EVERY, next };
      const bot = fakeBot({ pages: [jsonRes(200, HUB(x)), hold(x), jsonRes(200, HUB(x))] });
      srv = await start(build(bot.fetchImpl));
      const first = await get(srv, `/h/${TOKEN}`);
      const again = await flushedOpen(srv, bot, { cookie: `wqhc=${V(first.body)}` });
      const hub = await get(srv, `/api/wq/hub/${TOKEN}`);
      const bootOf = (html) => JSON.parse(html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      expect(hub.status).toBe(200);
      expect(JSON.parse(hub.body).next).toEqual(next);
      expect(bootOf(first.body).next).toEqual(JSON.parse(hub.body).next);
      expect(bootOf(again.body).next).toEqual(JSON.parse(hub.body).next);
    });
  }
});
