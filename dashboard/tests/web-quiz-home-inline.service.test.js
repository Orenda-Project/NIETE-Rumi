/**
 * The child home's first open on a phone in ONE response (app_settings web_quiz_home_inline, read by the bot in the hub's
 * one settings read; the hub JSON says `home_inline: true` only when it is on).
 *
 * With the fast first page (web_quiz_fast) GET /h/<t> sends the head before the bot's hub answer, and that head preloads
 * the home's files: on a phone that never held them, each is one more round trip after the head. ON, for a phone without
 * the `wqhc` cookie at this version, the page carries them: the stylesheets as <style>s (behind inert wq-src links),
 * the scripts as <script type="text/x-wq" src=…> blocks, run by the tail in today's deferred order; after the load the
 * page fetches each address once and sets the cookie, so the next open is today's page with cached files.
 * OFF (no `home_inline`): every page is today's, byte for byte (golden recorded on sandbox 6da831990 by this file with
 * RECORD=1 on the base, ?v= masked). ON with the cookie at this version: today's page too.
 *
 * The bot is the network boundary (a fake fetch; held answers released by hand). No first-party module is mocked.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
// Module state (each edge's learned head): reset between tests. Absent before this change: the ON rows then run red.
let HomeInline = null;
try { HomeInline = require('../routes/web-quiz-home-inline'); } catch (_) { HomeInline = null; }
let HomePre;
try { HomePre = require('../routes/web-quiz-home-preload'); } catch (_) { HomePre = { _reset() {} }; }
const GOLDEN_FILE = path.join(__dirname, 'fixtures', 'home-inline-off-golden.json');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const WQ = path.join(__dirname, '..', 'public', 'wq');

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// The hub answer as production sends it with its speed and look switches on (fast, home_pre, the v3 home, the adventure
// look, the designed wait, Jugnu's corner).
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true, home_pre: true,
  home_v3: true, adv: true, one_button: true, wait_ux: true, wait_hops: true, wait_home: true, play: { first: null },
  ui: extra.lang === 'ur' ? { ur2: true, adv: true } : { adv: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, ...extra });
const ON = { home_inline: true };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function get(srv, p, { onFirstChunk, onChunk, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(cookie ? { cookie } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
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

/** What the page sent while the bot had not answered yet (every chunk until 100 ms after the first), and the whole page. */
async function flushedOpen(srv, bot, opts = {}) {
  let answered = false; let answeredAtFirstChunk = null; let early = '';
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, `/h/${TOKEN}`, {
    ...opts,
    onChunk: (c) => { if (!answered) early += c; },
    onFirstChunk: () => { answeredAtFirstChunk = answered; setTimeout(answer, 100); },
  });
  clearTimeout(fallback);
  return { early, answeredAtFirstChunk, body: res.body };
}

const mask = (s) => s.replace(/\?v=[0-9a-f]{10}/g, '?v=V');
const V = (s) => s.match(/\/wq\/hub\.js\?v=([0-9a-f]{10})/)[1];
const reset = () => { if (HomeInline && HomeInline._resetAll) HomeInline._resetAll(); HomePre._reset(); };

/** The scenario the golden pins, per language: a teaching open, a flushed open, a locked one, one after. */
async function scenario(lang, extra) {
  const hub = () => jsonRes(200, HUB({ lang, ...extra }));
  const bot = heldBot([hub(), { hold: true, res: hub() }, jsonRes(200, LOCKED({ lang })), hub()]);
  const srv = await start(build(bot.fetchImpl));
  try {
    const first = await get(srv, `/h/${TOKEN}`);
    const flushed = await flushedOpen(srv, bot);
    const locked = await get(srv, `/h/${TOKEN}`);
    const after = await get(srv, `/h/${TOKEN}`);
    expect(flushed.answeredAtFirstChunk).toBe(false);
    return { first: mask(first.body), early: mask(flushed.early), flushed: mask(flushed.body), locked: mask(locked.body), after: mask(after.body) };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

/** The carried pieces of a page, in order: ['css', href] | ['js', href]. */
function carried(html) {
  const out = [];
  const rx = /<link rel="wq-src" href="([^"]+)"><style>|<script type="text\/x-wq" src="([^"]+)"/g;
  let m;
  while ((m = rx.exec(html))) out.push(m[1] ? ['css', m[1]] : ['js', m[2]]);
  return out;
}
/** The tail's run list (the addresses run, in order). */
const runList = (html) => JSON.parse(html.match(/\}\)\}\)\(document,window,(\[[^\]]*\]),"[0-9A-Za-z]+"\)<\/script>/)[1]);
const fileOf = (u) => u.split('?')[0].replace('/wq/', '');
// What a phone fetches from the network for this page's home (tags, preloads), as [kind, url].
function asks(html) {
  const out = [];
  const rx = /<link rel="stylesheet" href="([^"]+)">|<link rel="preload" href="([^"]+)" as="(script|style)"[^>]*>|<script src="([^"]+)"[^>]* defer><\/script>/g;
  let m;
  while ((m = rx.exec(html))) out.push(m[1] ? ['style', m[1]] : m[2] ? ['preload', m[2]] : ['script', m[4]]);
  return out.filter(([, u]) => /^\/wq\/[^/?]+\.(js|css)\?/.test(u));
}

