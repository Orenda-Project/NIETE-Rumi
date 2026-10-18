/**
 * The child pages' own files at /wq/* with the switch app_settings web_quiz_brotli on (web-quiz-brotli-flag.js: default
 * OFF, JSON true only, remembered 30 s, never read per request, fail OFF). Mounted once at the top of the web quiz router, so it runs before every route and the static server.
 *
 *   1. A versioned script or style (/wq/<name>.js|.css?v=<10 lower-hex>, the edge's plain asset version) goes out
 *      brotli-compressed to a phone that takes br. The hosting edge only gzips a buffered answer; br at quality 11 is
 *      ~15-20% smaller. Each file is compressed ONCE per content, in the background (zlib's thread pool): until its
 *      copy is ready, the ask falls through to the static server as today. Only basenames of files that exist in the
 *      folder are compressed, so the cache is bounded by the folder. A `v` in any other form (e.g. a minified copy's
 *      `<hex>m`) is not this handler's.
 *   2. An unversioned file (no ?v=) is kept a day, not a year: a redrawn picture reaches phones. The Urdu font,
 *      whose NAME is its version (wq-nastaliq-<n>.woff2), keeps its year.
 *   3. The page shells name Jugnu's pictures with ?v=<sha256 of the picture, 10 hex>: html sent with res.send, and
 *      the streamed page (web-quiz-stream.js reads res.locals.wqHtml). Not on a link-preview fetch (today's page).
 *      Before the page's first script they carry window.WQJV, every Jugnu picture's version, and window.wqjv(url)
 *      (picMapScript), so the page scripts name the pictures they build the same way (their jv(url)); with the
 *      switch off there is neither and the scripts build today's URLs.
 *
 * Switch off: nothing here touches the request or the answer (today's bytes and headers), whatever web_quiz_fast says.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isPreviewFetch } = require('./web-quiz-preview');
const { brotliOn } = require('./web-quiz-brotli-flag');

const V_RX = /^[0-9a-f]{10}$/;
const NAME_RX = /^[A-Za-z0-9._-]+\.(js|css)$/;
const FONT_RX = /^\/fonts\/wq-nastaliq-\d+\.woff2$/;
const PIC_RX = /(\bsrc=")(\/wq\/(?:jugnu\/[A-Za-z0-9_-]+|jugnu_[A-Za-z0-9_-]+)\.webp)"/g;
const YEAR = 'public, max-age=31536000, immutable';
const DAY = 'public, max-age=86400';
const TYPES = { js: 'application/javascript; charset=UTF-8', css: 'text/css; charset=UTF-8' };
const BR_PARAMS = (size) => ({
  [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
});

/** brotli q11 of a buffer, off the request path (zlib's thread pool). */
function brotli(buf) {
  return new Promise((resolve, reject) => zlib.brotliCompress(buf, { params: BR_PARAMS(buf.length) }, (e, out) => (e ? reject(e) : resolve(out))));
}

