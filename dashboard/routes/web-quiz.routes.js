/**
 * Web child quiz: the public edge.
 *
 *   GET  /q/:code          the child page, server-rendered with the quiz payload as boot JSON
 *   GET  /q/:code/class    the same page opened on the class league table (own URL, own link preview)
 *   GET  /q/:code/schools  the same page opened on the school league (own URL, own link preview)
 *   GET  /q/:code/art/:kind.jpg?a=<id>  a share picture (card, class, schools, invite), drawn by the bot;
 *                          every shared link names one as its og:image, so the picture arrives with the link
 *   *    /api/wq/*         forwarded to the bot's /api/internal/wq/* with the internal key
 *   GET  /wq-probe         a capability probe for real phones; posts its result as one event
 *   GET  /wq/*             the page's own JS/CSS/images, long cache (the page links them with ?v=<hash>)
 *
 * The edge never touches the database. It checks shape and size, applies the rate
 * limits and adds x-forwarded-for; the bot owns every rule about the quiz itself.
 * Mounted before the body parsers and static handlers in index.js so its own body
 * cap applies and the SPA catch-all never sees /q/*.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
// express-rate-limit is required where the router is created, so this module (and renderQuizPage)
// loads where the dashboard's dependencies are not installed (the root CI run).
// Dependency-free: the brand table both services read (the bot names the key, the edge dresses the page).
const WebQuizBrand = require('../../bot/shared/config/web-quiz-brand');
const { createCanonicalRedirect } = require('./web-quiz-canonical');
const Preview = require('./web-quiz-preview');

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'wq');
const PROBE_FILE = path.join(PUBLIC_DIR, 'probe.html');
const CODE_RX = /^[A-Za-z0-9]{4,12}$/;
// A page session id (wq-tel.js): 8-16 lower-case letters and digits.
const PS_RX = /^[a-z0-9]{8,16}$/;
// A signed hub token (bot web-quiz-token.js): base64url payload "." 22-char signature.
const HUB_TOKEN_RX = /^[A-Za-z0-9_-]{16,600}\.[A-Za-z0-9_-]{22}$/;
const BODY_LIMIT = '16kb';
const BOT_TIMEOUT_MS = 10000;
// A bot call this slow or slower is logged (web_quiz.bot_call) even when it answers.
const BOT_SLOW_MS = 3000;
const YEAR_S = 31536000;
// A share picture's signed id (the bot's web-quiz-art.js): kind letter, ref, mac. The edge only checks its shape.
const ART_ID_RX = /^([cils])\.[A-Za-z0-9_-]{4,24}\.[A-Za-z0-9_-]{12}$/;
const ART_KIND = { card: 'c', invite: 'i', class: 'l', schools: 's' };
// A card or an invite never changes once drawn; a class or school picture moves as children play.
const ART_MAX_AGE = { card: 86400, invite: 86400, class: 600, schools: 600 };
// How long the edge itself keeps a drawn picture (ms): the preview fetch finds the one the card opening warmed.
const ART_KEEP_MS = { card: 86400000, invite: 86400000, class: 120000, schools: 120000 };
// How long the edge remembers a code's og facts for a link-preview fetch (ms).
const OG_KEEP_MS = 3600000;
function artId(v, kind) {
  const m = typeof v === 'string' ? ART_ID_RX.exec(v) : null;
  return m && m[1] === ART_KIND[kind] ? v : null;
}

// Each forwarded path: method, the pattern the edge accepts, and its limiter.
const API_ROUTES = [
  { method: 'get', path: '/api/wq/quiz/:code', limiter: 'read', unknownCode: true },
  { method: 'get', path: '/api/wq/board/:code', limiter: 'read' },
  { method: 'get', path: '/api/wq/schools/:code', limiter: 'read' },
  // Peer pulse ("Sara got Q4 right"): the bot answers from memory; the page polls at most 8 times a question.
  { method: 'get', path: '/api/wq/pulse/:code', limiter: 'read' },
  { method: 'get', path: '/api/wq/media/:code/:qid', limiter: 'read' },
  { method: 'post', path: '/api/wq/session', limiter: 'session' },
  { method: 'post', path: '/api/wq/bind', limiter: 'session' },
  { method: 'post', path: '/api/wq/answers', limiter: 'answers' },
  { method: 'post', path: '/api/wq/finish', limiter: 'finish' },
  { method: 'post', path: '/api/wq/me', limiter: 'read' },
  { method: 'post', path: '/api/wq/who', limiter: 'read' },
  { method: 'post', path: '/api/wq/who/fix', limiter: 'session' },
  { method: 'post', path: '/api/wq/who/class', limiter: 'session' },
  { method: 'get', path: '/api/wq/videos/:code', limiter: 'read' },
  { method: 'post', path: '/api/wq/videos/start', limiter: 'session' },
  { method: 'post', path: '/api/wq/e', limiter: ['events', 'eventsPs'] },
  // M4c challenge (audio goes browser → R2 by presigned PUT, never through this body cap)
  // (limits per challenge token, so one carrier IP's classroom is not throttled as one child; a loose IP ceiling too)
  { method: 'get', path: '/api/wq/ch/result/:ct', limiter: 'read', token: true },
  { method: 'post', path: '/api/wq/ch/upload', limiter: ['challenge', 'challengeIp'] },
  { method: 'post', path: '/api/wq/ch/result', limiter: ['challenge', 'challengeIp'] },
  // read aloud, live: a one-run speech-to-text key (the bot mints it; counted by the same per-run limiter)
  { method: 'post', path: '/api/wq/ch/live', limiter: ['challenge', 'challengeIp'] },
  // questions after Read aloud: the reached questions (no key), then one answer per tap (counted per run)
  { method: 'post', path: '/api/wq/ch/qs', limiter: ['challenge', 'challengeIp'] },
  { method: 'post', path: '/api/wq/ch/qa', limiter: ['challenge', 'challengeIp'] },
  { method: 'get', path: '/api/wq/ch/:token', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/ch/:token/:exercise', limiter: 'read', token: true },
  // M4a hub — the kid hub's JSON (a hub token, not a code: checked by HUB_TOKEN_RX)
  { method: 'get', path: '/api/wq/hub/:token', limiter: 'read' },
  // M4b library
  { method: 'get', path: '/api/wq/lib/h/:token', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/lib/:code', limiter: 'read' },
  { method: 'get', path: '/api/wq/videos/dl/:code', limiter: 'read' },
  { method: 'post', path: '/api/wq/hub/:token', limiter: 'read' },
  // the results card's door to the child's hub (a session token in the body)
  { method: 'post', path: '/api/wq/hubdoor', limiter: 'session' },
];

// The shell's line under Jugnu, shown until wq.js boots (seconds on slow 4G), so the page never reads as stuck.
const BOOT_COPY = { en: 'Opening the quiz…', ur: 'کوئز کھل رہا ہے…' };

const CLOSED_COPY = {
  en: { title: 'This quiz has closed', say: 'Ask your teacher for a new link.', off: 'The quiz is not open right now', offSay: 'Please try again in a little while.',
    hub: 'This link has expired', hubSay: 'Send /quiz on WhatsApp to get a new one.' },
  ur: { title: 'یہ کوئز بند ہو چکا ہے', say: 'اپنے استاد سے نیا لنک لیں۔', off: 'کوئز ابھی کھلا نہیں ہے', offSay: 'تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    hub: 'یہ لنک پرانا ہو چکا ہے', hubSay: 'نیا لنک لینے کے لیے واٹس ایپ پر ⁦/quiz⁩ بھیجیں۔' },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// JSON inside <script type="application/json">: nothing may close the tag or open a comment.
function bootJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function assetVersion() {
  const h = crypto.createHash('sha256');
  for (const f of ['wq.js', 'wq.css', 'wq-identity.js', 'hub.js', 'wq-lib.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  return h.digest('hex').slice(0, 10);
}

function originOf(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// The page's brand: only a KNOWN key from the bot is honoured, anything else is the default.
function brandOf(key) {
  return WebQuizBrand.publicBrand(Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, key) ? key : WebQuizBrand.DEFAULT_BRAND);
}

// The brand mark as inline SVG: on its tile (NIETE's app icon) or bare (a wide mark).
function markHtml(brand, cls = '') {
  return `<span class="wq-mark ${brand.mark.tile ? 'wq-tile' : 'wq-bare'}${cls ? ` ${cls}` : ''}" aria-hidden="true">${brand.mark.svg}</span>`;
}

function lockupHtml(brand, lang) {
  return `<span class="wq-brand">${markHtml(brand)}<span class="wq-lock"><b>${esc(brand.label[lang])}</b><small>${esc(brand.sub[lang])}</small></span></span>`;
}

function ogText(payload, view, brand) {
  const q = (payload && payload.quiz) || {};
  const cls = (payload && payload.cls) || {};
  const ur = q.lang === 'ur';
  const label = cls.label || (ur ? 'جماعت' : 'Class');
  const n = q.n || (q.questions || []).length || 0;
  if (payload && payload.challenge && payload.art && payload.art.invite) {
    const ch = payload.challenge;
    const score = `${ch.correct}/${ch.total}`;
    return {
      // Urdu: the imperative, never «آپ … سکتے ہیں» (masculine). A 0/N challenger is never a score to beat.
      title: !(Number(ch.correct) > 0)
        ? (ur ? `${ch.first} نے آپ کو چیلنج کیا ہے · ${q.topic || ''}` : `${ch.first} challenged you · ${q.topic || ''}`)
        : (ur ? `${ch.first} کے ${score} سے آگے نکلیں! · ${q.topic || ''}` : `Can you beat ${ch.first}'s ${score}? · ${q.topic || ''}`),
      desc: ur ? 'وہی کوئز کھیلیں اور دیکھیں!' : 'Play the same quiz and see!',
    };
  }
  if (view === 'schools') {
    return {
      title: ur ? 'اس ہفتے اسکولوں کی لیگ' : 'School league this week',
      desc: ur ? 'کھیلنے کے 10 پوائنٹس، اسکور کے 10 تک۔ کھیلیں اور اپنے اسکول کو اوپر لے جائیں!' : '10 points for playing, up to 10 for your score. Play and push your school up!',
    };
  }
  if (view === 'class') {
    return {
      title: ur ? `${q.topic || ''} · ${label} کی لیگ ٹیبل` : `${q.topic || ''} · ${label} league table`,
      desc: ur ? 'ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے۔' : 'Not played yet? Same link, still open.',
    };
  }
  return {
    title: ur ? `${q.topic || ''} · ${label} کا کوئز` : `${q.topic || ''} · ${label} quiz`,
    desc: ur ? `${n} سوال · ${brand.mascot.ur} کے ساتھ پڑھیں` : `${n} questions · ${brand.mascot.en} reads it with you`,
  };
}

// Urdu pages: the Nastaliq face (a subset of an OFL font, served from /wq like the rest of the page).
// Android has no Nastaliq of its own, so it is fetched first, before the stylesheet that uses it.
// The file name carries a version because /wq is served with a one-year immutable cache.
const URDU_FONT = '/wq/fonts/wq-nastaliq-1.woff2';

// Every share picture and brand picture is a 1200x630 JPEG: the head says so, so the phone knows what it fetches.
function head({ lang, dir, title, desc, origin, url, assetV, brand, image }) {
  const img = image || `${origin}${brand.og.image}`;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${esc(brand.tokens.theme)}">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(brand.og.site)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">${/^https:/.test(img) ? `\n<meta property="og:image:secure_url" content="${esc(img)}">` : ''}
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="${esc(WebQuizBrand.faviconHref(brand))}">${lang === 'ur' ? `\n<link rel="preload" href="${URDU_FONT}" as="font" type="font/woff2" crossorigin>` : ''}
<link rel="stylesheet" href="/wq/wq.css?v=${assetV}">
<style id="wq-brand">${WebQuizBrand.cssVars(brand)}</style>`;
}

// Identity v2 (name first) lives in its own script, sent only to quizzes the server switched to it.
function identityV2(payload) {
  const id = payload && payload.cls && payload.cls.identity;
  return Boolean(id && id.mode === 'v2');
}

/**
 * The picture a link previews as: the shared card, the invite on a challenge code, the class view's table,
 * the plain class link with ?v=<played> (the teacher's reminder: the live class picture), else the brand's.
 * WhatsApp caches a preview per URL, so ?v rides into the picture URL too.
 */
