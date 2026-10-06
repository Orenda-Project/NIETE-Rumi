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

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'wq');
const PROBE_FILE = path.join(PUBLIC_DIR, 'probe.html');
const CODE_RX = /^[A-Za-z0-9]{4,12}$/;
// A signed hub token (bot web-quiz-token.js): base64url payload "." 22-char signature.
const HUB_TOKEN_RX = /^[A-Za-z0-9_-]{16,600}\.[A-Za-z0-9_-]{22}$/;
const BODY_LIMIT = '16kb';
const BOT_TIMEOUT_MS = 10000;
const YEAR_S = 31536000;
// A share picture's signed id (the bot's web-quiz-art.js): kind letter, ref, mac. The edge only checks its shape.
const ART_ID_RX = /^([cils])\.[A-Za-z0-9_-]{4,24}\.[A-Za-z0-9_-]{12}$/;
const ART_KIND = { card: 'c', invite: 'i', class: 'l', schools: 's' };
// A card or an invite never changes once drawn; a class or school picture moves as children play.
const ART_MAX_AGE = { card: 86400, invite: 86400, class: 600, schools: 600 };
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
  { method: 'post', path: '/api/wq/answers', limiter: 'answers' },
  { method: 'post', path: '/api/wq/finish', limiter: 'finish' },
  { method: 'post', path: '/api/wq/me', limiter: 'read' },
  { method: 'post', path: '/api/wq/who', limiter: 'read' },
  { method: 'post', path: '/api/wq/who/fix', limiter: 'session' },
  { method: 'post', path: '/api/wq/who/class', limiter: 'session' },
  { method: 'get', path: '/api/wq/videos/:code', limiter: 'read' },
  { method: 'post', path: '/api/wq/videos/start', limiter: 'session' },
  { method: 'post', path: '/api/wq/e', limiter: 'events' },
  // M4c challenge (audio goes browser → R2 by presigned PUT, never through this body cap)
  // (limits per challenge token, so one carrier IP's classroom is not throttled as one child; a loose IP ceiling too)
  { method: 'get', path: '/api/wq/ch/result/:ct', limiter: 'read', token: true },
  { method: 'post', path: '/api/wq/ch/upload', limiter: ['challenge', 'challengeIp'] },
  { method: 'post', path: '/api/wq/ch/result', limiter: ['challenge', 'challengeIp'] },
  { method: 'get', path: '/api/wq/ch/:token', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/ch/:token/:exercise', limiter: 'read', token: true },
  // M4a hub — the kid hub's JSON (a hub token, not a code: checked by HUB_TOKEN_RX)
  { method: 'get', path: '/api/wq/hub/:token', limiter: 'read' },
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
  for (const f of ['wq.js', 'wq.css', 'wq-identity.js', 'hub.js']) {
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
      title: ur ? `کیا آپ ${ch.first} کے ${score} سے آگے جا سکتے ہیں؟ · ${q.topic || ''}` : `Can you beat ${ch.first}'s ${score}? · ${q.topic || ''}`,
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

function head({ lang, dir, title, desc, origin, url, assetV, brand, image }) {
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
<meta property="og:image" content="${esc(image || `${origin}${brand.og.image}`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
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
${identityV2(payload) ? `<script src="/wq/wq-identity.js?v=${assetV}" defer></script>\n` : ''}<script src="/wq/wq.js?v=${assetV}" defer></script>
</body>
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
<script src="/wq/hub.js?v=${assetV}" defer></script>
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
function createBotClient({ botUrl, apiKey, fetchImpl }) {
  return async function callBot(method, pathname, req, body, { raw = false } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), BOT_TIMEOUT_MS) : null;
    try {
      const headers = { 'x-api-key': apiKey, 'x-forwarded-for': clientIp(req), accept: raw ? '*/*' : 'application/json' };
      const ua = req.get('user-agent');
      if (ua) headers['user-agent'] = ua.slice(0, 300);
      const init = { method, headers, redirect: 'manual' };
      if (controller) init.signal = controller.signal;
      if (method !== 'GET') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body || {});
      }
      const res = await fetchImpl(`${botUrl}${pathname}`, init);
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
  en: { boot: 'Opening the challenge…', title: (m) => `${m}'s Challenge`, not_eligible: 'This challenge is for classes 2 to 5.', pick_kid: 'Open the challenge from your quiz page.' },
  ur: { boot: 'چیلنج کھل رہا ہے…', title: (m) => `${m} کا چیلنج`, not_eligible: 'یہ چیلنج جماعت ۲ سے ۵ کے لیے ہے۔', pick_kid: 'چیلنج اپنے کوئز کے صفحے سے کھولیں۔' },
};

function challengeVersion() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, 'wq-challenge.js'))).digest('hex').slice(0, 10); } catch (_) { return '0'; }
}

