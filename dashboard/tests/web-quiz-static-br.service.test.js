/**
 * The child pages' own files at /wq/* with the switch app_settings web_quiz_brotli on (its own switch, default OFF,
 * JSON true only, remembered 30 s, fail OFF; independent of web_quiz_fast): a versioned script or style (?v=<10 hex>) goes out brotli-compressed (quality 11, made once per file
 * in the background) to a phone that takes br; an unversioned file is kept a day, not a year (a redrawn Jugnu reaches
 * phones); the page shells name Jugnu's pictures with ?v=<hash of the picture>. Switch off: today's answers, byte for
 * byte and header for header, whatever web_quiz_fast says.
 *
 * The bot (a fake fetch) and the database (a fake client handed to the switch) are the boundaries. No first-party
 * module is mocked.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { createWebQuizRouter, renderHubPage, renderQuizPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const PUB = path.join(__dirname, '..', 'public', 'wq');
const AE = 'gzip, deflate, br';
const V = '0123456789';           // the edge's plain version form: 10 lower-hex
const GOLDEN = require('./web-quiz-static-br.golden.json');

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null, preview: false, brand: 'niete', rt: false, ...extra,
});

/** A bot that answers every hub and quiz call with `fast` as given. */
function bot(fast) {
  return (url) => Promise.resolve(String(url).includes('/hub/') ? jsonRes(200, HUB({ fast })) : jsonRes(200, QUIZ({ fast })));
}

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
/** brotliOn: the switch the router is handed (undefined = the process's own web_quiz_brotli switch). */
function build(fetchImpl, brotliOn) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...(brotliOn ? { brotliOn } : {}) }));
  return app;
}

/** A database client whose app_settings read answers `answer()` (or throws); counts the reads. */
function fakeDb(answer) {
  const calls = { n: 0, keys: [] };
  const client = {
    from: (table) => ({
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => { calls.n += 1; calls.keys.push(`${table}.${col}=${key}`); return answer(); },
        }),
      }),
    }),
  };
  return { db: () => client, calls };
}
const row = (value) => () => ({ data: { value }, error: null });
// Loaded inside the tests, so this file also runs (and shows what is missing) on code without the switch.
const Flag = () => require('../routes/web-quiz-brotli-flag');
/** The real switch over a fake database, its first read landed. */
async function primedFlag(answer, now) {
  const on = Flag().createBrotliFlag({ db: fakeDb(answer).db, ...(now ? { now } : {}) });
  on();
  await on.ready();
  return on;
}

/** GET (or HEAD) path; resolves with the status, headers, raw bytes and the decoded bytes. */
function get(srv, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        let body = raw;
        if (!raw.length) body = raw;
        else if (enc === 'br') body = zlib.brotliDecompressSync(raw);
        else if (enc === 'gzip') body = zlib.gunzipSync(raw);
        resolve({ status: res.statusCode, headers: res.headers, raw, body });
      });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}

/** Asks until the brotli copy is ready (the first asks fall through to the plain file while it is made). */
async function getBr(srv, p, headers = { 'accept-encoding': AE }) {
  for (let i = 0; i < 200; i += 1) {
    const res = await get(srv, p, headers);
    if (res.headers['content-encoding'] === 'br') return res;
    await new Promise((r) => setTimeout(r, 25));
  }
  return get(srv, p, headers);
}

const hash10 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUB, rel))).digest('hex').slice(0, 10);
/** Headers that do not depend on the clock or the checkout: what the golden compares. */
const stable = (h) => Object.fromEntries(Object.entries(h)
  .filter(([k]) => !['date', 'etag', 'last-modified', 'content-length', 'connection', 'keep-alive'].includes(k)));

let srv;
afterEach(() => new Promise((r) => (srv ? srv.close(() => { srv = null; r(); }) : r())));

/** The brotli switch on (web_quiz_fast off: the bot's payload says fast: false). */
async function brOn() {
  srv = await start(build(bot(false), () => true));
  await get(srv, `/h/${TOKEN}`);
  return srv;
}
/** Both switches on: web_quiz_fast (the bot's payload says fast: true; the edge remembers it) and web_quiz_brotli. */
async function bothOn() {
  srv = await start(build(bot(true), await primedFlag(row(true))));
  await get(srv, `/h/${TOKEN}`);
  return srv;
}