function ogImageFor({ payload, code, view, origin, a, v }) {
  const art = (payload && payload.art) || {};
  const ver = typeof v === 'string' && /^[0-9]{1,10}$/.test(v) ? v : null;
  const pic = (kind, id) => (id ? `${origin}/q/${code}/art/${kind}.jpg?a=${encodeURIComponent(id)}${ver ? `&v=${ver}` : ''}` : null);
  return pic('card', artId(a, 'card'))
    || pic('invite', artId(art.invite, 'invite'))
    || (view === 'class' || (ver && view === 'quiz') ? pic('class', artId(art.class, 'class')) : null)
    || (view === 'schools' ? pic('schools', artId(art.schools, 'schools')) : null);
}

function renderQuizPage({ payload, code, view, origin, assetV, url, a, v }) {
  const q = (payload && payload.quiz) || {};
  const lang = q.lang === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const brand = brandOf(payload && payload.brand);
  const og = ogText(payload, view, brand);
  const boot = { ...payload, code, view, brand };
  const image = ogImageFor({ payload, code, view, origin, a, v });
  return `${head({ lang, dir, title: og.title, desc: og.desc, origin, url: url || `${origin}/q/${code}`, assetV, brand, image })}
</head>
<body>
<main id="wq" class="wq-app" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(BOOT_COPY[lang])}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
${identityV2(payload) ? `<script src="/wq/wq-identity.js?v=${assetV}" defer></script>\n` : ''}<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-lib.js?v=${assetV}" defer></script>
<script src="/wq/wq.js?v=${assetV}" defer></script>
</body>
</html>`;
}

