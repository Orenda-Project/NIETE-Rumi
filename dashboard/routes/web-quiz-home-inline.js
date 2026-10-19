'use strict';
/**
 * The child home's first open on a phone, in ONE response (app_settings web_quiz_home_inline, read by the bot in the
 * hub's one settings read; the hub answer says `home_inline: true` only when it is on).
 *
 * With the fast first page (web_quiz_fast) the edge sends the hub's head before the bot answers, and that head preloads
 * the home's files. On a phone that has never held them, each preload is one more round trip after the head (562 ms on
 * slow 4G) plus its bytes, so the home waits for the slowest of ~10 files. ON, a head for a phone without them (no
 * `wqhc` cookie at this version) carries the files themselves while the bot answers:
 *   - each stylesheet as a <style>, behind an inert <link rel="wq-src" href="<its address>"> (the pages' own lookups,
 *     link[href*="/wq/wq.css"], still find it; a wq-src link is never fetched);
 *   - each script as a <script type="text/x-wq" src="<its address>"> holding its text (a script of that type is never
 *     fetched nor run; script[src*="/wq/hub.js"] still finds it, so the files asked for later keep hub.js's ?v=).
 * The tail then runs them in the order today's deferred tags run (the adventure kit, wq-tel, keep my place, the home,
 * Jugnu's corner, the preview, the meter, hub.js), each as its own script, after every inline piece of the tail. A file
 * the head did not carry (this child's answer names one the last child's did not) rides the tail the same way.
 * After the page's load, it fetches each of those addresses once (the phone's cache now holds them), then sets
 * `wqhc=<version>`: from the next open the page is today's (preloads, cached files, compiled code kept).
 *
 * The head is sent before the answer is known, so it follows the LAST hub answer this edge saw (as `fast`, `home_pre`
 * and `pack` do): an answer with `home_inline` for a child (not locked) teaches the scripts its tail named; a locked
 * one keeps them; an answer without it turns it off, and the next head is today's. The tail follows its own head.
 * Not with the fallback home (`home_fb`: hub.js asks for wq-home.js itself) nor the pack (the head carries the files).
 *
 * Off (no `home_inline`, or anything but JSON true): head() and tail() are never called, the page is today's.
 */