/** The query string's single `v`, or null. */
function versionOf(req) {
  const v = req.query && req.query.v;
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * The inline script that names Jugnu's pictures for the page scripts: window.WQJV (path under /wq/ -> version) and
 * window.wqjv(url), the url with ?v=<its version> when the picture is in the map, else the url as it is.
 */
function picMapScript(map) {
  return `<script>window.WQJV=${JSON.stringify(map)};window.wqjv=function(u){var m=window.WQJV,k=String(u).replace(/^\\/wq\\//,'');return typeof m[k]==='string'?u+'?v='+m[k]:u};</script>`;
}

/**
 * createWqStatic({ publicDir, on }) → express middleware. `on()` answers whether the switch is on now, at once
 * (default: the process's web_quiz_brotli switch). The middleware carries `.stats()`: the br copies ready and their bytes.
 */
function createWqStatic({ publicDir, on }) {
  const dir = path.resolve(publicDir);
  const ask = typeof on === 'function' ? on : brotliOn;
  const switchOn = () => { try { return ask() === true; } catch (_) { return false; } };
  const copies = new Map();   // name -> { key, etag, br } (ready) | { key, pending } (in the works)
  const picV = new Map();     // '/wq/…webp' -> { key, v }
  let warmed = false;

  /** The file's identity now: size + mtime (a deploy that changes the file changes the key). */
  const keyOf = (st) => `${st.size}:${st.mtimeMs}`;

  function make(name, file, key) {
    const job = fs.promises.readFile(file)
      .then((buf) => brotli(buf).then((br) => {
        const etag = `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}-br"`;
        copies.set(name, { key, etag, br });
      }))
      .catch(() => { if (copies.get(name) && copies.get(name).pending === job) copies.delete(name); });
    copies.set(name, { key, pending: job });
    return job;
  }

  /** The ready copy for name at key, or null (and starts making it). */
  function copyFor(name, file, key) {
    const c = copies.get(name);
    if (c && c.key === key) return c.br ? c : null;
    make(name, file, key);
    return null;
  }

  /** Every .js/.css in the folder, one at a time (a background warm-up after the first versioned ask). */
  function warm() {
    if (warmed) return;
    warmed = true;
    fs.promises.readdir(dir).then(async (names) => {
      for (const name of names.filter((n) => NAME_RX.test(n))) {
        const file = path.join(dir, name);
        try {
          const st = await fs.promises.stat(file);
          if (!st.isFile()) continue;
          const c = copies.get(name);
          if (c && c.key === keyOf(st)) { if (c.pending) await c.pending; continue; }
          await make(name, file, keyOf(st));
        } catch (_) { /* gone meanwhile */ }
      }
    }).catch(() => {});
  }

  function sendBr(req, res, c, ext) {
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Type', TYPES[ext]);
    res.setHeader('Cache-Control', YEAR);
    res.setHeader('ETag', c.etag);
    const inm = String(req.get('if-none-match') || '');
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === c.etag)) {
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Encoding');
      return res.status(304).end();
    }
    res.setHeader('Content-Length', c.br.length);
    res.status(200);
    return req.method === 'HEAD' ? res.end() : res.end(c.br);
  }

  /** A picture's version (sha256 of the file, 10 hex) by its path under /wq/, cached by size+mtime; null when missing. */
  function picVersion(rel) {
    const url = `/wq/${rel}`;
    const file = path.join(dir, rel);
    let st;
    try { st = fs.statSync(file); } catch (_) { return null; }
    if (!st.isFile()) return null;
    const key = keyOf(st);
    let p = picV.get(url);
    if (!p || p.key !== key) {
      try { p = { key, v: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10) }; } catch (_) { return null; }
      picV.set(url, p);
    }
    return p.v;
  }

  /** The pictures' ?v= in a page's html (the switch is on: read once, when the page's answer starts). */
  function versionPics(html) {
    return html.replace(PIC_RX, (all, src, url) => {
      const v = picVersion(url.slice('/wq/'.length));
      return v ? `${src}${url}?v=${v}"` : all;
    });
  }

  /**
   * Every Jugnu picture and loop the page scripts build a URL for (jugnu/<pose>.webp|webm, jugnu_<pose>.webp) and its
   * version, as the inline script the scripts read (window.WQJV; their jv(url) adds ?v= when the name is in it).
   * Remade at most every 30 s; '' when the folder cannot be read.
   */
  let mapAt = -Infinity;
  let mapTag = '';
  function picMapTag() {
    if (Date.now() - mapAt < 30000) return mapTag;
    mapAt = Date.now();
    const map = {};
    const list = (sub, rx) => { try { return fs.readdirSync(path.join(dir, sub)).filter((n) => rx.test(n)); } catch (_) { return []; } };
    for (const n of list('jugnu', /^[A-Za-z0-9_-]+\.(webp|webm)$/).sort()) { const v = picVersion(`jugnu/${n}`); if (v) map[`jugnu/${n}`] = v; }
    for (const n of list('', /^jugnu_[A-Za-z0-9_-]+\.webp$/).sort()) { const v = picVersion(n); if (v) map[n] = v; }
    mapTag = Object.keys(map).length ? picMapScript(map) : '';
    return mapTag;
  }

  /** One page's html as the edge sends it: pictures versioned, and the map before the page's first script (once). */
  function pageWriter() {
    let mapped = false;
    return (s) => {
      if (typeof s !== 'string') return s;
      let out = versionPics(s);
      if (!mapped) {
        const at = out.indexOf('<script');
        if (at >= 0) {
          mapped = true;
          out = out.slice(0, at) + picMapTag() + out.slice(at);
        }
      }
      return out;
    };
  }

  function onPage(req, res, next) {
    // a link-preview fetch (a crawler: no pictures loaded) keeps today's page, byte for byte
    if (!switchOn() || isPreviewFetch(req)) return next();
    const pageHtml = pageWriter();
    res.locals.wqHtml = pageHtml;
    const send = res.send;
    res.send = function sendPage(body) {
      if (typeof body === 'string' && /^text\/html/.test(String(this.get('Content-Type') || ''))) return send.call(this, pageHtml(body));
      return send.call(this, body);
    };
    return next();
  }

  function onFile(req, res, next) {
    if (!switchOn()) return next();
    const sub = req.path.slice('/wq'.length);
    const v = versionOf(req);
    if (!v) {
      if (!FONT_RX.test(sub)) res.setHeader('Cache-Control', DAY);
      return next();
    }
    if (!V_RX.test(v) || (req.method !== 'GET' && req.method !== 'HEAD') || req.get('range')) return next();
    const name = sub.slice(1);
    const m = NAME_RX.exec(name);
    if (!m || req.acceptsEncodings('br') !== 'br') return next();
    const file = path.join(dir, name);
    if (path.dirname(file) !== dir) return next();
    warm();
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return next();
      const c = copyFor(name, file, keyOf(st));
      return c ? sendBr(req, res, c, m[1]) : next();
    });
  }

  function wqStatic(req, res, next) {
    return req.path.startsWith('/wq/') ? onFile(req, res, next) : onPage(req, res, next);
  }
  wqStatic.stats = () => {
    let bytes = 0;
    let n = 0;
    copies.forEach((c) => { if (c.br) { n += 1; bytes += c.br.length; } });
    return { files: n, bytes };
  };
  return wqStatic;
}

module.exports = { createWqStatic, picMapScript, V_RX, NAME_RX };
