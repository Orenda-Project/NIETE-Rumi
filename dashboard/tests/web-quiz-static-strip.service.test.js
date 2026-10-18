/**
 * The child pages' scripts served without their whole-line comments: app_settings web_quiz_wq_strip (default OFF,
 * JSON true only, remembered 30 s, fail OFF), on top of web_quiz_brotli (web-quiz-static.js). With both on, a
 * versioned script (/wq/<name>.js?v=<10 hex>) asked by a phone that takes br is compressed from its source with every
 * line that starts (after white space) with // removed; nothing else changes (styles, pictures, unversioned files,
 * a gzip-only phone, the ?v= hash, which stays the source file's).
 *
 * The proofs: the exact output for a fixture; every public/wq/*.js has no such line inside a string or template and
 * keeps the same tokens once stripped (the same program), passes `node --check`, and runs in the storybook pages' vm
 * harnesses (web-quiz-stories-client / web-quiz-readalong: their "served copy" rows); the gz bytes saved per file.
 * Switch off: today's answers (a golden captured from the code without this change).
 *
 * The database is a fake client handed to the switch; the bot a fake fetch. No first-party module is mocked.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { scanJs, commentLinesInsideLiterals } = require('./wq-js-tokens');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const AE = 'gzip, deflate, br';
const V = '0123456789';
const GOLDEN_FILE = path.join(__dirname, 'web-quiz-static-strip-off.golden.json');
const WRITE_GOLDEN = process.env.WQ_STRIP_WRITE_GOLDEN === '1';
const JS_FILES = fs.readdirSync(PUB).filter((n) => /\.js$/.test(n)).sort();
// Loaded inside the tests, so this file also runs (and shows what is missing) on code without the switch.
const Strip = () => require('../lib/wq-strip');
const Flag = () => require('../routes/web-quiz-strip-flag');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const src = (name) => fs.readFileSync(path.join(PUB, name));

// ---- servers ------------------------------------------------------------------------------------------------------
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const jsonRes = (status, body) => ({
  status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(body),
});
const bot = () => Promise.resolve(jsonRes(404, { error: 'not_found' }));
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function build({ brotliOn, stripOn, publicDir } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  if (publicDir) {
    // a folder of fixtures behind the same handler (the router serves the real folder only)
    const { createWqStatic } = require('../routes/web-quiz-static');
    app.use(createWqStatic({ publicDir, on: brotliOn, strip: stripOn }));
    app.use('/wq', express.static(publicDir, { maxAge: '1y', immutable: true }));
    return app;
  }
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot, ...(brotliOn ? { brotliOn } : {}), ...(stripOn ? { stripOn } : {}) }));
  return app;
}
function get(srv, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        let body = raw;
        if (raw.length && enc === 'br') body = zlib.brotliDecompressSync(raw);
        else if (raw.length && enc === 'gzip') body = zlib.gunzipSync(raw);
        resolve({ status: res.statusCode, headers: res.headers, raw, body });
      });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}
/** Asks until the br copy is ready (the first asks fall through to the plain file while it is made). */
async function getBr(srv, p, headers = { 'accept-encoding': AE }) {
  for (let i = 0; i < 200; i += 1) {
    const res = await get(srv, p, headers);
    if (res.headers['content-encoding'] === 'br') return res;
    await new Promise((r) => setTimeout(r, 25));
  }
  return get(srv, p, headers);
}
/** The database client whose app_settings read answers `answer()` (or throws). */
function fakeDb(answer) {
  const calls = { keys: [] };
  const client = { from: (t) => ({ select: () => ({ eq: (c, k) => ({ maybeSingle: async () => { calls.keys.push(`${t}.${c}=${k}`); return answer(); } }) }) }) };
  return { db: () => client, calls };
}
const row = (value) => () => ({ data: { value }, error: null });
async function primedStrip(answer) {
  const on = Flag().createStripFlag({ db: fakeDb(answer).db });
  on();
  await on.ready();
  return on;
}

let srv;
afterEach(() => new Promise((r) => (srv ? srv.close(() => { srv = null; r(); }) : r())));

// ---- the stripping itself -------------------------------------------------------------------------------------------
const FIXTURE = [
  '/*! keep me: the licence */',
  '// a whole-line comment',
  '(function () {',
  '  // an indented one',
  '  var url = \'http://x.test/a\'; // a trailing one stays',
  '  var t = `one ${1 + 1} two`;',
  '\t//a tabbed one',
  '  var r = /\\/\\/x/;',
  '  /* a block',
  '     // inside a block comment (dropped with no harm)',
  '  */',
  '  [1, 2].forEach(function () {});',
  '  var s = "// not a line comment";',
  '})();',
  '',
].join('\n');
const FIXTURE_OUT = [
  '/*! keep me: the licence */',
  '(function () {',
  '  var url = \'http://x.test/a\'; // a trailing one stays',
  '  var t = `one ${1 + 1} two`;',
  '  var r = /\\/\\/x/;',
  '  /* a block',
  '  */',
  '  [1, 2].forEach(function () {});',
  '  var s = "// not a line comment";',
  '})();',
  '',
].join('\n');