describe('switch on: versioned scripts and styles go out brotli-compressed', () => {
  test('(a) a phone sending "gzip, deflate, br" gets br: the exact file, a year, immutable, Vary', async () => {
    await brOn();
    const res = await getBr(srv, `/wq/wq.js?v=${V}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.headers['content-type']).toBe('application/javascript; charset=UTF-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers.etag).toMatch(/-br"$/);
    expect(Number(res.headers['content-length'])).toBe(res.raw.length);
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
    // smaller than the edge's gzip -9 of the same file
    expect(res.raw.length).toBeLessThan(zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq.js')), { level: 9 }).length);
  });

  test('a style too: text/css, the exact bytes; a repeat with the ETag is a 304', async () => {
    await brOn();
    const res = await getBr(srv, `/wq/wq.css?v=${V}`);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-type']).toBe('text/css; charset=UTF-8');
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.css')))).toBe(true);
    const again = await get(srv, `/wq/wq.css?v=${V}`, { 'accept-encoding': AE, 'if-none-match': res.headers.etag });
    expect(again.status).toBe(304);
    expect(again.raw.length).toBe(0);
    expect(again.headers.etag).toBe(res.headers.etag);
    expect(again.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // the plain file's ETag is not the br one's
    const plain = await get(srv, `/wq/wq.css?v=${V}`, { 'accept-encoding': 'gzip' });
    expect(plain.headers.etag).not.toBe(res.headers.etag);
  });

  test('(b) a hand-written "br, gzip" gets br too', async () => {
    await brOn();
    const res = await getBr(srv, `/wq/hub.js?v=${V}`, { 'accept-encoding': 'br, gzip' });
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'hub.js')))).toBe(true);
  });

  test('HEAD of a ready file: br headers, no body', async () => {
    await brOn();
    await getBr(srv, `/wq/wq-home.js?v=${V}`);
    const res = await get(srv, `/wq/wq-home.js?v=${V}`, { 'accept-encoding': AE }, 'HEAD');
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.raw.length).toBe(0);
  });

  test('(c) a gzip-only phone gets today\'s answer (the plain file, a year)', async () => {
    await brOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const res = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': 'gzip, deflate' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(stable(res.headers)).toEqual(GOLDEN['/wq/wq.js?v=0123456789']);
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
  });

  test('a picture or a version not in the plain form is not compressed here', async () => {
    await brOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const other = await get(srv, '/wq/wq.js?v=0123456789abcdef', { 'accept-encoding': AE });
    expect(other.headers['content-encoding']).toBeUndefined();
    const pic = await get(srv, `/wq/jugnu/hello.webp?v=${V}`, { 'accept-encoding': AE });
    expect(pic.headers['content-encoding']).toBeUndefined();
    expect(pic.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('(d) switch off: today\'s answers, byte for byte and header for header', () => {
  // The golden was captured from the code without this change. OFF with web_quiz_fast off, and OFF with it ON.
  const OFF = {
    'fast off, no row': async () => build(bot(false), await primedFlag(() => ({ data: null, error: null }))),
    'fast ON, no row': async () => build(bot(true), await primedFlag(() => ({ data: null, error: null }))),
    'fast ON, the process\'s own switch (no database here)': async () => build(bot(true)),
  };
  for (const [name, make] of Object.entries(OFF)) {
    for (const p of Object.keys(GOLDEN)) {
      test(`${name}: ${p}`, async () => {
        srv = await start(await make());
        await get(srv, `/h/${TOKEN}`);
        for (let i = 0; i < 3; i += 1) {
          const res = await get(srv, p, { 'accept-encoding': AE });
          expect(stable(res.headers)).toEqual(GOLDEN[p]);
          if (res.status === 200) {
            const file = path.join(PUB, p.replace(/^\/wq\//, '').replace(/\?.*$/, ''));
            expect(res.body.equals(fs.readFileSync(file))).toBe(true);
          }
          await new Promise((r) => setTimeout(r, 20));
        }
      });
    }
  }
});

describe('(e) switch on: only a versioned URL is kept for a year', () => {
  test('an unversioned picture: a day, not immutable', async () => {
    await brOn();
    for (const p of ['/wq/jugnu/hello.webp', '/wq/jugnu/correct.webp', '/wq/jugnu_sleep.webp', '/wq/manifest.webmanifest']) {
      const res = await get(srv, p, { 'accept-encoding': AE });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    }
  });
  test('a font whose name is its version stays immutable', async () => {
    await brOn();
    const res = await get(srv, '/wq/fonts/wq-nastaliq-6.woff2', { 'accept-encoding': AE });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
  test('a versioned picture keeps its year', async () => {
    await brOn();
    const res = await get(srv, `/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`, { 'accept-encoding': AE });
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('(f) a minified copy\'s URL (?v=<hex>m) is not this handler\'s', () => {
  test('passes to whatever serves it next (today: the plain file, a year)', async () => {
    await brOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const res = await get(srv, `/wq/wq.js?v=${V}m`, { 'accept-encoding': AE });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
  });
});

describe('(g) a path outside the folder or a missing file: today\'s 404', () => {
  test.each([`/wq/..%2fx.js?v=${V}`, `/wq/..%2f..%2fpackage.js?v=${V}`, `/wq/nope.js?v=${V}`, `/wq/%2e%2e%2findex.js?v=${V}`])('%s', async (p) => {
    await brOn();
    const first = await get(srv, p, { 'accept-encoding': AE });
    await new Promise((r) => setTimeout(r, 50));
    const res = await get(srv, p, { 'accept-encoding': AE });
    for (const r of [first, res]) {
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('(h) the page shells name Jugnu\'s pictures with their version, only with the switch on', () => {
  const HELLO = () => `/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`;
  test('the hub page (streamed and buffered) and the quiz page', async () => {
    await brOn();
    const streamed = await get(srv, `/h/${TOKEN}`, { 'accept-encoding': AE });
    expect(streamed.body.toString('utf8')).toContain(`src="${HELLO()}"`);
    expect(streamed.body.toString('utf8')).not.toContain('src="/wq/jugnu/hello.webp"');
    const plainStream = await get(srv, `/h/${TOKEN}`);
    expect(plainStream.body.toString('utf8')).toContain(`src="${HELLO()}"`);
    const buffered = await get(srv, `/h/${TOKEN}?nf=1`);
    expect(buffered.body.toString('utf8')).toContain(`src="${HELLO()}"`);
    const quiz = await get(srv, '/q/AB12CD?nf=1');
    expect(quiz.body.toString('utf8')).toContain(`src="${HELLO()}"`);
  });
  test('the closed page names the sleeping Jugnu with its version', async () => {
    await brOn();
    const res = await get(srv, '/h/not-a-token');
    expect(res.body.toString('utf8')).toContain(`src="/wq/jugnu_sleep.webp?v=${hash10('jugnu_sleep.webp')}"`);
  });
  test('switch off: the hub and quiz pages are today\'s render, byte for byte', async () => {
    srv = await start(build(bot(false), () => false));
    const hub = await get(srv, `/h/${TOKEN}`);
    const html = hub.body.toString('utf8');
    const assetV = html.match(/wq\.css\?v=([0-9a-f]+)/)[1];
    expect(html).toBe(renderHubPage({ payload: HUB({ fast: false }), token: TOKEN, origin: 'http://portal.example', assetV }));
    expect(html).toContain('src="/wq/jugnu/hello.webp"');
    const quiz = await get(srv, '/q/AB12CD');
    expect(quiz.body.toString('utf8')).toBe(renderQuizPage({ payload: QUIZ({ fast: false }), code: 'AB12CD', view: 'quiz', origin: 'http://portal.example', assetV, url: 'http://portal.example/q/AB12CD' }));
    const closed = await get(srv, '/h/not-a-token');
    expect(closed.body.toString('utf8')).toContain('src="/wq/jugnu_sleep.webp"');
  });
});

describe('the switch web_quiz_brotli: JSON true only, remembered 30 s, never read per request, fail OFF', () => {
  const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['1', 1],
    ['an object', { enabled: true }], ['false', false], ['null', null]];
  test.each(OFF_VALUES)('%s is OFF', async (_, value) => {
    expect((await primedFlag(row(value)))()).toBe(false);
  });
  test('no row, a read error, a throwing read, no database client: OFF', async () => {
    expect((await primedFlag(() => ({ data: null, error: null })))()).toBe(false);
    expect((await primedFlag(() => ({ data: null, error: { message: 'down' } })))()).toBe(false);
    expect((await primedFlag(() => { throw new Error('socket'); }))()).toBe(false);
    const none = Flag().createBrotliFlag({ db: () => null });
    none();
    await none.ready();
    expect(none()).toBe(false);
  });
  test('the JSON boolean true is ON; it reads its own key', async () => {
    const f = fakeDb(row(true));
    const on = Flag().createBrotliFlag({ db: f.db });
    expect(on()).toBe(false);          // the first answer never waits: OFF until the read lands
    await on.ready();
    expect(on()).toBe(true);
    expect(f.calls.keys).toEqual(['app_settings.key=web_quiz_brotli']);
    expect(Flag().KEY).toBe('web_quiz_brotli');
  });
  test('one read per 30 s, however many requests; none while one is in flight; a failed read is OFF for 30 s', async () => {
    let t = 1000;
    let answer = row(true);
    const f = fakeDb(() => answer());
    const on = Flag().createBrotliFlag({ db: f.db, now: () => t });
    for (let i = 0; i < 50; i += 1) on();   // 50 asks while the first read is in flight
    expect(f.calls.n).toBe(1);
    await on.ready();
    for (let i = 0; i < 500; i += 1) expect(on()).toBe(true);
    t += 29999;
    on();
    expect(f.calls.n).toBe(1);
    t += 1;
    answer = () => ({ data: null, error: { message: 'down' } });
    expect(on()).toBe(true);               // the stale value answers at once; the read goes in the background
    expect(f.calls.n).toBe(2);
    await on.ready();
    expect(on()).toBe(false);              // read error = OFF
    answer = row(true);
    t += 29999;
    expect(on()).toBe(false);
    expect(f.calls.n).toBe(2);
    t += 1;
    on();
    await on.ready();
    expect(f.calls.n).toBe(3);
    expect(on()).toBe(true);
  });
  test.each(OFF_VALUES.concat([['no row', undefined]]))('%s through the edge (web_quiz_fast ON): today\'s file and page', async (_, value) => {
    srv = await start(build(bot(true), await primedFlag(value === undefined ? () => ({ data: null, error: null }) : row(value))));
    await get(srv, `/h/${TOKEN}`);
    for (let i = 0; i < 5; i += 1) {
      const res = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': AE });
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(stable(res.headers)).toEqual(GOLDEN['/wq/wq.js?v=0123456789']);
      await new Promise((r) => setTimeout(r, 20));
    }
    const pic = await get(srv, '/wq/jugnu/hello.webp', { 'accept-encoding': AE });
    expect(stable(pic.headers)).toEqual(GOLDEN['/wq/jugnu/hello.webp']);
    const hub = await get(srv, `/h/${TOKEN}`, { 'accept-encoding': AE });
    expect(hub.body.toString('utf8')).toContain('src="/wq/jugnu/hello.webp"');
    expect(hub.body.toString('utf8')).not.toContain('hello.webp?v=');
  });
});

describe('both switches on (web_quiz_fast and web_quiz_brotli)', () => {
  const HELLO = () => `/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`;
  test('br scripts, a day for an unversioned picture, and the streamed fast page names Jugnu with its version', async () => {
    await bothOn();
    const js = await getBr(srv, `/wq/wq.js?v=${V}`);
    expect(js.headers['content-encoding']).toBe('br');
    expect(js.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
    const pic = await get(srv, '/wq/jugnu/hello.webp', { 'accept-encoding': AE });
    expect(pic.headers['cache-control']).toBe('public, max-age=86400');
    const page = await get(srv, `/h/${TOKEN}`, { 'accept-encoding': AE });
    expect(page.headers['content-encoding']).toBe('br');   // the fast page's own stream
    expect(page.body.toString('utf8')).toContain(`src="${HELLO()}"`);
    const quiz = await get(srv, '/q/AB12CD', { 'accept-encoding': AE });
    expect(quiz.body.toString('utf8')).toMatch(/<div class="wq-boot"><img src="\/wq\/jugnu\/hello\.webp\?v=[0-9a-f]{10}"/);
  });
  test('web_quiz_fast on alone (brotli off) is today\'s fast page: Jugnu without a version', async () => {
    srv = await start(build(bot(true), () => false));
    await get(srv, `/h/${TOKEN}`);
    const quiz = await get(srv, '/q/AB12CD', { 'accept-encoding': AE });
    expect(quiz.body.toString('utf8')).toMatch(/<div class="wq-boot"><img src="\/wq\/jugnu\/hello\.webp"/);
  });
});
