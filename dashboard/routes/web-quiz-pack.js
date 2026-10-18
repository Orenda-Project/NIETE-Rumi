'use strict';
/**
 * The child home's scripts and styles as one file each (app_settings web_quiz_pack, read by the bot in the hub's one
 * settings read; the hub answer says `pack: true` only when it is on).
 *
 * Today the hub's tail names the home's files one by one (wq-tel, keep my place, the v3 home, Jugnu's corner, the
 * read-along preview), and wq-home.js asks for the door screens (wq-doors) once the home is drawn: up to 6 scripts and
 * 3 styles. ON, the tail names ONE script and ONE stylesheet holding exactly the files that page would have asked for,
 * in the page's own order (so they run in the order today's tags run them), then hub.js as its own tag. The door
 * screens ride in the pack, ahead of hub.js: the home's first mount finds window.WQDOORS and asks for nothing more.
 * hub.js, wq.css (other pages share it) and the stories reader keep their own files.
 *
 * GET /wq/pack/<set>.js|.css: the set is one short name per file from a fixed list, in list order, each once; any
 * other name is a 404. The body is the plain files joined (scripts by ";\n", styles by "\n"). Its version is its own:
 * a hash of the files it holds (and of the read-along player, which the preview loads at the preview's own ?v=), so it
 * is immutable for a year at exactly that ?v=; any other ?v=, or none (a page from before a deploy), gets the same
 * bytes with no-cache. With web_quiz_brotli on (the /wq/* files' own switch) a phone that takes br gets the pack
 * brotli-compressed, made once per set in the background (zlib's thread pool), as web-quiz-static.js does a file.
 *
 * Order: the scripts run in today's tag order (wq-tel, keep my place, the home, Jugnu's corner, the preview), with the
 * door screens right after the home. The styles keep today's cascade: wq-doors.css is appended to <head> by wq-home.js
 * today, so it sits BEFORE the tail's keep-my-place and home styles in the document (wq-home.css's .wq-rart wins over
 * wq-doors.css's); the pack holds doors, keep my place, home in that order.
 *
 * A pack that fails falls back to the files by name: the stylesheet's error handler asks once for each style it held
 * (at the hub's ?v=, today's addresses); a failed script leaves no window.WQHOME, so hub.js asks for wq-home.js/.css
 * itself (its own loader, retry and plain home), as when wq-home.js alone fails today.
 *
 * With the fallback home (`home_fb`) the home's own files stay out of the pack: hub.js asks for wq-home.js itself (its
 * 5 s wait, retry and plain home), so the edge writes today's home tags (its stylesheet and a preload) after the pack.
 *
 * Off (no `pack`, or anything but JSON true): the page is today's, byte for byte.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PACK = {
  js: [['tel', 'wq-tel.js'], ['bind', 'wq-bind.js'], ['home', 'wq-home.js'], ['doors', 'wq-doors.js'], ['play', 'hub-play.js'],
    ['listen', 'wq-readalong-listen.js']],
  css: [['doors', 'wq-doors.css'], ['bind', 'wq-bind.css'], ['home', 'wq-home.css']],
};
const NAME_RX = /^([a-z]+(?:\.[a-z]+)*)\.(js|css)$/;
const JOIN = { js: Buffer.from(';\n'), css: Buffer.from('\n') };
const TYPES = { js: 'application/javascript; charset=UTF-8', css: 'text/css; charset=UTF-8' };
const YEAR = 'public, max-age=31536000, immutable';
// The read-along preview loads its player (wq-readalong.js) at the ?v= of the tag whose src names the preview's path:
// a pack holding the preview names that path (`in=`) and hashes the player too.
const LISTEN_FILE = 'wq-readalong-listen.js';
const PLAYER_FILE = 'wq-readalong.js';

/** The hub answer asks for the pack (JSON true only). */
function on(payload) {
  return Boolean(payload && payload.pack === true);
}

/** The short names the hub answer calls for, in page order: { js: [...], css: [...] }. */
function parts(payload) {
  const B = payload || {};
  const want = { tel: true, bind: Boolean(B.bind), home: Boolean(B.home_v3) && !B.home_fb, doors: Boolean(B.home_v3),
    play: Boolean(B.play && typeof B.play === 'object'), listen: B.listen === true };
  return { js: PACK.js.map(([k]) => k).filter((k) => want[k]), css: PACK.css.map(([k]) => k).filter((k) => want[k]) };
}

/** A pack's URL name -> { ext, files } (each from the fixed list, in its order, once), else null. */
function filesOf(name) {
  const m = NAME_RX.exec(String(name || ''));
  if (!m) return null;
  const ext = m[2];
  const list = PACK[ext];
  const files = [];
  let at = 0;
  for (const k of m[1].split('.')) {
    const i = list.findIndex(([n], j) => j >= at && n === k);
    if (i < 0) return null;
    files.push(list[i][1]);
    at = i + 1;
  }
  return { ext, files };
}