describe('the shared stripper (lib/wq-strip.js): only whole-line // comments go', () => {
  test('the exact output for a fixture (a Buffer in, a Buffer out; a string in, a string out)', () => {
    const { stripLineComments } = Strip();
    expect(stripLineComments(FIXTURE)).toBe(FIXTURE_OUT);
    const out = stripLineComments(Buffer.from(FIXTURE));
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString('utf8')).toBe(FIXTURE_OUT);
  });
  test('CRLF lines, a last line with no newline, a file with no comment (the same bytes)', () => {
    const { stripLineComments } = Strip();
    expect(stripLineComments('a();\r\n  // x\r\nb();\r\n')).toBe('a();\r\nb();\r\n');
    expect(stripLineComments('a();\n// last')).toBe('a();');
    const none = Buffer.from('a();\n/* b */\nc(); // d\n');
    expect(stripLineComments(none).equals(none)).toBe(true);
    expect(stripLineComments('')).toBe('');
  });
});

describe('every child-page script stays the same program once stripped', () => {
  test('the scanner finds a // line inside a template or a continued string (it can see the danger)', () => {
    expect(commentLinesInsideLiterals('var a = `x\n// in a template\n`;\n')).toEqual([2]);
    expect(commentLinesInsideLiterals('var a = "x\\\n// in a string";\n')).toEqual([2]);
    expect(commentLinesInsideLiterals('// a real one\nvar a = 1;\n')).toEqual([]);
  });
  test.each(JS_FILES)('%s: no whole-line // inside a string or template; the same tokens once stripped', (name) => {
    const s = src(name).toString('utf8');
    expect(commentLinesInsideLiterals(s)).toEqual([]);
    const out = Strip().stripLineComments(s);
    expect(scanJs(out).tokens).toEqual(scanJs(s).tokens);
    // nothing but whole-line comments went: the kept lines are the source's lines, in order
    expect(out.split('\n')).toEqual(s.split('\n').filter((l) => !/^\s*\/\//.test(l)));
  });
  test('every stripped script passes node --check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-strip-'));
    const bad = [];
    try {
      for (const name of JS_FILES) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, Strip().stripLineComments(src(name)));
        const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (r.status !== 0) bad.push(`${name}: ${r.stderr}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(bad).toEqual([]);
  });
  test('fewer gz bytes than the source, file by file (the table)', () => {
    const rows = JS_FILES.map((name) => {
      const s = src(name);
      const a = gz(s);
      const b = gz(Strip().stripLineComments(s));
      return { name, a, b, lines: s.toString('utf8').split('\n').filter((l) => /^\s*\/\//.test(l)).length };
    });
    const pad = (x, n) => String(x).padStart(n);
    const table = ['file                       source_gz stripped_gz saving  saving%  comment_lines']
      .concat(rows.map((r) => `${r.name.padEnd(26)} ${pad(r.a, 9)} ${pad(r.b, 11)} ${pad(r.a - r.b, 6)} ${pad(((100 * (r.a - r.b)) / r.a).toFixed(1), 7)}% ${pad(r.lines, 13)}`));
    const ta = rows.reduce((t, r) => t + r.a, 0);
    const tb = rows.reduce((t, r) => t + r.b, 0);
    table.push(`${'TOTAL'.padEnd(26)} ${pad(ta, 9)} ${pad(tb, 11)} ${pad(ta - tb, 6)} ${pad(((100 * (ta - tb)) / ta).toFixed(1), 7)}%`);
    console.log(`gzip -9 bytes, source vs served with web_quiz_wq_strip on:\n${table.join('\n')}`);
    if (process.env.WQ_STRIP_BYTES_OUT) fs.writeFileSync(process.env.WQ_STRIP_BYTES_OUT, `${table.join('\n')}\n`);
    rows.forEach((r) => {
      if (r.lines > 0) expect(r.b).toBeLessThan(r.a);
      else expect(r.b).toBe(r.a);
    });
    expect(tb).toBeLessThan(ta);
  });
});

// ---- through the edge ---------------------------------------------------------------------------------------------
const OFF_PATHS = ['/wq/wq.js?v=0123456789', '/wq/wq-stories.js?v=0123456789', '/wq/wq-stories-q.js?v=0123456789',
  '/wq/wq-readalong.js?v=0123456789', '/wq/wq.css?v=0123456789', '/wq/wq.js', '/wq/jugnu/hello.webp'];
const ENCODINGS = { raw: null, gzip: 'gzip, deflate', br: AE };
/**
 * What an answer is, minus what depends on the clock or the checkout (a static file's ETag carries its mtime), told
 * against the file on disk: 'source' = the file's own bytes / length / content ETag (so the golden survives an edit
 * of a script; any other body is its hash).
 */
function seen(res, p) {
  const file = fs.readFileSync(path.join(PUB, p.replace(/^\/wq\//, '').replace(/\?.*$/, '')));
  const h = { ...res.headers };
  ['date', 'last-modified', 'connection', 'keep-alive'].forEach((k) => delete h[k]);
  if (h['content-encoding'] !== 'br') {
    delete h.etag;
    if (h['content-length'] === String(file.length)) h['content-length'] = 'source';
  } else {
    delete h['content-length'];   // a br copy's length depends on the zlib build (checked against the bytes sent elsewhere)
    if (h.etag === `"${sha(file).slice(0, 16)}-br"`) h.etag = 'source-br';
  }
  return { status: res.status, headers: h, body: res.body.equals(file) ? 'source' : sha(res.body) };
}
async function observe(brotli) {
  const out = {};
  for (const p of OFF_PATHS) {
    for (const [enc, ae] of Object.entries(ENCODINGS)) {
      const headers = ae ? { 'accept-encoding': ae } : {};
      const res = brotli && enc === 'br' && /\?v=/.test(p) ? await getBr(srv, p, headers) : await get(srv, p, headers);
      out[`${p} ${enc}`] = seen(res, p);
    }
  }
  return out;
}

describe('switch off: today\'s answers, body and headers, raw / gzip / br', () => {
  test('web_quiz_wq_strip off (no row, false, the string "true") with web_quiz_brotli off and on: the golden', async () => {
    if (WRITE_GOLDEN) {
      // capture from the code without this change: no strip switch at all
      const golden = {};
      for (const brotli of [false, true]) {
        srv = await start(build({ brotliOn: () => brotli }));
        golden[brotli ? 'brotli_on' : 'brotli_off'] = await observe(brotli);
        await new Promise((r) => srv.close(r)); srv = null;
      }
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
      return;
    }
    const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    for (const answer of [() => ({ data: null, error: null }), row(false), row('true')]) {
      for (const brotli of [false, true]) {
        srv = await start(build({ brotliOn: () => brotli, stripOn: await primedStrip(answer) }));
        expect(await observe(brotli)).toEqual(GOLDEN[brotli ? 'brotli_on' : 'brotli_off']);
        await new Promise((r) => srv.close(r)); srv = null;
      }
    }
  });
});

describe('switch on (with web_quiz_brotli on): a versioned script goes out stripped', () => {
  test('a fixture folder: the exact stripped bytes, its own ETag and length, a 304 on that ETag, HEAD', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-strip-fx-'));
    try {
      fs.writeFileSync(path.join(dir, 'fx.js'), FIXTURE);
      srv = await start(build({ publicDir: dir, brotliOn: () => true, stripOn: () => true }));
      const res = await getBr(srv, `/wq/fx.js?v=${V}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.body.toString('utf8')).toBe(FIXTURE_OUT);
      expect(Number(res.headers['content-length'])).toBe(res.raw.length);
      expect(res.headers.etag).toBe(`"${sha(Buffer.from(FIXTURE_OUT)).slice(0, 16)}-sbr"`);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers['content-type']).toBe('application/javascript; charset=UTF-8');
      const again = await get(srv, `/wq/fx.js?v=${V}`, { 'accept-encoding': AE, 'if-none-match': res.headers.etag });
      expect(again.status).toBe(304);
      const head = await get(srv, `/wq/fx.js?v=${V}`, { 'accept-encoding': AE }, 'HEAD');
      expect(head.headers['content-length']).toBe(res.headers['content-length']);
      expect(head.raw.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the storybook scripts and wq.js through the router (the real switch, JSON true): stripped, decoded = the shared stripper\'s bytes', async () => {
    srv = await start(build({ brotliOn: () => true, stripOn: await primedStrip(row(true)) }));
    for (const name of ['wq-stories.js', 'wq-stories-q.js', 'wq-stories-d.js', 'wq-readalong.js', 'wq.js']) {
      const res = await getBr(srv, `/wq/${name}?v=${V}`);
      expect(res.headers['content-encoding']).toBe('br');
      const want = Strip().stripLineComments(src(name));
      expect(res.body.equals(want)).toBe(true);
      expect(res.body.length).toBeLessThan(src(name).length);
      expect(res.headers.etag).toBe(`"${sha(want).slice(0, 16)}-sbr"`);
      expect(Number(res.headers['content-length'])).toBe(res.raw.length);
    }
  });

  test('a style, a picture, an unversioned script and a gzip-only phone are untouched', async () => {
    const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')).brotli_on;
    srv = await start(build({ brotliOn: () => true, stripOn: await primedStrip(row(true)) }));
    await getBr(srv, `/wq/wq.js?v=${V}`);   // the stripped copy exists
    const css = await getBr(srv, `/wq/wq.css?v=${V}`);
    expect(css.body.equals(src('wq.css'))).toBe(true);
    expect(seen(css, '/wq/wq.css')).toEqual(GOLDEN['/wq/wq.css?v=0123456789 br']);
    for (const k of ['/wq/jugnu/hello.webp raw', '/wq/jugnu/hello.webp br', '/wq/wq.js br', '/wq/wq.js raw', '/wq/wq.js?v=0123456789 gzip', '/wq/wq.js?v=0123456789 raw']) {
      const [p, enc] = k.split(' ');
      const res = await get(srv, p, ENCODINGS[enc] ? { 'accept-encoding': ENCODINGS[enc] } : {});
      expect(seen(res, p)).toEqual(GOLDEN[k]);
    }
  });

  test('web_quiz_brotli off: the strip switch alone changes nothing (today\'s plain file)', async () => {
    const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')).brotli_off;
    srv = await start(build({ brotliOn: () => false, stripOn: await primedStrip(row(true)) }));
    const res = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': AE });
    expect(seen(res, '/wq/wq.js')).toEqual(GOLDEN['/wq/wq.js?v=0123456789 br']);
  });

  test('turned off again: back to the source bytes and today\'s ETag', async () => {
    let strip = true;
    srv = await start(build({ brotliOn: () => true, stripOn: () => strip }));
    const on = await getBr(srv, `/wq/wq.js?v=${V}`);
    expect(on.body.equals(Strip().stripLineComments(src('wq.js')))).toBe(true);
    strip = false;
    let off = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': AE });
    for (let i = 0; i < 200 && !(off.headers['content-encoding'] === 'br' && off.body.equals(src('wq.js'))); i += 1) {
      expect(off.body.equals(src('wq.js'))).toBe(true);   // the plain file while the source copy is made: never the stripped one
      await new Promise((r) => setTimeout(r, 25));
      off = await get(srv, `/wq/wq.js?v=${V}`, { 'accept-encoding': AE });
    }
    expect(off.body.equals(src('wq.js'))).toBe(true);
    expect(off.headers.etag).toBe(`"${sha(src('wq.js')).slice(0, 16)}-br"`);
  });
});