describe('web_quiz_home_inline: the child home\'s first open carries its files', () => {
  let srv;
  beforeEach(() => reset());
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('OFF (no `home_inline`): the first, the flushed and a locked hub page are today\'s, byte for byte (golden), EN and UR', async () => {
    const got = {};
    for (const lang of ['en', 'ur']) { reset(); got[lang] = await scenario(lang, {}); }
    if (process.env.RECORD === '1') { fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(got, null, 1)}\n`); return; }
    expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')));
  });

  test('ON, a phone without the files: the head sent before the bot answers carries wq.css, the look\'s files, wq-tel, the home, the corner and hub.js; nothing is fetched for them', async () => {
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(ON)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`); // the answer that teaches this edge `fast`, the switch and the home's scripts
    const { early, answeredAtFirstChunk, body } = await flushedOpen(srv, bot);
    expect(answeredAtFirstChunk).toBe(false);
    expect(early).not.toMatch(/id="boot"/);
    const v = V(body);
    expect(carried(early).map(([k, u]) => [k, fileOf(u)])).toEqual([
      ['css', 'wq.css'], ['css', 'wq-adventure.css'], ['js', 'wq-adv.js'],
      ['js', 'wq-tel.js'], ['js', 'wq-home.js'], ['js', 'hub-play.js'], ['js', 'hub.js'],
    ]);
    // each block holds the file's own text (the stylesheet with its own addresses made absolute)
    const hubText = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
    expect(early).toContain(`<script type="text/x-wq" src="/wq/hub.js?v=${v}">${hubText}</script>`);
    const css = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
    expect(early).toContain(`<link rel="wq-src" href="/wq/wq.css?v=${v}"><style>${css.replace(/url\((["']?)fonts\//g, 'url($1/wq/fonts/')}</style>`);
    // the page asks the network for none of the home's files (no tag, no preload): only wq-doors.*, later, as today
    expect(asks(body)).toEqual([]);
    // the tail: the home's stylesheet in place, and every script run in today's deferred order
    expect(body).toContain(`<link rel="wq-src" href="/wq/wq-home.css?v=${v}"><style>`);
    expect(runList(body).map(fileOf)).toEqual(['wq-adv.js', 'wq-tel.js', 'wq-home.js', 'hub-play.js', 'hub.js']);
    // the runner is the page's last script, after the boot JSON and every inline piece of the tail
    expect(body.lastIndexOf('<script>')).toBe(body.indexOf(`<script>(function(d,w,L,v){`));
    expect(body.indexOf('id="boot"')).toBeLessThan(body.indexOf('(function(d,w,L,v){'));
    expect(body).toMatch(/<\/script>\n<\/body>\n<\/html>$/);
  });

  test('ON: the scripts ride after the frame (and the kept Home), so those paint once the styles are in', async () => {
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(ON)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { early } = await flushedOpen(srv, bot);
    expect(carried(early).length).toBe(7);
    const frame = early.indexOf('<main id="wq"');
    expect(frame).toBeGreaterThan(early.indexOf('</head>'));
    expect(early.indexOf('<link rel="wq-src" href="/wq/wq.css')).toBeLessThan(early.indexOf('</head>'));
    for (const [k, u] of carried(early)) if (k === 'js' && fileOf(u) !== 'wq-adv.js') expect([u, early.indexOf(`src="${u}"`) > frame]).toEqual([u, true]);
  });

  test('ON, the phone holds the files at this version (cookie wqhc=<v>): today\'s page, byte for byte but the switch\'s own key', async () => {
    const off = heldBot([jsonRes(200, HUB()), { hold: true, res: jsonRes(200, HUB()) }]);
    srv = await start(build(off.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const today = await flushedOpen(srv, off);
    await new Promise((r) => srv.close(r));
    reset();
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(ON)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const v = V(today.body);
    const held = await flushedOpen(srv, bot, { cookie: `a=1; wqhc=${v}; b=2` });
    expect(held.early).toBe(today.early);
    expect(held.body.replace(',"home_inline":true', '')).toBe(today.body);
  });

  test('ON, a cookie of another version (a deploy since) or of another shape: the files are carried', async () => {
    for (const cookie of ['wqhc=0000000000', 'wqhc=', 'xwqhc=V', 'wqhcx=1']) {
      reset();
      const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(ON)) }]);
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`);
      const { early } = await flushedOpen(srv, bot, { cookie: cookie.replace('V', '') });
      expect([cookie, carried(early).length]).toEqual([cookie, 7]);
      await new Promise((r) => srv.close(r)); srv = null;
    }
  });

  test('ON: after the load the page fetches each carried address once, then sets wqhc=<version> for /h (30 days)', async () => {
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(ON)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { body } = await flushedOpen(srv, bot);
    const go = body.slice(body.indexOf('<script>(function(d,w,L,v){'));
    expect(go).toContain('w.addEventListener("load"');
    expect(go).toContain('querySelectorAll(\'script[type="text/x-wq"],link[rel="wq-src"]\')');
    expect(go).toContain('d.cookie="wqhc="+v+"; Max-Age=2592000; Path=/h; SameSite=Lax"');
    expect(go).toContain(`,"${V(body)}")</script>`);
    // a script run from the page's text keeps its own attributes and names its address (data-src: wq-adv.js reads it)
    expect(go).toContain('s.setAttribute("data-src",L[i])');
    // every carried address answers 200 from this edge (what the after-load fetch fills the cache with)
    for (const [, u] of carried(body)) expect([u, (await get(srv, u)).status]).toEqual([u, 200]);
  });

  test('ON: a script this child\'s tail names that the last child\'s did not (keep my place, the preview) rides the tail, in its place in the order', async () => {
    const more = { ...ON, bind: { offer: false }, listen: true };
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB(more)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { early, body } = await flushedOpen(srv, bot);
    expect(carried(early).map(([, u]) => fileOf(u))).not.toContain('wq-bind.js');
    const tail = body.slice(early.length);
    expect(carried(tail).map(([k, u]) => [k, fileOf(u)])).toEqual([['css', 'wq-bind.css'], ['js', 'wq-bind.js'], ['css', 'wq-home.css'], ['js', 'wq-readalong-listen.js']]);
    expect(runList(body).map(fileOf)).toEqual(['wq-adv.js', 'wq-tel.js', 'wq-bind.js', 'wq-home.js', 'hub-play.js', 'wq-readalong-listen.js', 'hub.js']);
    expect(asks(body)).toEqual([]);
  });

  test('ON then an answer without it (the switch turned off): that page still runs what its head carried; the next head is today\'s', async () => {
    const bot = heldBot([jsonRes(200, HUB(ON)), { hold: true, res: jsonRes(200, HUB()) }, { hold: true, res: jsonRes(200, HUB()) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const one = await flushedOpen(srv, bot);
    expect(carried(one.early).length).toBe(7);
    expect(runList(one.body).map(fileOf)).toEqual(['wq-adv.js', 'wq-tel.js', 'wq-home.js', 'hub-play.js', 'hub.js']);
    const two = await flushedOpen(srv, bot);
    expect(carried(two.body)).toEqual([]);
    expect(two.body).not.toContain('(function(d,w,L,v){');
    expect(asks(two.early).map(([k, u]) => [k, fileOf(u)])).toContainEqual(['preload', 'hub.js']);
  });

  test('ON then a locked answer (the link on another phone): what was learned stays', async () => {
    // (the locked answer wears the same look, so the head's look guess is the same as before it)
    const bot = heldBot([jsonRes(200, HUB(ON)), jsonRes(200, LOCKED({ ...ON, adv: true, ui: { adv: true } })), { hold: true, res: jsonRes(200, HUB(ON)) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    await get(srv, `/h/${TOKEN}`);
    const { early } = await flushedOpen(srv, bot);
    expect(carried(early).map(([, u]) => fileOf(u))).toEqual(['wq.css', 'wq-adventure.css', 'wq-adv.js', 'wq-tel.js', 'wq-home.js', 'hub-play.js', 'hub.js']);
  });

  test('not with the fallback home (home_fb) nor the pack: those pages are the switch-off pages', async () => {
    for (const extra of [{ home_fb: true }, { pack: true }]) {
      reset();
      const off = heldBot([jsonRes(200, HUB(extra)), { hold: true, res: jsonRes(200, HUB(extra)) }]);
      srv = await start(build(off.fetchImpl));
      await get(srv, `/h/${TOKEN}`);
      const today = await flushedOpen(srv, off);
      await new Promise((r) => srv.close(r));
      reset();
      const bot = heldBot([jsonRes(200, HUB({ ...extra, ...ON })), { hold: true, res: jsonRes(200, HUB({ ...extra, ...ON })) }]);
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`);
      const on = await flushedOpen(srv, bot);
      expect([extra, on.early]).toEqual([extra, today.early]);
      expect([extra, on.body.replace(',"home_inline":true', '')]).toEqual([extra, today.body]);
      await new Promise((r) => srv.close(r)); srv = null;
    }
  });
});