/**
 * createPack({ dir }) → the pack's version, hrefs, tags, head preloads and its GET handler, over the files in dir.
 * Versions and bodies are read once per set and kept for the process (the files change only with a deploy, as the
 * hub's own version does).
 */
function createPack({ dir }) {
  const versions = new Map(); // set name -> 10 hex
  const bodies = new Map();   // set name -> Buffer
  const read = (f) => fs.readFileSync(path.join(dir, f));

  function body(name) {
    if (!bodies.has(name)) {
      const set = filesOf(name);
      bodies.set(name, Buffer.concat(set.files.flatMap((f, i) => (i ? [JOIN[set.ext], read(f)] : [read(f)]))));
    }
    return bodies.get(name);
  }

  /** The set's own version: a hash of its files (and of the player, when it holds the preview). */
  function version(name) {
    if (!versions.has(name)) {
      const h = crypto.createHash('sha256');
      const set = filesOf(name);
      const add = (f) => { h.update(f); try { h.update(read(f)); } catch (_) { /* absent in some tests */ } };
      set.files.forEach(add);
      if (set.files.includes(LISTEN_FILE)) add(PLAYER_FILE);
      versions.set(name, h.digest('hex').slice(0, 10));
    }
    return versions.get(name);
  }

  /** The two addresses the page asks for (html-escaped, as written in a tag): { css: href|null, js: href }. */
  function hrefs(payload) {
    const { js, css } = parts(payload);
    const jsName = `${js.join('.')}.js`;
    const cssName = css.length ? `${css.join('.')}.css` : null;
    const listen = js.includes('listen');
    return {
      css: cssName ? `/wq/pack/${cssName}?v=${version(cssName)}` : null,
      js: `/wq/pack/${jsName}?v=${version(jsName)}${listen ? `&amp;in=/wq/${LISTEN_FILE}` : ''}`,
    };
  }

  /**
   * The tail's own tags for the pack: one stylesheet (when the answer names a style) and one script. The stylesheet's
   * error handler asks once for each style it held, by name, at the hub's ?v= (the pack's scripts may have run, so
   * nothing else would ask for them).
   */
  function tags(payload, assetV) {
    const { css } = parts(payload);
    const h = hrefs(payload);
    const files = css.map((k) => `'${PACK.css.find(([n]) => n === k)[1]}'`).join(',');
    const fallback = `this.onerror=null;[${files}].forEach(function(f){var l=document.createElement('link');l.rel='stylesheet';l.href='/wq/'+f+'?v=${assetV}';document.head.appendChild(l)})`;
    return `${h.css ? `<link rel="stylesheet" href="${h.css}" onerror="${fallback}">\n` : ''}<script src="${h.js}" defer></script>\n`;
  }

  /** The flushed head's preloads for a pack page (the set the edge last linked), at the tags' exact addresses. */
  function preloads(h) {
    return [...(h.css ? [`<link rel="preload" href="${h.css}" as="style">`] : []), `<link rel="preload" href="${h.js}" as="script">`];
  }

  /** GET /wq/pack/:name. `brotliOn()`: the /wq/* files' br switch (web_quiz_brotli), never waited for. */
  function handler({ brotliOn = () => false } = {}) {
    const br = new Map(); // set name -> { etag, buf } | { pending }
    const brOn = () => { try { return brotliOn() === true; } catch (_) { return false; } };
    function brCopy(name, buf) {
      const c = br.get(name);
      if (c) return c.buf ? c : null;
      const job = new Promise((resolve) => zlib.brotliCompress(buf, { params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      } }, (e, out) => {
        if (e) br.delete(name);
        else br.set(name, { etag: `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}-br"`, buf: out });
        resolve();
      }));
      br.set(name, { pending: job });
      return null;
    }
    const fn = (req, res) => {
      const name = req.params.name;
      const set = filesOf(name);
      let buf;
      try { buf = set && body(name); } catch (_) { buf = null; }
      if (!buf) return res.status(404).set('Cache-Control', 'no-store').type('text').send('not found');
      const current = typeof req.query.v === 'string' && req.query.v === version(name);
      res.set('Cache-Control', current ? YEAR : 'no-cache');
      if (current && brOn() && req.acceptsEncodings('br') === 'br') {
        const c = brCopy(name, buf);
        if (c) {
          res.set({ 'Content-Encoding': 'br', Vary: 'Accept-Encoding', 'Content-Type': TYPES[set.ext], ETag: c.etag });
          const inm = String(req.get('if-none-match') || '');
          if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === c.etag)) {
            res.removeHeader('Content-Type');
            res.removeHeader('Content-Encoding');
            return res.status(304).end();
          }
          res.set('Content-Length', String(c.buf.length));
          return res.status(200).end(req.method === 'HEAD' ? undefined : c.buf);
        }
      }
      return res.status(200).type(TYPES[set.ext]).send(buf);
    };
    fn.brReady = (name) => { const c = br.get(name); return c ? (c.pending || Promise.resolve()) : Promise.resolve(); };
    return fn;
  }

  return { version, hrefs, tags, preloads, handler, body };
}

module.exports = { PACK, on, parts, filesOf, createPack };