describe('the switch web_quiz_wq_strip: JSON true only, its own key, an outage is OFF and never a throw', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]])('%s is OFF', async (_, v) => {
    expect((await primedStrip(row(v)))()).toBe(false);
  });
  test('JSON true is ON; it reads web_quiz_wq_strip', async () => {
    const f = fakeDb(row(true));
    const on = Flag().createStripFlag({ db: f.db });
    expect(on()).toBe(false);
    await on.ready();
    expect(on()).toBe(true);
    expect(f.calls.keys).toEqual(['app_settings.key=web_quiz_wq_strip']);
    expect(Flag().KEY).toBe('web_quiz_wq_strip');
  });
  test('an outage (a read error, a throwing read, no client) is OFF; through the edge: today\'s source bytes', async () => {
    expect((await primedStrip(() => ({ data: null, error: { message: 'down' } })))()).toBe(false);
    expect((await primedStrip(() => { throw new Error('socket'); }))()).toBe(false);
    const none = Flag().createStripFlag({ db: () => null });
    none();
    await none.ready();
    expect(none()).toBe(false);
    srv = await start(build({ brotliOn: () => true, stripOn: await primedStrip(() => { throw new Error('socket'); }) }));
    const res = await getBr(srv, `/wq/wq-stories.js?v=${V}`);
    expect(res.body.equals(src('wq-stories.js'))).toBe(true);
    expect(res.headers.etag).toMatch(/[0-9a-f]{16}-br"$/);
  });
  test('a switch that throws when asked is OFF (the source bytes), never a failed answer', async () => {
    srv = await start(build({ brotliOn: () => true, stripOn: () => { throw new Error('boom'); } }));
    const res = await getBr(srv, `/wq/wq-stories-q.js?v=${V}`);
    expect(res.status).toBe(200);
    expect(res.body.equals(src('wq-stories-q.js'))).toBe(true);
  });
  test.each([['the string true', 'true'], ['1', 1], ['an object', { enabled: true }]])('a switch handed to the edge that answers %s (not the boolean true) is OFF', async (_, v) => {
    srv = await start(build({ brotliOn: () => true, stripOn: () => v }));
    const res = await getBr(srv, `/wq/wq-stories.js?v=${V}`);
    expect(res.body.equals(src('wq-stories.js'))).toBe(true);
    expect(res.headers.etag).toBe(`"${sha(src('wq-stories.js')).slice(0, 16)}-br"`);
  });
});
