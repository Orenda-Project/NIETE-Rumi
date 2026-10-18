/**
 * The child home starts its scripts and styles while the server answers (app_settings web_quiz_home_preload, read by the
 * bot in the hub's one settings read; the hub JSON says `home_pre: true` only when it is on).
 *
 * With the fast first page (web_quiz_fast), GET /h/<t> sends the head before the bot's hub answer; today the home's own
 * files (wq-bind.*, wq-home.*, hub-play.js, the read-along preview, and wq-doors.* that wq-home.js loads) are asked for
 * only after that answer, one more round trip on a slow phone. ON: the flushed head preloads the ones EVERY child home
 * asks for (wq-home.*, wq-doors.*), at the EXACT address the page asks for later (same path, same ?v=, no
 * crossorigin), so each file is fetched once. The head goes before the answer is known, so it follows the last hub
 * answer this edge saw (as the fast page follows `fast`); the files that differ per child (keep my place, Jugnu's
 * corner, the read-along preview) stay in the tail, so the next child's head never preloads a file its page skips.
 * OFF (no `home_pre`): every page is today's, byte for byte (golden recorded on sandbox 42758fd4d, ?v= masked).
 *
 * The bot is the network boundary (a fake fetch; held answers released by hand). No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
// The edge's learned list (module state): reset between tests. (Absent before this change: the ON rows then run red.)
let HomePre;
try { HomePre = require('../routes/web-quiz-home-preload'); } catch (_) { HomePre = { _reset() {} }; }
const GOLDEN = require('./fixtures/home-preload-off-golden.json');

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

// The hub answer as sandbox sends it today (fast, the v3 home, keep my place, Jugnu's corner, the read-along preview).
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true,
  home_v3: 1, bind: { offer: false }, play: { first: null }, listen: true,
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function get(srv, path, { onFirstChunk } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example' } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot whose hub answers come in order; a { hold: true, res } one waits for release(). */
function heldBot(answers) {
  let held = [];
  const fetchImpl = () => {
    const body = answers.shift();
    if (body && body.hold) return new Promise((r) => held.push(() => r(body.res)));
    return Promise.resolve(body && body.res ? body.res : body);
  };
  return { fetchImpl, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}

function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  return app;
}

/** The page's first chunk while the bot has not answered yet, and the whole page. */
async function flushedOpen(srv, bot) {
  let answered = false; let answeredAtFirstChunk = null; let early = null;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, `/h/${TOKEN}`, { onFirstChunk: (c) => { early = c; answeredAtFirstChunk = answered; answer(); } });
  clearTimeout(fallback);
  return { early, answeredAtFirstChunk, body: res.body };
}

const mask = (s) => s.replace(/\?v=[0-9a-f]{10}/g, '?v=V');
const V = (s) => s.match(/\/wq\/hub\.js\?v=([0-9a-f]{10})/)[1];

/**
 * The /wq/ scripts and styles a phone asks for on this page, in order, as [kind, url]: the head's and the tail's tags,
 * then what wq-home.js's loadOnce adds once the home is drawn (wq-doors.css/.js at hub.js's own ?v=, as hub.js and
 * wq-home.js build it from `script[src*="/wq/hub.js"]`).
 */
function asks(html) {
  const out = [];
  const rx = /<link rel="stylesheet" href="([^"]+)">|<link rel="preload" href="([^"]+)" as="(script|style)"( crossorigin)?>|<script src="([^"]+)" defer><\/script>/g;
  let m;
  while ((m = rx.exec(html))) {
    if (m[1]) out.push(['style', m[1]]);
    else if (m[2]) out.push([`preload-${m[3]}${m[4] ? '-cors' : ''}`, m[2]]);
    else out.push(['script', m[5]]);
  }
  if (/"home_v3":1/.test(html)) {
    const v = `?v=${V(html)}`;
    out.push(['style', `/wq/wq-doors.css${v}`], ['script', `/wq/wq-doors.js${v}`]);
  }
  return out.filter(([, u]) => /^\/wq\/[^/?]+\.(js|css)\?/.test(u));
}
// The files every child home asks for (preloaded), and the tail files that differ per child or phone (never preloaded).
const SHARED = ['wq-home.css', 'wq-home.js', 'wq-doors.css', 'wq-doors.js'];
const PER_CHILD = ['wq-bind.css', 'wq-bind.js', 'hub-play.js', 'wq-readalong-listen.js'];
const fileOf = (u) => u.split('?')[0].replace('/wq/', '');