function renderChallengePage({ menu, token, kid, origin, assetV, chV, brandKey }) {
  const lang = menu.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey);
  const title = CH_COPY[lang].title(brand.mascot[lang]);
  const boot = { token, kid: kid || null, menu, brand, mascot: brand.mascot[lang] };
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title, desc: title, origin, url: `${origin}/c/`, assetV, brand })}
</head>
<body>
<main id="wq" class="wq-app wqc" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(CH_COPY[lang].boot)}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
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
  const router = express.Router();
  let assetV = null;
  const version = () => (assetV || (assetV = assetVersion()));
  // The brand the bot last named: a closed or unreachable quiz still wears this deployment's brand.
  let lastBrand = null;

  const callBot = createBotClient({ botUrl, apiKey, fetchImpl });

  // ---- rate limits (BUILD_SPEC 3.3). Carriers put many phones behind one IP, so
  // the per-IP ceilings are generous and the tight ones are keyed on the token.
  const common = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).json({ error: 'slow_down' }) };
  const stKey = (req) => `st:${(req.body && typeof req.body.st === 'string' && req.body.st.slice(0, 200)) || clientIp(req)}`;
  const limiters = {
    read: rateLimit({ ...common, max: 300, keyGenerator: (req) => `ip:${clientIp(req)}` }),
    session: rateLimit({ ...common, max: 60, keyGenerator: (req) => `ipc:${clientIp(req)}:${String((req.body && req.body.code) || '').toUpperCase().slice(0, 12)}` }),
    answers: rateLimit({ ...common, max: 120, keyGenerator: stKey }),
    finish: rateLimit({ ...common, max: 10, keyGenerator: stKey }),
    events: rateLimit({ ...common, max: 120, keyGenerator: (req) => `ip:${clientIp(req)}` }),
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
        const out = await callBot(r.method.toUpperCase(), pathname, req, req.body);
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
      const url = `${origin}/q/${upper}${view === 'class' ? '/class' : view === 'schools' ? '/schools' : ''}`;
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
    if (err === 'not_eligible' || err === 'pick_kid') {
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
    try {
      const out = await callBot('GET', `/api/internal/wq/art/${id}${req.query.f === 'sq' ? '?f=sq' : ''}`, req);
      if (out.bytes) {
        return res.status(200).set({ 'Cache-Control': `public, max-age=${ART_MAX_AGE[kind]}`, 'X-Robots-Tag': 'noindex' }).type(out.contentType).send(out.bytes);
      }
      return res.status(out.status === 404 ? 404 : 502).set('Cache-Control', 'no-store').json({ error: out.status === 404 ? 'not_found' : 'upstream_error' });
    } catch (_) {
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'bot_unreachable' });
    }
  });

  router.get('/wq-probe', (req, res) => {
    pageHeaders(res);
    res.type('html').sendFile(PROBE_FILE);
  });

  router.use('/wq', express.static(PUBLIC_DIR, { maxAge: YEAR_S * 1000, immutable: true, index: false, fallthrough: false }));

  return router;
}


module.exports = { createWebQuizRouter, createBotClient, clientIp, renderQuizPage, renderClosedPage, renderChallengePage, bootJson, renderHubPage };