/**
 * A link-preview fetch's answer: the quiz page's own head (og tags, lang, dir) from the facts the edge
 * remembered, and an empty body. A crawler reads only the head; no quiz payload travels in it.
 */
function renderPreviewPage({ facts, code, view, origin, assetV, url, a, v }) {
  const lang = facts.quiz.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(facts.brand);
  const og = ogText(facts, view, brand);
  const image = ogImageFor({ payload: facts, code, view, origin, a, v });
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title: og.title, desc: og.desc, origin, url, assetV, brand, image })}
</head>
<body></body>
</html>`;
}

// M4a hub — the kid hub page: the same head and brand as the quiz page, its own script.
const HUB_TITLE = { en: 'Your quizzes and videos', ur: 'آپ کے کوئز اور ویڈیوز' };
const HUB_BOOT = { en: 'Opening…', ur: 'کھل رہا ہے…' };

function renderHubPage({ payload, token, origin, assetV }) {
  const lang = payload && payload.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(payload && payload.brand);
  const boot = { ...payload, token, view: 'hub', brand };
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title: HUB_TITLE[lang], desc: HUB_TITLE[lang], origin, url: origin, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app wq-hub" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(HUB_BOOT[lang])}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/hub.js?v=${assetV}" defer></script>
</body>
</html>`;
}