const COOKIE = 'wqhc';
const MAX_AGE_S = 30 * 24 * 3600;
const HREF_RX = /^\/wq\/([A-Za-z0-9][A-Za-z0-9._-]*\.(js|css))\?v=[0-9A-Za-z]+$/;
// The tail's tags, as hubPageParts writes them (bindTags, homeTags, the corner, listenTag, paceTag, hub.js).
const TAG_RX = /<link rel="stylesheet" href="([^"]+)">\n?|<script src="([^"]+)"((?: [a-z-]+="[^"]*")*) defer><\/script>\n?/g;
// The home's scripts a head may carry for the next child (the ones the last child's tail named, from this list only).
const HOME_JS = new Set(['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'hub-play.js', 'wq-readalong-listen.js', 'hub.js']);
const made = []; // every carrier, so a test can clear what each learned
// A learned address at the page's own version is kept without it, and named at the version of the head that carries it
// (the minified copies, web_quiz_minify, are another version: a head never names a file at two).
const AT_PAGE = '?v=\u0000';
const unversion = (href, v) => (v && href.endsWith(`?v=${v}`) ? `${href.slice(0, -`?v=${v}`.length)}${AT_PAGE}` : href);
const versionAt = (href, v) => (href.endsWith(AT_PAGE) ? `${href.slice(0, -AT_PAGE.length)}?v=${v}` : href);

/** The hub answer asks for it (JSON true only), and its home can be carried (the v3 home, not its fallback). */
function on(payload) {
  return Boolean(payload && payload.home_inline === true && payload.home_v3 && !payload.home_fb && payload.pack !== true);
}

/** This phone already holds the home's files at this version (its cookie). */
function held(req, v) {
  const m = /(?:^|;\s*)wqhc=([0-9A-Za-z]+)(?:;|$)/.exec(String((req && req.headers && req.headers.cookie) || ''));
  return Boolean(m && m[1] === String(v));
}

// Text that sits inside <script> / <style>: nothing in it may close the element or open a comment the parser would follow.
const inScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
// A stylesheet moved from /wq/ into the page: its own relative addresses (the Urdu faces) made absolute.
const inStyle = (s) => s.replace(/<\/(style)/gi, '<\\/$1')
  .replace(/url\((["']?)([^"')]*)\1\)/g, (all, q, u) => (/^(\/|#|[a-z][a-z0-9+.-]*:)/i.test(u.trim()) ? all : `url(${q}/wq/${u.trim()}${q})`));

/**
 * The carrier for one edge: `source(file, v)` is the file's text at that version (the minified copy for an m version),
 * or null when there is no such file.
 */
function create({ source }) {
  let last = null; // the script addresses the last child's tail named (HOME_JS only), or null: the switch off
  const text = (href) => {
    const m = HREF_RX.exec(href);
    if (!m) return null;
    const t = source(m[1], href.slice(href.indexOf('?v=') + 3));
    return t == null ? null : String(t);
  };
  const script = (href, attrs = '') => {
    const t = text(href);
    return t == null ? null : `<script type="text/x-wq" src="${href}"${attrs}>${inScript(t)}</script>\n`;
  };
  const style = (href) => {
    const t = text(href);
    return t == null ? null : `<link rel="wq-src" href="${href}"><style>${inStyle(t)}</style>\n`;
  };

  /** A hub answer's tail (at version `v`) named these tags: remember the scripts the next head carries. */
  function learn(payload, tags, v) {
    if (!payload || payload.home_inline !== true) { last = null; return; }
    if (payload.locked || !payload.kid) return;
    if (!on(payload)) { last = null; return; }
    const out = [];
    let m;
    TAG_RX.lastIndex = 0;
    while ((m = TAG_RX.exec(tags))) if (m[2] && HREF_RX.test(m[2]) && HOME_JS.has(HREF_RX.exec(m[2])[1])) out.push(unversion(m[2], v));
    last = out;
  }

  /** The head carries: true once an answer with the switch was seen and this phone does not hold the files. */
  const wants = (req, v) => last !== null && !held(req, v);

  /**
   * The head's pieces: headCss(href) in place of a stylesheet tag; headJs(v) the scripts in place of their preloads
   * (wq-tel.js and hub.js at this version, and the scripts the last child's tail named) and the addresses it carried. A
   * file that is missing falls back to today's tag.
   */
  function headCss(href) {
    return style(href) || `<link rel="stylesheet" href="${href}">\n`;
  }
  function headJs(assetV) {
    const all = [`/wq/wq-tel.js?v=${assetV}`, ...(last || []).map((h) => versionAt(h, assetV)), `/wq/hub.js?v=${assetV}`];
    const hrefs = [];
    const html = [...new Set(all)].map((h) => {
      const s = script(h);
      if (s) hrefs.push(h);
      return s || `<link rel="preload" href="${h}" as="script">\n`;
    }).join('');
    return { html, hrefs };
  }

  /**
   * The tail of a page whose head carried the files: `t` is today's tail; its stylesheets become <style>s, its scripts
   * run from what the head carried (or from text carried here, in the tag's place), in order, after `headRun` (the
   * head's own deferred scripts, which today run first). `v` names this version in the cookie.
   */
  function tail(t, { headRun = [], carried = [], v }) {
    const have = new Set(carried);
    const run = [...headRun];
    const out = t.replace(TAG_RX, (all, css, src, attrs) => {
      if (css) return style(css) || all;
      let here = '';
      if (!have.has(src)) {
        here = script(src, attrs || '');
        if (!here) return all;
        have.add(src);
      }
      run.push(src);
      return here;
    });
    const go = `<script>(function(d,w,L,v){for(var i=0;i<L.length;i++){var e=d.querySelector('script[type="text/x-wq"][src="'+L[i]+'"]');if(!e)continue;var s=d.createElement("script");for(var j=0;j<e.attributes.length;j++){var a=e.attributes[j];if(a.name!=="type"&&a.name!=="src")s.setAttribute(a.name,a.value)}s.setAttribute("data-src",L[i]);s.text=e.text;d.body.appendChild(s)}`
      + 'w.addEventListener("load",function(){setTimeout(function(){try{var u=[].map.call(d.querySelectorAll(\'script[type="text/x-wq"],link[rel="wq-src"]\'),function(x){return x.getAttribute("src")||x.getAttribute("href")});'
      + 'Promise.all(u.map(function(h){return fetch(h,{credentials:"same-origin"}).then(function(r){if(!r.ok)throw 0;return r.arrayBuffer()})})).then(function(){'
      + `d.cookie="${COOKIE}="+v+"; Max-Age=${MAX_AGE_S}; Path=/h; SameSite=Lax"},function(){})}catch(x){}},500)})})(document,window,${JSON.stringify(run)},${JSON.stringify(String(v))})</script>\n`;
    const end = out.lastIndexOf('</body>');
    return end < 0 ? `${out}${go}` : `${out.slice(0, end)}${go}${out.slice(end)}`;
  }

  const carrier = { learn, wants, headCss, headJs, script, style, tail, _last: () => last, _reset: () => { last = null; } };
  made.push(carrier);
  return carrier;
}

module.exports = { create, on, held, COOKIE, HOME_JS, _resetAll: () => made.forEach((c) => c._reset()) };
