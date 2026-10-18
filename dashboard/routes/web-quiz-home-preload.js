/**
 * The child home starts its scripts and styles while the server answers (app_settings web_quiz_home_preload, read by
 * the bot in the hub's one settings read; the hub answer says `home_pre: true` only when it is on).
 *
 * With the fast first page (web_quiz_fast) the edge sends the hub's head before the bot's answer, but the home's own
 * files (keep my place, the v3 home, Jugnu's corner, the read-along preview: the tail's tags; then the door screens,
 * which wq-home.js asks for once the home is drawn) were asked for only after that answer: one more round trip, plus
 * their bytes, after the wait. ON, that head preloads each of them, at EXACTLY the address the page asks for later
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
 */
let last = null; // [[href, as], …] from the last hub answer with `home_pre`, or null

const HREF_RX = /^\/wq\/[A-Za-z0-9._-]+\.(js|css)\?v=[0-9A-Za-z]+$/;
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
  return out.filter(([h]) => HREF_RX.test(h) && !seen.has(h) && seen.add(h));
}

/** A hub answer's page was drawn with these tail tags: remember what its next early head preloads. */
function learn(payload, tags, assetV) {
  if (!payload || payload.home_pre !== true) { last = null; return; }
  if (payload.locked || !payload.kid) return;
  last = addresses(payload, tags, assetV);
}

/** The preloads for the early head ('' when nothing is learned): one line each, after the head's stylesheet. */
function head() {
  return last && last.length ? last.map(([h, as]) => `\n<link rel="preload" href="${h}" as="${as}">`).join('') : '';
}

module.exports = { learn, head, addresses, _reset: () => { last = null; } };