// M4b library: the video library opened from the kid's hub (/lib/<hub token>?kid=<chip>&l=<lang>).
// A shell only: wq-lib.js asks the bot for the library with the hub token, so the edge calls nothing.
const LIB_TITLE = { en: 'Video library', ur: 'ویڈیو لائبریری' };
function renderLibPage({ hub, kid, lang, origin, assetV, brandKey, rt = false }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME }));
  const boot = { view: 'lib', hub, kid, lang: l, brand: Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, brandKey) ? brandKey : null, rt: rt === true };
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title: LIB_TITLE[l], desc: LIB_TITLE[l], origin, url: origin, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><div id="wql-root" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"></div></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-lib.js?v=${assetV}" defer></script>
</body>
</html>`;
}

function renderClosedPage({ lang, kind, origin, assetV, brandKey }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME }));
  const c = CLOSED_COPY[l];
  const title = kind === 'off' ? c.off : kind === 'hub' ? c.hub : c.title;
  const say = kind === 'off' ? c.offSay : kind === 'hub' ? c.hubSay : c.say;
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title, desc: say, origin, url: origin, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><section class="wq-screen wq-closed">
<img class="wq-jugnu" src="/wq/jugnu_sleep.webp" alt="" width="160" height="160">
<h1>${esc(title)}</h1>
<p class="wq-sub">${esc(say)}</p>
</section></main>
</body>
</html>`;
}

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

/**
 * The edge's one way to call the bot: x-api-key, x-forwarded-for, the phone's UA, a
 * timeout, redirects never followed. Shared by the child quiz and the teacher report.
 * Returns { status, body, location } (JSON parsed), or { status, bytes, contentType,
 * location } for a 2xx picture — or for ANY answer when `raw` is set (an HTML page, a
 * PDF). Throws { unreachable: true } when the bot cannot be reached.
 */
const DEVICE_COOKIE_RX = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/;
function deviceCookie(req) {
  const m = DEVICE_COOKIE_RX.exec(String((req.get && req.get('cookie')) || ''));
  return m ? m[1] : null;
}

// A bot route as it is logged: the caller's template, else the path cut to its first four
// segments with ":x" for the rest, so a code or a token in the path is never written down.
function botRouteOf(pathname) {
  const parts = String(pathname || '').split('?')[0].split('/').filter(Boolean);
  return `/${parts.slice(0, 4).join('/')}${parts.length > 4 ? '/:x' : ''}`;
}

const defaultLogEvent = (e, p) => { try { require('../services/telemetry.service').logEvent(e, p); } catch (_) { /* never decides a response */ } };

function createBotClient({ botUrl, apiKey, fetchImpl, logEvent = defaultLogEvent, now = Date.now, timeoutMs = BOT_TIMEOUT_MS }) {
  // One line per call that fails or is slow (web_quiz.bot_call): the 502 a child sees has its reason on record.
  const record = (method, route, t0, fields) => {
    try { logEvent('web_quiz.bot_call', { route, method, ms: now() - t0, ...fields }); } catch (_) { /* never decides a response */ }
  };
  return async function callBot(method, pathname, req, body, { raw = false, route = null } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const t0 = now();
    const where = route || botRouteOf(pathname);
    try {
      const headers = { 'x-api-key': apiKey, 'x-forwarded-for': clientIp(req), accept: raw ? '*/*' : 'application/json' };
      const ua = req.get('user-agent');
      if (ua) headers['user-agent'] = ua.slice(0, 300);
      // This phone's device_ref (the wq_dv cookie the hub page writes): a hub link opens nothing as a child on another phone.
      const dv = deviceCookie(req);
      if (dv) headers['x-wq-device'] = dv;
      const init = { method, headers, redirect: 'manual' };
      if (controller) init.signal = controller.signal;
      if (method !== 'GET') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body || {});
      }
      const res = await fetchImpl(`${botUrl}${pathname}`, init);
      if (res.status >= 500 && res.status !== 503) record(method, where, t0, { outcome: 'upstream_5xx', status: res.status });
      else if (now() - t0 >= BOT_SLOW_MS) record(method, where, t0, { outcome: 'slow', status: res.status });
      const location = res.headers && res.headers.get ? res.headers.get('location') : null;
      // A picture the bot answers as bytes (a cropped option, an inline option picture) is passed
      // through as that picture: parsing it as JSON turned every one into "{}" (a blank tile).
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if ((raw || (res.status >= 200 && res.status < 300 && /^image\//i.test(type))) && res.arrayBuffer) {
        return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), contentType: type, location };
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      return { status: res.status, body: json, location };
    } catch (err) {
      const timedOut = Boolean(controller && controller.signal.aborted);
      record(method, where, t0, timedOut ? { outcome: 'timeout' }
        : { outcome: 'error', cause: String((err && err.cause && err.cause.code) || (err && err.name) || 'error').slice(0, 40) });
      const e = new Error('bot_unreachable');
      e.unreachable = true;
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ── M4c challenge: the page shell ────────────────────────────────────────────────────────────────────
const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const CH_COPY = {
  en: { boot: 'Opening the challenge…', title: (m) => `${m}'s Challenge`, not_eligible: 'This challenge is for classes 2 to 5.', pick_kid: 'Open the challenge from your quiz page.', other_device: 'Ask the child this link was sent to to open it. Is this your link? Send /quiz on WhatsApp again for a new one.' },
  ur: { boot: 'چیلنج کھل رہا ہے…', title: (m) => `${m} کا چیلنج`, not_eligible: 'یہ چیلنج جماعت ۲ سے ۵ کے لیے ہے۔', pick_kid: 'چیلنج اپنے کوئز کے صفحے سے کھولیں۔', other_device: 'جس بچے کو یہ لنک بھیجا گیا تھا، اُس سے کہیں کہ اسے کھولے۔ کیا یہ آپ کا لنک ہے؟ نیا لنک لینے کے لیے واٹس ایپ پر دوبارہ ⁦/quiz⁩ بھیجیں۔' },
};

function challengeVersion(file = 'wq-challenge.js') {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10); } catch (_) { return '0'; }
}