describe('web-quiz-home-inline.js: what a carried file may hold', () => {
  const Inline = () => {
    if (!HomeInline) throw new Error('web-quiz-home-inline.js is missing');
    return HomeInline;
  };

  test('on(): JSON true with the v3 home only; not with home_fb or the pack; held() reads only wqhc at this version', () => {
    const { on, held } = Inline();
    expect(on({ home_inline: true, home_v3: true })).toBe(true);
    for (const p of [{ home_inline: 'true', home_v3: true }, { home_inline: 1, home_v3: true }, { home_inline: true }, { home_inline: true, home_v3: true, home_fb: true }, { home_inline: true, home_v3: true, pack: true }, null]) {
      expect([p, on(p)]).toEqual([p, false]);
    }
    expect(held({ headers: { cookie: 'wqhc=abc123' } }, 'abc123')).toBe(true);
    expect(held({ headers: { cookie: 'x=1; wqhc=abc123' } }, 'abc123')).toBe(true);
    for (const c of ['wqhc=abc12', 'wqhc=abc1234', 'xwqhc=abc123', '', undefined]) expect([c, held({ headers: { cookie: c } }, 'abc123')]).toEqual([c, false]);
  });

  test('nothing in a carried script can close its element or open a comment; a stylesheet\'s own relative addresses become /wq/ ones', () => {
    const files = {
      'a.js': 'var s = "</script><script>alert(1)</script>"; var t = "</SCRIPT"; /* <!-- x */',
      'a.css': '@font-face{src:url(fonts/x.woff2)}@font-face{src:url("fonts/y.woff2")}.a{background:url(/wq/jugnu/idle.webp)}.b{background:url("data:image/svg+xml,%3Csvg%3E")}.c{content:"</style>"}',
    };
    const c = Inline().create({ source: (f) => (Object.prototype.hasOwnProperty.call(files, f) ? files[f] : null) });
    const js = c.script('/wq/a.js?v=1');
    expect(js.match(/<\/script/gi)).toEqual(['</script']);
    expect(js).not.toContain('<!--');
    // the escaped text is the same program: \/ and \! are the characters themselves in a string or a comment
    const body = js.slice(js.indexOf('>') + 1, js.lastIndexOf('</script>'));
    // eslint-disable-next-line no-new-func
    expect(new Function(`${body}; return [s, t];`)()).toEqual(['</script><script>alert(1)</script>', '</SCRIPT']);
    const css = c.style('/wq/a.css?v=1');
    expect(css).toContain('url(/wq/fonts/x.woff2)');
    expect(css).toContain('url("/wq/fonts/y.woff2")');
    expect(css).toContain('url(/wq/jugnu/idle.webp)');
    expect(css).toContain('url("data:image/svg+xml,%3Csvg%3E")');
    expect(css.match(/<\/style/gi)).toEqual(['</style']);
    // an address outside /wq/, of another shape, or a missing file is never carried
    for (const h of ['/wq/../x.js?v=1', '/wq/a.js', '/x/a.js?v=1', '/wq/a.js?v=1&x=2', '/wq/none.js?v=1']) expect([h, c.script(h)]).toEqual([h, null]);
  });

  test('the files every child home carries have no element-closing or comment-opening text of their own (nothing is rewritten in them)', () => {
    for (const f of ['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'hub-play.js', 'wq-readalong-listen.js', 'hub.js', 'wq-adv.js']) {
      const s = fs.readFileSync(path.join(WQ, f), 'utf8');
      expect([f, /<\/script|<!--/i.test(s)]).toEqual([f, false]);
    }
  });
});
