/**
 * The child pages' own files at /wq/* with the fast switch on (app_settings web_quiz_fast; the bot's payload says
 * `fast: true`): a versioned script or style (?v=<10 hex>) goes out brotli-compressed (quality 11, made once per file
 * in the background) to a phone that takes br; an unversioned file is kept a day, not a year (a redrawn Jugnu reaches
 * phones); the page shells name Jugnu's pictures with ?v=<hash of the picture>. Switch off: today's answers, byte for
 * byte and header for header.
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
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
function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  return app;
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

async function fastOn() {
  srv = await start(build(bot(true)));
  await get(srv, `/h/${TOKEN}`);   // the bot's payload says fast: true; the edge remembers it
  return srv;
}

describe('fast on: versioned scripts and styles go out brotli-compressed', () => {
  test('(a) a phone sending "gzip, deflate, br" gets br: the exact file, a year, immutable, Vary', async () => {
    await fastOn();
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
    await fastOn();
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
    await fastOn();
    const res = await getBr(srv, `/wq/hub.js?v=${V}`, { 'accept-encoding': 'br, gzip' });
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'hub.js')))).toBe(true);
  });

  test('HEAD of a ready file: br headers, no body', async () => {
    await fastOn();
    await getBr(srv, `/wq/wq-home.js?v=${V}`);
    const res = await get(srv, `/wq/wq-home.js?v=${V}`, { 'accept-encoding': AE }, 'HEAD');
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.raw.length).toBe(0);
  });

  test('(c) a gzip-only phone gets today\'s answer (the plain file, a year)', async () => {
    await fastOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const res = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': 'gzip, deflate' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(stable(res.headers)).toEqual(GOLDEN['/wq/wq.js?v=0123456789']);
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
  });

  test('a picture or a version not in the plain form is not compressed here', async () => {
    await fastOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const other = await get(srv, '/wq/wq.js?v=0123456789abcdef', { 'accept-encoding': AE });
    expect(other.headers['content-encoding']).toBeUndefined();
    const pic = await get(srv, `/wq/jugnu/hello.webp?v=${V}`, { 'accept-encoding': AE });
    expect(pic.headers['content-encoding']).toBeUndefined();
    expect(pic.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('(d) fast off: today\'s answers, byte for byte and header for header', () => {
  for (const p of Object.keys(GOLDEN)) {
    test(p, async () => {
      srv = await start(build(bot(false)));
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
});

describe('(e) fast on: only a versioned URL is kept for a year', () => {
  test('an unversioned picture: a day, not immutable', async () => {
    await fastOn();
    for (const p of ['/wq/jugnu/hello.webp', '/wq/jugnu/correct.webp', '/wq/jugnu_sleep.webp', '/wq/manifest.webmanifest']) {
      const res = await get(srv, p, { 'accept-encoding': AE });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    }
  });
  test('a font whose name is its version stays immutable', async () => {
    await fastOn();
    const res = await get(srv, '/wq/fonts/wq-nastaliq-6.woff2', { 'accept-encoding': AE });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
  test('a versioned picture keeps its year', async () => {
    await fastOn();
    const res = await get(srv, `/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`, { 'accept-encoding': AE });
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('(f) a minified copy\'s URL (?v=<hex>m) is not this handler\'s', () => {
  test('passes to whatever serves it next (today: the plain file, a year)', async () => {
    await fastOn();
    await getBr(srv, `/wq/wq.js?v=${V}`);
    const res = await get(srv, `/wq/wq.js?v=${V}m`, { 'accept-encoding': AE });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body.equals(fs.readFileSync(path.join(PUB, 'wq.js')))).toBe(true);
  });
});

describe('(g) a path outside the folder or a missing file: today\'s 404', () => {
  test.each([`/wq/..%2fx.js?v=${V}`, `/wq/..%2f..%2fpackage.js?v=${V}`, `/wq/nope.js?v=${V}`, `/wq/%2e%2e%2findex.js?v=${V}`])('%s', async (p) => {
    await fastOn();
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

describe('(h) the page shells name Jugnu\'s pictures with their version, only with fast on', () => {
  const HELLO = () => `/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`;
  test('the hub page (streamed and buffered) and the quiz page', async () => {
    await fastOn();
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
    await fastOn();
    const res = await get(srv, '/h/not-a-token');
    expect(res.body.toString('utf8')).toContain(`src="/wq/jugnu_sleep.webp?v=${hash10('jugnu_sleep.webp')}"`);
  });
  test('fast off: the hub and quiz pages are today\'s render, byte for byte', async () => {
    srv = await start(build(bot(false)));
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
