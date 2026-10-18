/**
 * Minified page files (the bot's payload says `min: true` when app_settings web_quiz_minify is on).
 *
 * On: the pages link their JS/CSS at `?v=<hex>m`, and GET /wq/<file>?v=<hex>m answers that file minified at start-up
 * (esbuild), at its own immutable URL, with the static server's cache headers and an ETag. wq-tel.js stays raw (its
 * error columns are what our logs carry), and a file that does not minify is served raw. Off: every page is today's
 * render, byte for byte, linking `?v=<hex>`, and the files are today's bytes.
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage, renderHubPage, renderChallengePage, assetVersion } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const WQ = path.join(__dirname, '..', 'public', 'wq');
const ORIGIN = 'http://portal.example';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const MENU = {
  lang: 'en', form: 'G3',
  exercises: [{ id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: { correct: 7, n: 10 } }],
};

// Listening, then the minified copies made (the portal itself never waits for them: see 'start-up' below).
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); })
  .then((srv) => Promise.resolve(app.minReady).then(() => srv));

/** GET path; resolves with the status, headers and the body as raw bytes. */
function get(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8') }); });
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot answering each call with the next body in line. */
function bot(answers) {
  return (url) => Promise.resolve(answers.shift());
}

function build(fetchImpl, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...extra });
  app.use(router);
  app.minReady = router.minifyReady;
  return app;
}

/** An edge whose last quiz payload said `min: true` (the switch on, as this edge knows it). */
async function onEdge(extra = {}) {
  const srv = await start(build(bot([jsonRes(200, QUIZ({ min: true }))]), extra));
  await get(srv, '/q/AB12CD');
  return srv;
}
const raw = (f) => fs.readFileSync(path.join(WQ, f));
const fileV = (f) => crypto.createHash('sha256').update(raw(f)).digest('hex').slice(0, 10);
const HEX = assetVersion();
const compiles = (src) => { new vm.Script(src); return true; }; // eslint-disable-line no-new

describe('switch off (no `min` in the payload): today\'s pages and files', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('the quiz page and the hub are today\'s server render, byte for byte, at today\'s ?v=<hex>', async () => {
    srv = await start(build(bot([jsonRes(200, QUIZ()), jsonRes(200, QUIZ()), jsonRes(200, HUB()), jsonRes(200, HUB())])));
    await get(srv, '/q/AB12CD');
    const q = await get(srv, '/q/AB12CD');
    expect(q.status).toBe(200);
    expect(q.body).toBe(renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: HEX }));
    expect(q.body).toContain(`/wq/wq.js?v=${HEX}"`);
    await get(srv, `/h/${TOKEN}`);
    const h = await get(srv, `/h/${TOKEN}`);
    expect(h.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: ORIGIN, assetV: HEX }));
  });

  it('the challenge page is today\'s server render, byte for byte', async () => {
    srv = await start(build(bot([jsonRes(200, HUB()), jsonRes(200, MENU)])));
    await get(srv, `/h/${TOKEN}`);
    const c = await get(srv, `/c/${TOKEN}`);
    expect(c.status).toBe(200);
    expect(c.body).toBe(renderChallengePage({ menu: MENU, token: TOKEN, kid: null, origin: ORIGIN, assetV: HEX, chV: fileV('wq-challenge.js'), brandKey: 'niete' }));
  });

  it('/wq/wq.js?v=<hex> and /wq/wq.css?v=<hex> are the raw files, immutable for a year', async () => {
    srv = await start(build(bot([])));
    for (const f of ['wq.js', 'wq.css']) {
      const r = await get(srv, `/wq/${f}?v=${HEX}`);
      expect(r.status).toBe(200);
      expect(r.buf.equals(raw(f))).toBe(true);
      expect(r.headers['cache-control']).toMatch(/max-age=31536000/);
      expect(r.headers['cache-control']).toMatch(/immutable/);
    }
  });

  it('a ?v=<hex>m URL asked for while the switch is off (a page cached while it was on) answers the raw bytes, 200, not kept (no-cache)', async () => {
    srv = await start(build(bot([jsonRes(200, QUIZ())])));
    await get(srv, '/q/AB12CD');
    for (const f of ['wq.js', 'wq.css', 'hub.js', 'wq-tel.js']) {
      const r = await get(srv, `/wq/${f}?v=${HEX}m`);
      expect([f, r.status]).toEqual([f, 200]);
      expect([f, r.buf.equals(raw(f))]).toEqual([f, true]);
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('a fresh edge (no payload seen yet) answers ?v=<hex>m with the raw bytes too', async () => {
    srv = await start(build(bot([])));
    const r = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(r.status).toBe(200);
    expect(r.buf.equals(raw('wq.js'))).toBe(true);
    expect(r.headers['cache-control']).toBe('no-cache'); // this process has not seen min:true: not kept for a year
  });

  it('switched on, then off again: the same ?v=<hex>m URL answers raw once the edge learns it is off', async () => {
    srv = await start(build(bot([jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ())])));
    await get(srv, '/q/AB12CD');
    const on = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(on.buf.length).toBeLessThan(raw('wq.js').length);
    await get(srv, '/q/AB12CD');
    const off = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(off.buf.equals(raw('wq.js'))).toBe(true);
    expect(off.headers['cache-control']).toBe('no-cache');
  });
});

