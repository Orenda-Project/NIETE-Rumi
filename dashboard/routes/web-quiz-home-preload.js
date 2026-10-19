/**
 * The child home starts its scripts and styles while the server answers (app_settings web_quiz_home_preload, read by
 * the bot in the hub's one settings read; the hub answer says `home_pre: true` only when it is on).
 *
 * With the fast first page (web_quiz_fast) the edge sends the hub's head before the bot's answer, but the home's own
 * files (the v3 home's stylesheet and script: tail tags; then the door screens, which wq-home.js asks for once the
 * home is drawn) were asked for only after that answer: one more round trip, plus their bytes, after the wait. ON,
 * that head preloads each of them, at EXACTLY the address the page asks for later
 * (the tag's own href, its ?v=, no crossorigin; the door screens at hub.js's own ?v=, as wq-home.js builds it), so each
 * file is fetched once, during the wait.
 *
 * The head is sent before the answer is known, so it follows the LAST hub answer this edge saw (as the fast page
 * follows the last `fast`): learn() keeps the addresses the last child's page asked for, from that page's own tags.
 *   - an answer with `home_pre: true` for a child (not locked): those addresses;
 *   - a locked answer with `home_pre: true` (the link on another phone; its page asks after unlocking, at the same
 *     addresses): what was learned stays;
 *   - an answer without `home_pre` (the switch OFF): nothing, so the next head is today's (a flip lands one open later).
 * head() is '' until then: every page is today's, byte for byte.
 *
 * It is a guess from the last child's page, so it is bounded to the files EVERY child home asks for (SHARED: the v3
 * home's stylesheet and script, and the door screens it loads). The files that differ from child to child or phone to
 * phone (keep my place, Jugnu's corner, the read-along preview, or any other tag) are never preloaded for the next
 * child: they stay in the tail, asked for after the answer as today.
 */
let last = null; // [[href, as], …] from the last hub answer with `home_pre`, or null (hrefs at that page's version: AT_PAGE)
// An address at the page's own version is kept without it, and preloaded at the version of the head (the minified
// copies, web_quiz_minify, are another version: a head's preloads are exactly what its own page asks for).
const AT_PAGE = '?v=\u0000';
const unversion = (href, v) => (v && href.endsWith(`?v=${v}`) ? `${href.slice(0, -`?v=${v}`.length)}${AT_PAGE}` : href);
const versionAt = (href, v) => (v && href.endsWith(AT_PAGE) ? `${href.slice(0, -AT_PAGE.length)}?v=${v}` : href);

const HREF_RX = /^\/wq\/[A-Za-z0-9._-]+\.(js|css)\?v=[0-9A-Za-z]+$/;
// The files every child home asks for (the v3 home, and the door screens wq-home.js loads): the only files a head preloads.
const SHARED = new Set(['wq-home.css', 'wq-home.js', 'wq-doors.css', 'wq-doors.js']);
const fileOf = (h) => h.slice('/wq/'.length).split('?')[0];
// The tail's tags, as hubPageParts writes them (bindTags, homeTags, the corner, listenTag).
const TAG_RX = /<link rel="stylesheet" href="([^"]+)">|<link rel="preload" href="([^"]+)" as="script">|<script src="([^"]+)" defer><\/script>/g;

/** The addresses a hub page with these tail tags asks for: the tags' own, then the door screens (v3 home). */
function addresses(payload, tags, assetV) {
  const out = [];
  let m;
  TAG_RX.lastIndex = 0;
  while ((m = TAG_RX.exec(tags))) out.push(m[1] ? [m[1], 'style'] : [m[2] || m[3], 'script']);
  // wq-home.js (loadOnce) adds wq-doors.css + .js at hub.js's ?v= (this assetV) once the home is drawn; with the pack
  // (web_quiz_pack) they are inside it, and the flushed head preloads the pack itself (web-quiz.routes.js).
  if (payload.home_v3 && payload.pack !== true) out.push([`/wq/wq-doors.css?v=${assetV}`, 'style'], [`/wq/wq-doors.js?v=${assetV}`, 'script']);
  const seen = new Set();
  return out.filter(([h]) => HREF_RX.test(h) && SHARED.has(fileOf(h)) && !seen.has(h) && seen.add(h));
}

/** A hub answer's page was drawn with these tail tags: remember what its next early head preloads. */
function learn(payload, tags, assetV) {
  if (!payload || payload.home_pre !== true) { last = null; return; }
  if (payload.locked || !payload.kid) return;
  last = addresses(payload, tags, assetV).map(([h, as]) => [unversion(h, assetV), as]);
}

/** The preloads for the early head at version `assetV` ('' when nothing is learned): one line each, after the head's stylesheet. */
function head(assetV) {
  return last && last.length ? last.map(([h, as]) => `\n<link rel="preload" href="${versionAt(h, assetV)}" as="${as}">`).join('') : '';
}

module.exports = { learn, head, addresses, SHARED, _reset: () => { last = null; } };