function renderChallengePage({ menu, token, kid, origin, assetV, chV, brandKey }) {
  const lang = menu.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey);
  const title = CH_COPY[lang].title(brand.mascot[lang]);
  const boot = { token, kid: kid || null, menu, brand, mascot: brand.mascot[lang], rt: menu.rt === true };
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title, desc: title, origin, url: `${origin}/c/`, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app wqc" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(CH_COPY[lang].boot)}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-read-live.js?v=${challengeVersion('wq-read-live.js')}" defer></script>
<script src="/wq/wq-challenge.js?v=${chV}" defer></script>
</body>
</html>`;
}

function renderChallengeNote({ lang, why, origin, assetV, brandKey }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey);
  const title = CH_COPY[l].title(brand.mascot[l]);
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title, desc: title, origin, url: origin, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><section class="wq-screen wq-closed">
<img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="160" height="160">
<h1>${esc(title)}</h1>
<p class="wq-sub">${esc(CH_COPY[l][why] || '')}</p>
</section></main>
</body>
</html>`;
}

function createWebQuizRouter(opts = {}) {
  const rateLimit = require('express-rate-limit');
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  // The portal's event sink (Axiom): the share pictures it hands out are logged here.
  const logEvent = opts.logEvent || ((e, p) => { try { require('../services/telemetry.service').logEvent(e, p); } catch (_) { /* never decides a response */ } });
  const router = express.Router();
  let assetV = null;
  const version = () => (assetV || (assetV = assetVersion()));
  // The brand the bot last named: a closed or unreachable quiz still wears this deployment's brand.
  let lastBrand = null;
  // Whether the pages send their page-session events (wq-tel.js): the bot's last word, for the library page,
  // which the edge draws without asking the bot.
  let lastRt = false;

  // Link previews (web-quiz-preview.js): what the edge last learned about each code, and the drawn pictures.
  const now = opts.now || Date.now;
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, logEvent, now, timeoutMs: opts.botTimeoutMs || BOT_TIMEOUT_MS });
  const ogKnown = Preview.ttlCache({ max: 2000, now });
  const artKept = Preview.ttlCache({ max: 200, now });

  // A child page on any host but the canonical one goes there first (one origin = one remembered child).
  router.use(createCanonicalRedirect(opts.canonicalBase != null ? opts.canonicalBase : process.env.WEB_QUIZ_BASE_URL));

  // ---- rate limits (BUILD_SPEC 3.3). Carriers put many phones behind one IP, so
  // the per-IP ceilings are generous and the tight ones are keyed on the token.
  const common = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).json({ error: 'slow_down' }) };
  // web_quiz.events_limited: the first refusal at once, then at most one line per 10 s with the count since.
  const refused = { n: 0, ip: 0, ps: 0, at: -Infinity };
  const limitedEvents = (by) => (req, res) => {
    refused.n += 1; refused[by] += 1;
    const t = now();
    if (t - refused.at >= 10000) {
      logEvent('web_quiz.events_limited', { n: refused.n, ip: refused.ip, ps: refused.ps });
      refused.n = 0; refused.ip = 0; refused.ps = 0; refused.at = t;
    }
    return res.status(429).json({ error: 'slow_down' });
  };
  const stKey = (req) => `st:${(req.body && typeof req.body.st === 'string' && req.body.st.slice(0, 200)) || clientIp(req)}`;
  const limiters = {
    read: rateLimit({ ...common, max: 300, keyGenerator: (req) => `ip:${clientIp(req)}` }),
    session: rateLimit({ ...common, max: 60, keyGenerator: (req) => `ipc:${clientIp(req)}:${String((req.body && req.body.code) || '').toUpperCase().slice(0, 12)}` }),
    answers: rateLimit({ ...common, max: 120, keyGenerator: stKey }),
    finish: rateLimit({ ...common, max: 10, keyGenerator: stKey }),
    // Page events: a whole class behind one school NAT sends at once, so the IP ceiling is generous and the
    // tight one is per page session (wq-tel.js sends ps on the batch). A refused batch is counted in the log.
    events: rateLimit({ ...common, max: 600, keyGenerator: (req) => `ip:${clientIp(req)}`, handler: limitedEvents('ip') }),
    eventsPs: rateLimit({ ...common, max: 30, keyGenerator: (req) => `ps:${req.body.ps}`, handler: limitedEvents('ps'),
      skip: (req) => !(req.body && typeof req.body.ps === 'string' && PS_RX.test(req.body.ps)) }),
    challenge: rateLimit({ ...common, max: 20, keyGenerator: (req) => `ct:${(req.body && typeof req.body.ct === 'string' && req.body.ct.slice(0, 200)) || clientIp(req)}` }),
    challengeIp: rateLimit({ ...common, max: 600, keyGenerator: (req) => `chip:${clientIp(req)}` }),
  };
  // Code enumeration: only answers that came back 404 count toward this one.
  const unknownCode = rateLimit({ ...common, max: 20, keyGenerator: (req) => `u:${clientIp(req)}`,
    skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => res.statusCode !== 404 });

  const jsonBody = express.json({ limit: BODY_LIMIT, type: ['application/json', 'text/plain'] });
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  function configured(req, res, next) {
    if (!botUrl || !apiKey) return res.status(503).json({ error: 'web_quiz_off' });
    return next();
  }

  for (const r of API_ROUTES) {
    const chain = [noStore, configured];
    if (r.unknownCode) chain.push(unknownCode);
    if (r.method === 'post') chain.push(jsonBody);
    [].concat(r.limiter).forEach((l) => chain.push(limiters[l]));
    router[r.method](r.path, ...chain, async (req, res) => {
      if (req.params.code && !CODE_RX.test(req.params.code)) return res.status(404).json({ error: 'not_found' });
      if (r.token && [req.params.token, req.params.ct].some((v) => v != null && !TOKEN_RX.test(v))) return res.status(404).json({ error: 'not_found' });
      if (r.path === '/api/wq/hub/:token' && !HUB_TOKEN_RX.test(req.params.token || '')) return res.status(401).json({ error: 'bad_token' });
      const qs = req.originalUrl.indexOf('?') >= 0 ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const pathname = req.path.replace(/^\/api\/wq\//, '/api/internal/wq/') + qs;
      try {
        const out = await callBot(r.method.toUpperCase(), pathname, req, req.body, { route: r.path.replace(/^\/api\/wq\//, '/api/internal/wq/') });
        if (out.status >= 300 && out.status < 400 && out.location) return res.redirect(out.status, out.location);
        if (out.status === 204) return res.status(204).end();
        if (out.bytes) return res.status(out.status).type(out.contentType).send(out.bytes);
        if (out.status >= 500 && out.status !== 503) return res.status(502).json({ error: 'upstream_error' });
        return res.status(out.status).json(out.body == null ? {} : out.body);
      } catch (err) {
        return res.status(502).json({ error: 'bot_unreachable' });
      }
    });
  }
  router.all('/api/wq/*', (req, res) => res.status(404).json({ error: 'not_found' }));

  // Body over the cap (or malformed JSON) on /api/wq: answer in JSON, never the HTML error page.
  router.use('/api/wq', (err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request', why: 'json' });
    return next(err);
  });

  // ---- the page
  const pageHeaders = (res) => res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });

  async function page(req, res, view) {
    pageHeaders(res);
    const origin = originOf(req);
    const code = String(req.params.code || '');
    if (!CODE_RX.test(code)) return res.status(404).type('html').send(renderClosedPage({ lang: 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand }));
    if (!botUrl || !apiKey) return res.status(503).type('html').send(renderClosedPage({ lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand }));
    const upper = code.toUpperCase();
    const p = typeof req.query.p === 'string' ? `?p=${encodeURIComponent(req.query.p.slice(0, 400))}` : '';
    const url = `${origin}/q/${upper}${view === 'class' ? '/class' : view === 'schools' ? '/schools' : ''}`;
    // A link-preview fetch (the sender's WhatsApp, before the message goes) is answered from what the edge
    // already knows about this code: the child's own page load, or the card's warm-up, taught it.
    const preview = !p && Preview.isPreviewFetch(req);
    let known = preview ? ogKnown.get(upper) : null;
    // This worker has not seen the code (the portal runs several): the bot keeps the facts in its one process
    // and answers them without a quiz render. Anything but facts (an older bot, a closed code) takes the full path.
    if (preview && !known) {
      try {
        const f = await callBot('GET', `/api/internal/wq/og/${upper}`, req);
        if (f.status === 200 && f.body && f.body.quiz) { known = f.body; ogKnown.set(upper, known, OG_KEEP_MS); }
      } catch (_) { /* the full path below */ }
    }
    if (known && !(view === 'class' && known.invited)) {
      return res.status(200).type('html').send(renderPreviewPage({ facts: known, code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v }));
    }
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/quiz/${upper}${p}`, req);
    } catch (_) {
      return res.status(502).type('html').send(renderClosedPage({ lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand }));
    }
    // A friend's challenge code has no class page: the class table is the challenger's classmates'.
    if (view === 'class' && out.status === 200 && out.body && out.body.invited) {
      return res.status(404).type('html').send(renderClosedPage({ lang: out.body.quiz && out.body.quiz.lang === 'ur' ? 'ur' : 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand }));
    }
    if (out.status === 200 && out.body && out.body.quiz) {
      if (Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, out.body.brand)) lastBrand = out.body.brand;
      if (typeof out.body.rt === 'boolean') lastRt = out.body.rt;
      if (!p) ogKnown.set(upper, Preview.ogFacts(out.body), OG_KEEP_MS);
      if (preview) {
        return res.status(200).type('html').send(renderPreviewPage({ facts: Preview.ogFacts(out.body), code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v }));
      }
      return res.status(200).type('html').send(renderQuizPage({ payload: out.body, code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v }));
    }
    const lang = out.body && out.body.lang === 'ur' ? 'ur' : 'en';
    // A 404/410 is "closed" only when it is the contract's answer; a bare 404 means the bot
    // endpoint is not deployed yet, which is "not open right now", not the child's fault.
    const contractAnswer = out.body && typeof out.body.error === 'string';
    if ((out.status === 404 || out.status === 410) && contractAnswer) {
      return res.status(out.status).type('html').send(renderClosedPage({ lang, kind: 'closed', origin, assetV: version(), brandKey: lastBrand }));
    }
    return res.status(out.status === 503 || out.status === 404 ? 503 : 502).type('html').send(renderClosedPage({ lang, kind: 'off', origin, assetV: version(), brandKey: lastBrand }));
  }

  router.get('/q/:code', limiters.read, unknownCode, (req, res) => page(req, res, 'quiz'));
  // M4a hub — GET /h/:token, the kid hub (WhatsApp /quiz link), server-rendered like /q/:code.
  router.get('/h/:token', limiters.read, async (req, res) => {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    // No hub JSON on a closed link, so the phone's own language picks the page's (an Urdu phone reads Urdu).
    const phoneLang = /^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en';
    const closed = (status, kind) => res.status(status).type('html').send(renderClosedPage({ lang: phoneLang, kind, origin, assetV: version(), brandKey: lastBrand }));
    if (!HUB_TOKEN_RX.test(token)) return closed(401, 'hub');
    if (!botUrl || !apiKey) return closed(503, 'off');
    const kid = typeof req.query.kid === 'string' && /^[0-9a-f]{16}$/.test(req.query.kid) ? `?kid=${req.query.kid}` : '';
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/hub/${token}${kid}`, req);
    } catch (_) {
      return closed(502, 'off');
    }
    if (out.status === 200 && out.body && Array.isArray(out.body.kids)) {
      if (Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, out.body.brand)) lastBrand = out.body.brand;
      if (typeof out.body.rt === 'boolean') lastRt = out.body.rt;
      return res.status(200).type('html').send(renderHubPage({ payload: out.body, token, origin, assetV: version() }));
    }
    if (out.status === 401) return closed(401, 'hub');
    return closed(out.status === 503 ? 503 : 502, 'off');
  });
  router.get('/q/:code/class', limiters.read, unknownCode, (req, res) => page(req, res, 'class'));
  router.get('/q/:code/schools', limiters.read, unknownCode, (req, res) => page(req, res, 'schools'));

  // M4c challenge: the kid's Challenge page, opened from the hub (or a quiz session token while testing).
  router.get('/c/:token', limiters.read, (req, res) => challengePage(req, res));

  async function challengePage(req, res) {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    const brandKey = lastBrand || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME });
    const lang0 = req.query.lang === 'ur' ? 'ur' : (req.query.lang === 'en' ? 'en' : null);
    if (!TOKEN_RX.test(token)) return res.status(404).type('html').send(renderClosedPage({ lang: lang0 || 'en', kind: 'closed', origin, assetV: version(), brandKey }));
    if (!botUrl || !apiKey) return res.status(503).type('html').send(renderClosedPage({ lang: lang0 || 'en', kind: 'off', origin, assetV: version(), brandKey }));
    const q = new URLSearchParams();
    if (typeof req.query.kid === 'string' && /^[0-9a-f]{16}$/.test(req.query.kid)) q.set('kid', req.query.kid);
    if (lang0) q.set('lang', lang0);
    const qs = q.toString() ? `?${q}` : '';
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/ch/${encodeURIComponent(token)}${qs}`, req);
    } catch (_) {
      return res.status(502).type('html').send(renderClosedPage({ lang: lang0 || 'en', kind: 'off', origin, assetV: version(), brandKey }));
    }
    if (out.status === 200 && out.body && Array.isArray(out.body.exercises)) {
      return res.status(200).type('html').send(renderChallengePage({ menu: out.body, token, kid: q.get('kid'), origin, assetV: version(), chV: challengeVersion(), brandKey }));
    }
    const err = out.body && out.body.error;
    if (err === 'not_eligible' || err === 'pick_kid' || err === 'other_device') {
      return res.status(out.status).type('html').send(renderChallengeNote({ lang: lang0 || 'en', why: err, origin, assetV: version(), brandKey }));
    }
    const kind = out.status === 401 ? 'closed' : 'off';
    return res.status(out.status === 401 ? 410 : 503).type('html').send(renderClosedPage({ lang: lang0 || 'en', kind, origin, assetV: version(), brandKey }));
  }

  // The share pictures. The id is the permission (the bot checks its mac); the edge checks its shape and that it
  // is the kind the path names, so a link can never ask for one picture under another's name or cache life.
  router.get('/q/:code/art/:kind.jpg', limiters.read, async (req, res) => {
    const kind = String(req.params.kind || '');
    const id = Object.prototype.hasOwnProperty.call(ART_KIND, kind) ? artId(req.query.a, kind) : null;
    if (!id || !CODE_RX.test(String(req.params.code || ''))) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
    if (!botUrl || !apiKey) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'web_quiz_off' });
    const sq = req.query.f === 'sq';
    // One event per picture handed out: which kind, kept here or asked of the bot, how long, and who fetched it
    // (WhatsApp Android/iOS, a browser…). A phone's preview fetch left no trace when the edge already held the picture.
    const t0 = Date.now();
    const seen = (from, extra = {}) => logEvent('web_quiz.art_edge', {
      kind, size: sq ? 'sq' : 'og', from, ms: Date.now() - t0, ua: Preview.fetcherOf(req), head: req.method === 'HEAD', ...extra,
    });
    const send = (pic) => res.status(200).set({ 'Cache-Control': `public, max-age=${ART_MAX_AGE[kind]}`, 'X-Robots-Tag': 'noindex' }).type(pic.contentType).send(pic.bytes);
    // Kept at the edge: the card opening fetched it, so the sender's preview fetch never waits for a draw.
    const keyArt = `${kind}|${id}|${sq ? 'sq' : 'og'}`;
    const kept = artKept.get(keyArt);
    if (kept) { seen('edge'); return send(kept); }
    try {
      const out = await callBot('GET', `/api/internal/wq/art/${id}${sq ? '?f=sq' : ''}`, req);
      if (out.bytes) {
        artKept.set(keyArt, { bytes: out.bytes, contentType: out.contentType }, ART_KEEP_MS[kind]);
        seen('bot');
        return res.status(200).set({ 'Cache-Control': `public, max-age=${ART_MAX_AGE[kind]}`, 'X-Robots-Tag': 'noindex' }).type(out.contentType).send(out.bytes);
      }
      seen('none', { status: out.status });
      return res.status(out.status === 404 ? 404 : 502).set('Cache-Control', 'no-store').json({ error: out.status === 404 ? 'not_found' : 'upstream_error' });
    } catch (_) {
      seen('none', { status: 0 });
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'bot_unreachable' });
    }
  });

  // M4b library
  router.get('/lib/:token', limiters.read, (req, res) => {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    if (!TOKEN_RX.test(token)) return res.status(404).type('html').send(renderClosedPage({ lang: 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand }));
    const kid = typeof req.query.kid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(req.query.kid) ? req.query.kid : null;
    const lang = req.query.l === 'ur' || req.query.lang === 'ur' ? 'ur' : 'en';
    return res.status(200).type('html').send(renderLibPage({ hub: token, kid, lang, origin, assetV: version(), brandKey: lastBrand, rt: lastRt }));
  });

  router.get('/wq-probe', (req, res) => {
    pageHeaders(res);
    res.type('html').sendFile(PROBE_FILE);
  });

  router.use('/wq', express.static(PUBLIC_DIR, { maxAge: YEAR_S * 1000, immutable: true, index: false, fallthrough: false }));
  // A missing file (a page cached before a deploy asking for a renamed one) is the static server's own 404 or 400,
  // answered here: the portal's last-resort handler would call it a 500 and the error monitors would count it.
  router.use('/wq', (err, req, res, next) => {
    const status = Number(err && (err.status || err.statusCode));
    if (status >= 400 && status < 500) return res.status(status).set('Cache-Control', 'no-store').type('text').send('not found');
    return next(err);
  });

  return router;
}


module.exports = { createWebQuizRouter, createBotClient, clientIp, renderQuizPage, renderPreviewPage, renderClosedPage, renderChallengePage, renderLibPage, bootJson, renderHubPage };