describe('switch on (`min: true` in the payload): minified files at their own URLs', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('the quiz page and the hub link ?v=<hex>m; otherwise byte for byte today\'s render at that version', async () => {
    srv = await start(build(bot([jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ({ min: true })), jsonRes(200, HUB({ min: true })), jsonRes(200, HUB({ min: true }))])));
    await get(srv, '/q/AB12CD'); // the page that teaches this edge the switch is on
    const q = await get(srv, '/q/AB12CD');
    expect(q.body).toContain(`/wq/wq.js?v=${HEX}m"`);
    expect(q.body).toContain(`/wq/wq.css?v=${HEX}m"`);
    expect(q.body).toBe(renderQuizPage({ payload: QUIZ({ min: true }), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: `${HEX}m` }));
    await get(srv, `/h/${TOKEN}`);
    const h = await get(srv, `/h/${TOKEN}`);
    expect(h.body).toContain(`/wq/hub.js?v=${HEX}m"`);
    expect(h.body).toBe(renderHubPage({ payload: HUB({ min: true }), token: TOKEN, origin: ORIGIN, assetV: `${HEX}m` }));
  });

  it('a switch turned off again returns the pages to the raw URLs (a real rollback)', async () => {
    srv = await start(build(bot([jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ()), jsonRes(200, QUIZ())])));
    await get(srv, '/q/AB12CD');
    await get(srv, '/q/AB12CD');
    const q = await get(srv, '/q/AB12CD');
    expect(q.body).toBe(renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: HEX }));
  });

  it('the challenge page (after a hub that said min) links its files at ?v=…m too', async () => {
    srv = await start(build(bot([jsonRes(200, HUB({ min: true })), jsonRes(200, MENU)])));
    await get(srv, `/h/${TOKEN}`);
    const c = await get(srv, `/c/${TOKEN}`);
    expect(c.status).toBe(200);
    expect(c.body).toContain(`/wq/wq.css?v=${HEX}m"`);
    expect(c.body).toContain(`/wq/wq-challenge.js?v=${fileV('wq-challenge.js')}m"`);
    expect(c.body).toContain(`/wq/wq-read-live.js?v=${fileV('wq-read-live.js')}m"`);
  });

  it('the challenge page\'s v2 scripts (finish card, trail) carry the m too; without it, today\'s URLs', () => {
    const menu = { ...MENU, v2: true, card_v3: true };
    const args = { menu, token: TOKEN, kid: null, origin: ORIGIN, assetV: HEX, chV: fileV('wq-challenge.js'), brandKey: 'niete' };
    const on = renderChallengePage({ ...args, sfx: 'm' });
    expect(on).toContain(`/wq/wq-finish-card.js?v=${fileV('wq-finish-card.js')}m"`);
    expect(on).toContain(`/wq/wq-trail.js?v=${fileV('wq-trail.js')}m"`);
    const off = renderChallengePage(args);
    expect(off).toContain(`/wq/wq-finish-card.js?v=${fileV('wq-finish-card.js')}"`);
    expect(off).not.toMatch(/\?v=[0-9a-f]+m"/);
  });

  it('GET /wq/wq.js?v=<hex>m: 200, smaller, still JavaScript that compiles, immutable for a year, with an ETag (304 on a repeat)', async () => {
    srv = await onEdge();
    const r = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(r.status).toBe(200);
    expect(r.buf.length).toBeLessThan(raw('wq.js').length);
    expect(compiles(r.body)).toBe(true);
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(r.headers['cache-control']).toMatch(/immutable/);
    expect(r.headers.etag).toBeTruthy();
    const again = await get(srv, `/wq/wq.js?v=${HEX}m`, { 'if-none-match': r.headers.etag });
    expect(again.status).toBe(304);
  });

  it('GET /wq/wq.css?v=<hex>m: 200, smaller, text/css, immutable for a year, 304 on its ETag', async () => {
    srv = await onEdge();
    const r = await get(srv, `/wq/wq.css?v=${HEX}m`);
    expect(r.status).toBe(200);
    expect(r.buf.length).toBeLessThan(raw('wq.css').length);
    expect(r.headers['content-type']).toMatch(/text\/css/);
    // Old engines: rgba() stays rgba(), never #rrggbbaa / #rgba.
    expect(r.body).not.toMatch(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{4}\b/);
    expect(r.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(r.headers['cache-control']).toMatch(/immutable/);
    const again = await get(srv, `/wq/wq.css?v=${HEX}m`, { 'if-none-match': r.headers.etag });
    expect(again.status).toBe(304);
  });

  it('every page script minifies to JavaScript that compiles (no file silently left raw)', async () => {
    srv = await onEdge();
    for (const f of fs.readdirSync(WQ).filter((n) => /\.js$/.test(n) && n !== 'wq-tel.js')) {
      const r = await get(srv, `/wq/${f}?v=${HEX}m`);
      expect([f, r.status]).toEqual([f, 200]);
      expect([f, r.buf.length < raw(f).length]).toEqual([f, true]);
      expect(compiles(r.body)).toBe(true);
      // The sources are ES5 for old phones: the minifier must not write newer syntax (`??`, `?.`, `=>`, template strings).
      expect([f, /\?\?|\?\.(?![0-9])|=>|`/.test(r.body)]).toEqual([f, false]);
    }
  });

  it('wq-tel.js?v=<hex>m is the raw file, byte for byte (its error columns stay ours)', async () => {
    srv = await onEdge();
    const r = await get(srv, `/wq/wq-tel.js?v=${HEX}m`);
    expect(r.status).toBe(200);
    expect(r.buf.equals(raw('wq-tel.js'))).toBe(true);
    expect(r.headers['cache-control']).toMatch(/immutable/);
  });

  it('Urdu text in a minified file stays literal UTF-8 (no \\u escapes)', async () => {
    srv = await onEdge();
    const r = await get(srv, `/wq/wq.js?v=${HEX}m`);
    const urdu = 'سب ہو گیا! آپ کے جواب اس فون پر محفوظ ہیں۔';
    expect(raw('wq.js').includes(Buffer.from(urdu, 'utf8'))).toBe(true);
    expect(r.buf.includes(Buffer.from(urdu, 'utf8'))).toBe(true);
    // The source writes a few \u06xx escapes itself (its Urdu-range regexes); the minifier adds none.
    const escapes = (s) => (s.match(/\\u06[0-9a-fA-F]{2}/g) || []).length;
    expect(escapes(r.body)).toBeLessThanOrEqual(escapes(raw('wq.js').toString('utf8')));
    expect(r.headers['content-type']).toMatch(/charset=utf-8/i);
  });

  it('a non-minified version (?v=<hex>) and images are untouched by the minified route', async () => {
    srv = await onEdge();
    const img = await get(srv, `/wq/jugnu_hello.webp?v=${HEX}m`);
    expect(img.status).toBe(200);
    expect(img.buf.equals(raw('jugnu_hello.webp'))).toBe(true);
  });
});

describe('a file that does not minify is served raw (publicDir: a test-only folder)', () => {
  let srv;
  let dir;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('200 with the raw bytes, no throw, exactly one log line; its neighbours still minify', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-min-'));
    const BAD = 'var broken = ;\n';
    const GOOD = '/* a comment */\nvar   longName   =   function ( a , b ) {\n  return a + b;\n};\n';
    fs.writeFileSync(path.join(dir, 'bad.js'), BAD);
    fs.writeFileSync(path.join(dir, 'good.js'), GOOD);
    fs.writeFileSync(path.join(dir, 'wq-tel.js'), GOOD);
    const lines = [];
    const logEvent = (e, p) => lines.push([e, p]);
    srv = await onEdge({ publicDir: dir, logEvent });
    const bad = await get(srv, '/wq/bad.js?v=abc123m');
    expect(bad.status).toBe(200);
    expect(bad.body).toBe(BAD);
    expect(bad.headers['cache-control']).toMatch(/immutable/);
    const good = await get(srv, '/wq/good.js?v=abc123m');
    expect(good.status).toBe(200);
    expect(good.buf.length).toBeLessThan(GOOD.length);
    const tel = await get(srv, '/wq/wq-tel.js?v=abc123m');
    expect(tel.body).toBe(GOOD);
    const minLines = lines.filter((l) => l[0] === 'web_quiz.minify_error');
    expect(minLines.length).toBe(1);
    expect(lines.filter((l) => l[0] !== 'web_quiz.bot_call')).toEqual(minLines);
    expect(lines[0][0]).toBe('web_quiz.minify_error');
    expect(lines[0][1].file).toBe('bad.js');
  });
});

describe('esbuild missing or broken: raw everywhere, quiet logs', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const ABS = '/srv/app/dashboard/routes/web-quiz.routes.js';
  const moduleMissing = () => {
    const e = new Error(`Cannot find module 'esbuild'\nRequire stack:\n- ${ABS}\n- /srv/app/dashboard/server.js`);
    e.code = 'MODULE_NOT_FOUND';
    e.requireStack = [ABS];
    return e;
  };

  it('esbuild not installed: no page links an m URL (page bytes = switch-off bytes), an m URL is raw and not kept, one quiet log line', async () => {
    let R;
    jest.isolateModules(() => {
      jest.doMock('esbuild', () => { throw moduleMissing(); });
      R = require('../routes/web-quiz.routes');
    });
    const lines = [];
    const app = express();
    app.set('trust proxy', 1);
    const router = R.createWebQuizRouter({ botUrl: BOT, apiKey: KEY, logEvent: (e, p) => lines.push([e, p]),
      fetchImpl: bot([jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ({ min: true })), jsonRes(200, HUB({ min: true })), jsonRes(200, HUB({ min: true }))]) });
    app.use(router);
    srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    await router.minifyReady;
    jest.dontMock('esbuild');
    await get(srv, '/q/AB12CD');
    const q = await get(srv, '/q/AB12CD');
    expect(q.body).toBe(R.renderQuizPage({ payload: QUIZ({ min: true }), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: R.assetVersion() }));
    expect(q.body).not.toMatch(/\?v=[0-9a-f]+m\b/);
    await get(srv, `/h/${TOKEN}`);
    const h = await get(srv, `/h/${TOKEN}`);
    expect(h.body).not.toMatch(/\?v=[0-9a-f]+m\b/);
    const r = await get(srv, `/wq/wq.js?v=${R.assetVersion()}m`);
    expect(r.buf.equals(raw('wq.js'))).toBe(true);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(lines.filter((l) => l[0] === 'web_quiz.minify_error').length).toBe(1);
  });

  it('esbuild present but its binary missing (every file fails the same way): one log line, not one per file', async () => {
    const lines = [];
    const esbuild = { transform: async () => { const e = new Error('The package "@esbuild/linux-x64" could not be found'); e.code = 'ENOENT'; throw e; } };
    srv = await onEdge({ esbuild, logEvent: (e, p) => lines.push([e, p]) });
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.filter((l) => l[0] === 'web_quiz.minify_error').length).toBe(1);
    const r = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(r.buf.equals(raw('wq.js'))).toBe(true);
  });

  it('the log line carries the error code and a short message, never a stack or an absolute path', async () => {
    const lines = [];
    const esbuild = { transform: async () => { throw moduleMissing(); } };
    srv = await onEdge({ esbuild, logEvent: (e, p) => lines.push([e, p]) });
    await new Promise((r) => setTimeout(r, 50));
    const l = lines.filter((x) => x[0] === 'web_quiz.minify_error');
    expect(l.length).toBe(1);
    expect(l[0][1].code).toBe('MODULE_NOT_FOUND');
    for (const v of Object.values(l[0][1])) {
      expect(String(v)).not.toMatch(/\//);
      expect(String(v)).not.toMatch(/Require stack/);
    }
  });
});

describe('start-up: the minifying never holds up the portal (esbuild: a test-only minifier that waits)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  /** esbuild's async transform, held until release(); transformSync is never called. */
  function heldEsbuild() {
    const real = require('esbuild');
    let release;
    const gate = new Promise((r) => { release = r; });
    return {
      esbuild: { transform: (src, o) => gate.then(() => real.transform(src, o)), transformSync: () => { throw new Error('sync minify at start-up'); } },
      release: () => release(),
    };
  }

  it('the router is made at once; until the copies are made the pages link the raw files and ?v=<hex>m answers raw, not kept', async () => {
    const held = heldEsbuild();
    const app = express();
    const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot([jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ({ min: true })), jsonRes(200, QUIZ({ min: true }))]), esbuild: held.esbuild });
    app.set('trust proxy', 1);
    app.use(router);
    srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    await get(srv, '/q/AB12CD');
    const q = await get(srv, '/q/AB12CD');
    expect(q.status).toBe(200);
    expect(q.body).toBe(renderQuizPage({ payload: QUIZ({ min: true }), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: HEX }));
    const early = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(early.status).toBe(200);
    expect(early.buf.equals(raw('wq.js'))).toBe(true);
    expect(early.headers['cache-control']).toBe('no-cache');
    held.release();
    await router.minifyReady;
    const later = await get(srv, '/q/AB12CD');
    expect(later.body).toContain(`/wq/wq.js?v=${HEX}m"`);
    const min = await get(srv, `/wq/wq.js?v=${HEX}m`);
    expect(min.buf.length).toBeLessThan(raw('wq.js').length);
    expect(min.headers['cache-control']).toMatch(/immutable/);
  });

  it('an encoded path outside the folder, asked for before the copies are made, is never served', async () => {
    const held = heldEsbuild();
    const app = express();
    const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot([jsonRes(200, QUIZ({ min: true }))]), esbuild: held.esbuild });
    app.use(router);
    srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    await get(srv, '/q/AB12CD');
    const r = await get(srv, `/wq/..%2F..%2Fpackage.json?v=${HEX}m`);
    expect(r.status).not.toBe(200);
    expect(r.body).not.toMatch(/"dependencies"/);
    held.release();
    await router.minifyReady;
  });
});

// The size table for the report (printed, never asserted): raw vs minified, and each gzipped.
describe('bytes', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  it('raw vs minified (and gzip -9 of each)', async () => {
    srv = await onEdge();
    const rows = [];
    for (const f of fs.readdirSync(WQ).filter((n) => /\.(js|css)$/.test(n)).sort()) {
      const r = await get(srv, `/wq/${f}?v=${HEX}m`);
      const a = raw(f);
      rows.push([f, a.length, r.buf.length, zlib.gzipSync(a, { level: 9 }).length, zlib.gzipSync(r.buf, { level: 9 }).length].join('\t'));
    }
    if (process.env.WQ_MIN_TABLE) fs.writeFileSync(process.env.WQ_MIN_TABLE, `file\traw\tmin\traw_gz\tmin_gz\n${rows.join('\n')}\n`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