describe('web_quiz_home_preload: the child home\'s files start in the flushed head', () => {
  let srv;
  beforeEach(() => HomePre._reset());
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('OFF (no `home_pre`): the first, the flushed and a locked hub page are today\'s, byte for byte (golden), EN and UR', async () => {
    for (const lang of ['en', 'ur']) {
      HomePre._reset();
      const ui = lang === 'ur' ? { ur2: true } : undefined;
      const bot = heldBot([jsonRes(200, HUB({ lang, ui })), { hold: true, res: jsonRes(200, HUB({ lang, ui })) }, jsonRes(200, LOCKED({ lang })), jsonRes(200, HUB({ lang, ui }))]);
      srv = await start(build(bot.fetchImpl));
      const first = await get(srv, `/h/${TOKEN}`);
      const flushed = await flushedOpen(srv, bot);
      const locked = await get(srv, `/h/${TOKEN}`);
      const after = await get(srv, `/h/${TOKEN}`);
      expect(flushed.answeredAtFirstChunk).toBe(false);
      expect({ first: mask(first.body), early: mask(flushed.early), flushed: mask(flushed.body), locked: mask(locked.body), after: mask(after.body) }).toEqual(GOLDEN[lang]);
      await new Promise((r) => srv.close(r)); srv = null;
    }
  });

  test('ON: the head sent before the bot answers preloads every shared home file; each file is asked for at ONE address (once)', async () => {
    const bot = heldBot([jsonRes(200, HUB({ home_pre: true })), { hold: true, res: jsonRes(200, HUB({ home_pre: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`); // the answer that teaches this edge `fast` and the home's files
    const { early, answeredAtFirstChunk, body } = await flushedOpen(srv, bot);
    expect(answeredAtFirstChunk).toBe(false);
    expect(early).not.toMatch(/id="boot"/);
    const head = asks(early.replace(/"home_v3":1/g, ''));
    const all = asks(body);
    // every shared home file is preloaded in the early head, with the `as` its later tag needs and no crossorigin
    for (const f of SHARED) {
      const pre = head.filter(([k, u]) => k.startsWith('preload') && fileOf(u) === f);
      expect([f, pre.length]).toEqual([f, 1]);
      expect(pre[0][0]).toBe(f.endsWith('.css') ? 'preload-style' : 'preload-script');
    }
    // the per-child tail files are not (they stay the tail's own ask, as today)
    for (const f of PER_CHILD) expect([f, head.filter(([, u]) => fileOf(u) === f).length]).toEqual([f, 0]);
    // the request list: each /wq/ file of the page under exactly one address (a preload is used, never a second fetch)
    const byFile = {};
    for (const [, u] of all) (byFile[fileOf(u)] = byFile[fileOf(u)] || new Set()).add(u);
    for (const f of ['wq.css', 'wq-tel.js', 'hub.js', ...SHARED, ...PER_CHILD]) expect([f, [...(byFile[f] || [])].length]).toEqual([f, 1]);
    // each preload names exactly the address of a later tag or of wq-home.js's own ask (preload ⊆ used)
    const used = new Set(all.filter(([k]) => !k.startsWith('preload')).map(([, u]) => u));
    for (const [k, u] of all) if (k.startsWith('preload')) expect([u, used.has(u)]).toEqual([u, true]);
    // one ?v= for the hub's files in the head and the tail (the head/tail version race would preload twice)
    expect(new Set(all.filter(([, u]) => fileOf(u) !== 'wq-readalong-listen.js').map(([, u]) => u.split('?v=')[1])).size).toBe(1);
  });

  test('ON: the preloads sit in the head, after the page\'s stylesheet (its first paint) and before </head>', async () => {
    const bot = heldBot([jsonRes(200, HUB({ home_pre: true })), jsonRes(200, HUB({ home_pre: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { body } = await flushedOpen(srv, bot);
    const headEnd = body.indexOf('</head>');
    const home = body.indexOf('<link rel="preload" href="/wq/wq-home.js');
    expect(home).toBeGreaterThan(body.indexOf('<link rel="stylesheet" href="/wq/wq.css'));
    expect(home).toBeLessThan(headEnd);
    expect(body.indexOf('<link rel="preload" href="/wq/wq-doors.js')).toBeLessThan(headEnd);
  });

  test('ON, the fallback home (home_fb: wq-home.js is a preload in the tail): the head names the same address, once', async () => {
    const bot = heldBot([jsonRes(200, HUB({ home_pre: true, home_fb: true })), jsonRes(200, HUB({ home_pre: true, home_fb: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { body } = await flushedOpen(srv, bot);
    const homes = asks(body).filter(([, u]) => fileOf(u) === 'wq-home.js');
    expect(new Set(homes.map(([, u]) => u)).size).toBe(1);
    expect(homes.map(([k]) => k)).toEqual(['preload-script', 'preload-script']);
  });

  test('ON: only what the last child\'s page used (no bind, no corner, no preview → none of theirs)', async () => {
    const plain = { home_pre: true, bind: undefined, play: undefined, listen: undefined };
    const bot = heldBot([jsonRes(200, HUB(plain)), jsonRes(200, HUB(plain))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { early } = await flushedOpen(srv, bot);
    const pre = asks(early).filter(([k]) => k.startsWith('preload')).map(([, u]) => fileOf(u));
    expect(pre).toEqual(['wq-home.css', 'wq-home.js', 'wq-doors.css', 'wq-doors.js', 'wq-tel.js', 'hub.js']);
  });

  test('bounded to the shared set: a child whose page had keep my place, Jugnu\'s corner and the preview → the next child\'s head preloads only files that child\'s page uses', async () => {
    const plain = { home_pre: true, kid: 'fedcba9876543210', bind: undefined, play: undefined, listen: undefined };
    const bot = heldBot([jsonRes(200, HUB({ home_pre: true })), { hold: true, res: jsonRes(200, HUB(plain)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`); // the last child: bind, play and listen on their page
    const { early, body } = await flushedOpen(srv, bot); // the next child: none of them
    expect(asks(early).filter(([k]) => k.startsWith('preload')).map(([, u]) => fileOf(u))).toEqual([...SHARED, 'wq-tel.js', 'hub.js']);
    const all = asks(body);
    const used = new Set(all.filter(([k]) => !k.startsWith('preload')).map(([, u]) => u));
    for (const [k, u] of all) if (k.startsWith('preload')) expect([u, used.has(u)]).toEqual([u, true]);
  });

  test('bounded to the shared set: any other tag on a child\'s page (or a per-child file) is never learned', () => {
    const v = 'a474683122';
    const tags = [
      `<link rel="stylesheet" href="/wq/wq-bind.css?v=${v}">`, `<script src="/wq/wq-bind.js?v=${v}" defer></script>`,
      `<link rel="stylesheet" href="/wq/wq-home.css?v=${v}">`, `<script src="/wq/wq-home.js?v=${v}" defer></script>`,
      `<link rel="stylesheet" href="/wq/wq-extra.css?v=${v}">`, `<script src="/wq/hub-play.js?v=${v}" defer></script>`,
      `<script src="/wq/wq-readalong-listen.js?v=8f48545243" defer></script>`,
    ].join('\n');
    HomePre.learn({ home_pre: true, kid: KID, kids: [], home_v3: 1 }, tags, v);
    const pre = (HomePre.head().match(/href="[^"]+"/g) || []).map((h) => fileOf(h.slice(6, -1)));
    expect(pre).toEqual(SHARED);
  });

  test('a locked answer (another phone) keeps what the edge learned; an answer without `home_pre` forgets it (flip OFF: one open later)', async () => {
    const bot = heldBot([
      jsonRes(200, HUB({ home_pre: true })),
      jsonRes(200, LOCKED({ home_pre: true })),
      jsonRes(200, HUB({ home_pre: true })), // flushed, after the locked one: still preloads
      jsonRes(200, HUB()), // the switch went OFF
      jsonRes(200, HUB()), // flushed: today's head
    ]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    await get(srv, `/h/${TOKEN}`);
    const kept = await get(srv, `/h/${TOKEN}`);
    expect(kept.body).toMatch(/<link rel="preload" href="\/wq\/wq-home\.js\?v=[0-9a-f]{10}" as="script">/);
    await get(srv, `/h/${TOKEN}`);
    const off = await get(srv, `/h/${TOKEN}`);
    expect(off.body).not.toMatch(/rel="preload" href="\/wq\/wq-(home|doors|bind)/);
    expect(mask(off.body)).toBe(GOLDEN.en.after);
  });

  test('a fresh edge whose first answer is locked learns no files (nothing to preload yet)', async () => {
    const bot = heldBot([jsonRes(200, LOCKED({ home_pre: true })), jsonRes(200, LOCKED({ home_pre: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(res.body).not.toMatch(/rel="preload" href="\/wq\/wq-(home|doors|bind)/);
  });

  test('the unflushed page (no `fast` learned yet) is the same page with or without the switch, apart from the boot JSON\'s key', async () => {
    const bot = heldBot([jsonRes(200, HUB({ home_pre: true, fast: undefined }))]);
    srv = await start(build(bot.fetchImpl));
    const on = await get(srv, `/h/${TOKEN}`);
    expect(mask(on.body).replace(',"home_pre":true', '').replace(',"fast":true', '')).toBe(GOLDEN.en.first.replace(',"fast":true', ''));
  });
});
