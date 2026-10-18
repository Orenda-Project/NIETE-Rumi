/**
 * Web child quiz: the public edge.
 *
 *   GET  /q/:code          the child page, server-rendered with the quiz payload as boot JSON
 *   GET  /q/:code/class    the same page opened on the class league table (own URL, own link preview)
 *   GET  /q/:code/schools  the same page opened on the school league (own URL, own link preview)
 *   GET  /q/:code/art/:kind.jpg?a=<id>  a share picture (card, class, schools, invite), drawn by the bot;
 *                          every shared link names one as its og:image, so the picture arrives with the link
 *   GET  /q/:code/art/teach.png?a=<id>&v=<ver>  the teacher's class link's own picture (the bot names it in the
 *                          payload only while its switches are on), asked of the bot under this code; immutable
 *   GET  /s/:book/:file    a storybook's picture or voice, immutable, from storage (web-quiz-story-assets.js)
 *   GET  /wq/card/:t.png   the finish card's picture (web_quiz_card_v3), kept at the edge; HEAD answered from memory
 *   GET  /k/:t             a shared finish card: its og head (the picture) and one way in, the bot's chat
 *   GET  /wq/vt/:vid.webp  a lesson's small thumbnail for the Videos door's shelves (web_quiz_video_shelf), kept at the edge
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
// The one list of Server-Timing items a child answer may carry (shared with the bot's writers; requires nothing).
const TimingNames = require('../../bot/shared/services/quiz/web-quiz-server-timing-names');
const { createCanonicalRedirect } = require('./web-quiz-canonical');
const Preview = require('./web-quiz-preview');
const HomePre = require('./web-quiz-home-preload');
const { urDigits } = require('../public/wq/wq-digits');
const { createStoryAssetHandler } = require('./web-quiz-story-assets');
const Stream = require('./web-quiz-stream');
// The one tap back to WhatsApp on a dead-end page (web_quiz_closed_way_back ON): the bot's signed words and its href rule.
const ChatTap = require('../../bot/shared/services/first-touch/chat-tap');
const WayBackSwitch = require('../lib/closed-way-back-switch');
const ClosedInlineSwitch = require('../lib/closed-inline-switch');
const { securityOf } = require('./edge-security-headers');
const WaitUx = require('./web-quiz-wait-ux');

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'wq');
const JUICE_DEMO_FILE = path.join(__dirname, '..', 'views', 'juice-demo.html');
const PROBE_FILE = path.join(PUBLIC_DIR, 'probe.html');
const CODE_RX = /^[A-Za-z0-9]{4,12}$/;
// A lesson's id (student_videos.id), for its thumbnail.
const VID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A page session id (wq-tel.js): 8-16 lower-case letters and digits.
const PS_RX = /^[a-z0-9]{8,16}$/;
// hub_open.src's route values (EVENTS row 3). Mirrors SRC_VALUES in bot/shared/services/quiz/web-quiz-hub-play.js:
// the edge cannot load the bot's modules, so keep the two lists the same.
const HUB_SRC_RX = /^(card|home|door|wa|link|hs|class_link|guest|friend|quiz|bind|join)$/;
// A signed hub token (bot web-quiz-token.js): base64url payload "." 22-char signature.
const HUB_TOKEN_RX = /^[A-Za-z0-9_-]{16,600}\.[A-Za-z0-9_-]{22}$/;
const BODY_LIMIT = '16kb';
const BOT_TIMEOUT_MS = 10000;
// A bot call this slow or slower is logged (web_quiz.bot_call) even when it answers.
const BOT_SLOW_MS = 3000;
const YEAR_S = 31536000;
// A share picture's signed id (the bot's web-quiz-art.js): kind letter, ref, mac. The edge only checks its shape.
const ART_ID_RX = /^([cilst])\.[A-Za-z0-9_-]{4,24}\.[A-Za-z0-9_-]{12}$/;
// teach: the teacher's class link (the class + its topic, or its book): a PNG whose link carries its version.
const ART_KIND = { card: 'c', invite: 'i', class: 'l', schools: 's', teach: 't' };
const ART_EXT = { teach: 'png' };
// A card or an invite never changes once drawn; a class or school picture moves as children play; the class link's
// picture never changes under its link (?v= moves with its label, topic or book).
const ART_MAX_AGE = { card: 86400, invite: 86400, class: 600, schools: 600, teach: YEAR_S };
// How long the edge itself keeps a drawn picture (ms): the preview fetch finds the one the card opening warmed.
// The class link's picture is kept no longer than the live class picture: its switch turned off, the edge stops
// handing it out within 120 s (its link's ?v= still moves with every new label, topic or book).
const ART_KEEP_MS = { card: 86400000, invite: 86400000, class: 120000, schools: 120000, teach: 120000 };
// The class link picture's version (the bot's web-quiz-class-pic.js): 8 hex.
const TEACH_V_RX = /^[0-9a-f]{8}$/;
// How long the edge remembers a code's og facts for a link-preview fetch (ms).
const OG_KEEP_MS = 3600000;
// Facts that name the class link's picture are remembered no longer than that picture is kept: its switch turned
// off, a preview head stops naming it within the same 120 s. Facts naming none keep the hour.
const ogKeepMs = (facts) => (facts && facts.art && facts.art.teach ? Math.min(OG_KEEP_MS, ART_KEEP_MS.teach) : OG_KEEP_MS);
// A finish card's sealed token (the bot's web-quiz-card-image.js): base64url only. The edge checks its shape; the bot opens it.
const CARD_TOKEN_RX = /^[A-Za-z0-9_-]{40,400}$/;
const cardToken = (v) => (typeof v === 'string' && CARD_TOKEN_RX.test(v) ? v : null);
// A drawn card never changes: a day at the edge, a year in any cache.
const CARD_KEEP_MS = 86400000;
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
  // keep my place (the bot answers {off:true} with web_quiz_phone_bind off)
  { method: 'post', path: '/api/wq/bind/mint', limiter: 'session' },
  { method: 'get', path: '/api/wq/bind/status', limiter: 'read' },
  { method: 'post', path: '/api/wq/bind/undo', limiter: 'session' },
  { method: 'get', path: '/api/wq/videos/:code', limiter: 'read' },
  { method: 'post', path: '/api/wq/videos/start', limiter: 'session' },
  { method: 'post', path: '/api/wq/e', limiter: ['events', 'eventsPs'] },
  // M4c challenge (audio goes browser → R2 by presigned PUT, never through this body cap)
  // (limits per challenge token, so one carrier IP's classroom is not throttled as one child; a loose IP ceiling too)
  { method: 'get', path: '/api/wq/ch/result/:ct', limiter: 'read', token: true },
  // the read-along on practice runs: a practice listen's words after its questions (by the run token); a grown-up's
  // preview of a practice story from the hub (#listen/<pid>); the bot refuses both while web_quiz_readalong is off
  { method: 'get', path: '/api/wq/ch/words/:ct', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/listen/h/:token/:pid', limiter: 'read', token: true },
  { method: 'post', path: '/api/wq/ch/upload', limiter: ['challenge', 'challengeIp'] },
  { method: 'post', path: '/api/wq/ch/result', limiter: ['challenge', 'challengeIp'] },
  // read aloud, live: a one-run speech-to-text key (the bot mints it; counted by the same per-run limiter)
  { method: 'post', path: '/api/wq/ch/live', limiter: ['challenge', 'challengeIp'] },
  // live reading v3: a story page's one-read speech key (the bot answers 404 while web_quiz_live_read_v3 is off)
  { method: 'post', path: '/api/wq/lr/key', limiter: ['lrKey', 'challengeIp'] },
  // questions after Read aloud: the reached questions (no key), then one answer per tap (counted per run)
  { method: 'post', path: '/api/wq/ch/qs', limiter: ['challenge', 'challengeIp'] },
  { method: 'post', path: '/api/wq/ch/qa', limiter: ['challenge', 'challengeIp'] },
  { method: 'get', path: '/api/wq/ch/:token', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/ch/:token/:exercise', limiter: 'read', token: true },
  // M4a hub — the kid hub's JSON (a hub token, not a code: checked by HUB_TOKEN_RX)
  { method: 'get', path: '/api/wq/hub/:token', limiter: 'read' },
  // M4b library
  { method: 'get', path: '/api/wq/lib/h/:token', limiter: 'read', token: true },
  // the v3 home's door screens (Stories / Games rows; the bot answers 404 while web_quiz_home_v3 is off)
  { method: 'get', path: '/api/wq/doors/h/:token', limiter: 'read', token: true },
  // Jugnu's Book from the kid's hub (the bot answers 503 while web_quiz_challenge_book is off)
  { method: 'get', path: '/api/wq/book/h/:token', limiter: 'read', token: true },
  { method: 'get', path: '/api/wq/lib/:code', limiter: 'read' },
  // storybooks from the kid's hub (the bot answers 404 stories_off while web_quiz_stories is off)
  { method: 'get', path: '/api/wq/stories/shelf/h/:token', limiter: 'read', token: true },
  // the covers of one grade × language for anyone (no child data): a join's grade tap warms the thumbnails
  { method: 'get', path: '/api/wq/stories/shelf', limiter: 'read', cache: 'public, max-age=300' },
  { method: 'get', path: '/api/wq/stories/book/:id/h/:token', limiter: 'read', token: true },
  // per child link (a whole class reads behind one school address), with a loose ceiling per address
  { method: 'post', path: '/api/wq/stories/event/h/:token', limiter: ['stories', 'challengeIp'], token: true },
  { method: 'get', path: '/api/wq/videos/dl/:code', limiter: 'read' },
  { method: 'post', path: '/api/wq/hub/:token', limiter: 'read' },
  // the results card's door to the child's hub (a session token in the body)
  { method: 'post', path: '/api/wq/hubdoor', limiter: 'session' },
  // an old, finished class link opened again: the child's hub, for one remembered child on this phone
  { method: 'post', path: '/api/wq/linkhome', limiter: 'session' },
  // a class link on a phone that holds a child: which children this browser holds ("Is it <name>?")
  { method: 'post', path: '/api/wq/known', limiter: 'session' },
  // the finish card (web_quiz_card_v3): a card token for this child's finish (the bot answers 404 while it is off)
  { method: 'post', path: '/api/wq/card', limiter: 'session' },
  // a child joins on their own (quiz_student_join; the bot answers {off:true} with it off): the grade tap, the one write
  { method: 'post', path: '/api/wq/join/grade', limiter: 'read' },
  { method: 'post', path: '/api/wq/join', limiter: 'session' },
];

// The shell's line under Jugnu, shown until wq.js boots (seconds on slow 4G), so the page never reads as stuck.
const BOOT_COPY = { en: 'Opening the quiz…', ur: 'کوئز کھل رہا ہے…' };

const CLOSED_COPY = {
  en: { title: 'This quiz has closed', say: 'Ask your teacher for a new link.', off: 'The quiz is not open right now', offSay: 'Please try again in a little while.',
    hub: 'This link has expired', hubSay: 'Send /quiz on WhatsApp to get a new one.', homeBtn: 'Go to my home page' },
  ur: { title: 'یہ کوئز بند ہو چکا ہے', say: 'اپنے ٹیچر سے نیا لنک لیں۔', off: 'کوئز ابھی کھلا نہیں ہے', offSay: 'تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    hub: 'یہ لنک پرانا ہو چکا ہے', hubSay: 'نیا لنک لینے کے لیے واٹس ایپ پر ⁦/quiz⁩ بھیجیں۔', homeBtn: 'اپنے ہوم پیج پر جائیں' },
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
  for (const f of ['wq.js', 'wq.css', 'wq-identity.js', 'hub.js', 'wq-lib.js', 'wq-bind.js', 'wq-bind.css', 'wq-card.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  // The hub's Jugnu corner (hub-play.js): its own line, so a change to it busts the cached hub page too.
  try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, 'hub-play.js'))); } catch (_) { /* absent in some tests */ }
  // Jugnu's Book (hub.js loads wq-book.js / .css at its own ?v=): a change to either busts the hub's version too.
  // wq-tel.js (on every page at this ?v=) holds the pages' link helper WQT.withLang: a change to it busts it too.
  for (const f of ['wq-book.js', 'wq-book.css', 'wq-tel.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  // The child home (wq-home.*, the home tags) and its door screens (wq-doors.*, loaded by wq-home.js) ride this ?v= too.
  for (const f of ['wq-home.js', 'wq-home.css', 'wq-doors.js', 'wq-doors.css']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  // The stories reader (loaded by the home and the hub at this ?v=) and its lazy files (Your turn; the questions and done, at the reader's ?v=, this
  // one): a reader-only change busts a phone's year-long cache too. The player it brings carries its own content version.
  // the reading moment the reader loads at this ?v= when the book says read_fb (web_quiz_read_feedback)
  for (const f of ['wq-stories.js', 'wq-stories.css', 'wq-stories-q.js', 'wq-stories-d.js', 'wq-moment.js', 'wq-moment.css']) {
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

// An Urdu preview counts in Urdu digits while the finish card's switch is on (the bot carries `card_v3: true`): the
// teacher's link and a child's card link sit side by side in one class group, one digit system. Off: today's text.
// A score (۳/۵) keeps its left-to-right order inside the Urdu line (U+2066…U+2069).
const urCount = (t) => urDigits(t).replace(/[\u06F0-\u06F9]+\/[\u06F0-\u06F9]+/g, (m) => `\u2066${m}\u2069`);
// Three Urdu descriptions as a native reader phrases them, with the same switch: the schools league ("up to 10 more
// for the score"), the class table (no masculine form addressed to the child), a challenge (see YOUR score).
const UR_DESC_ON = {
  schools: 'کھیلنے کے 10 پوائنٹس، اسکور کے مطابق مزید 10 تک۔ کھیلیں اور اپنے اسکول کو اوپر لے جائیں!',
  class: 'کھیلنا باقی ہے؟ وہی لنک ابھی کھلا ہے۔',
  challenge: 'وہی کوئز کھیلیں اور اپنا اسکور دیکھیں!',
};
function ogText(payload, view, brand) {
  const og = ogTextOf(payload, view, brand);
  const ur = ((payload && payload.quiz) || {}).lang === 'ur';
  if (!ur || payload.card_v3 !== true) return og;
  const which = payload.challenge && payload.art && payload.art.invite ? 'challenge' : payload.story ? null : view;
  return { ...og, title: urCount(og.title), desc: urCount(UR_DESC_ON[which] || og.desc) };
}

function ogTextOf(payload, view, brand) {
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
  // A story has no league table: its class view (/q/<code>/class) previews as the story below.
  if (view === 'class' && !(payload && payload.story)) {
    return {
      title: ur ? `${q.topic || ''} · ${label} کی لیگ ٹیبل` : `${q.topic || ''} · ${label} league table`,
      desc: ur ? 'ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے۔' : 'Not played yet? Same link, still open.',
    };
  }
  // A storybook the teacher sent (boot `story`, web_quiz_stories_teacher): a story to listen to and read, never "0 questions".
  if (payload && payload.story) {
    return {
      title: ur ? `${q.topic || ''} · ${label} کے لیے کہانی` : `${q.topic || ''} · a story for ${cls.label || 'your class'}`,
      desc: ur ? `${brand.mascot.ur} کے ساتھ سنیں اور پڑھیں` : `Listen and read along with ${brand.mascot.en}`,
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
const URDU_FONT = '/wq/fonts/wq-nastaliq-5.woff2';
// The polished Urdu look (app_settings web_quiz_ur_polish, carried as payload `ui.ur2`): a second face and ONE class on <html>.
const URDU_FONT_2 = '/wq/fonts/wq-nastaliq-6.woff2';
const ur2On = (ui, lang) => Boolean(ui && ui.ur2 === true && lang === 'ur');

// Every share picture and brand picture is a 1200x630 JPEG: the head says so, so the phone knows what it fetches.
function head({ lang, dir, title, desc, origin, url, assetV, brand, image, ui, imageType = 'image/jpeg' }) {
  const img = image || `${origin}${brand.og.image}`;
  // web_quiz_one_face on: ONE face for both looks, so the preload below names the polished one either way (urduLook).
  const { ur2, cls, URDU_FONT } = urduLook(ui, lang);
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"${cls}>
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
<meta property="og:image:type" content="${esc(imageType)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="${esc(WebQuizBrand.faviconHref(brand))}">${lang === 'ur' ? `\n<link rel="preload" href="${ur2 ? URDU_FONT_2 : URDU_FONT}" as="font" type="font/woff2" crossorigin>` : ''}
<link rel="stylesheet" href="/wq/wq.css?v=${assetV}">
<style id="wq-brand">${WebQuizBrand.cssVars(brand)}</style>`;
}

// One Urdu face per page (app_settings web_quiz_one_face, decided by the bot: its quiz, hub and challenge menu answers
// say `one_face: true`, carried to head() as `ui.uf`): the plain and the polished look both draw with the polished face
// (wq.css html.wq-uf), so a page whose head guessed the look wrong still fetches one face, and the plain face is never
// fetched as well. Off (the key absent, or anything but JSON true): today's class and preload, byte for byte.
function urduLook(ui, lang) {
  const ur2 = ur2On(ui, lang);
  if (!(ui && ui.uf === true)) return { ur2, cls: ur2 ? ' class="wq-ur2"' : '', URDU_FONT };
  return { ur2, cls: ` class="${ur2 ? 'wq-ur2 ' : ''}wq-uf"`, URDU_FONT: URDU_FONT_2 };
}
const oneFaceOn = (payload) => Boolean(payload && payload.one_face === true);
// The head reads the switch from `ui` (off: the payload itself, untouched).
const withOneFace = (payload) => (oneFaceOn(payload) ? { ...payload, ui: { ...(payload.ui || {}), uf: true } } : payload);
// What the shells that call no bot (library, closed, flush heads) keep of the last payload: the look and the one face.
function shellUi(body) {
  const ui = body.ui && body.ui.ur2 === true ? { ur2: true } : null;
  return oneFaceOn(body) ? { ...(ui || {}), uf: true } : ui;
}

// The sound + motion kit (app_settings web_quiz_juice, decided by the bot): its stylesheet and script, before the page's
// own script so window.WQJ is there when the page boots, only when the payload carries `juice: true`.
function juiceTags(payload) {
  if (!payload || payload.juice !== true) return '';
  return `<link rel="stylesheet" href="/wq/wq-juice.css?v=${challengeVersion('wq-juice.css')}">\n<script src="/wq/wq-juice.js?v=${challengeVersion('wq-juice.js')}" defer></script>\n`;
}

// Identity v2 (name first) lives in its own script, sent only to quizzes the server switched to it.
function identityV2(payload) {
  const id = payload && payload.cls && payload.cls.identity;
  return Boolean(id && id.mode === 'v2');
}

/**
 * The picture a link previews as: the shared card, the teacher's class link picture (when the bot names one), the
 * invite on a challenge code, the class view's table, the plain class link with ?v=<played> (the teacher's reminder:
 * the live class picture), else the brand's.
 * WhatsApp caches a preview per URL, so ?v rides into the picture URL too.
 */
function ogImageFor({ payload, code, view, origin, a, v, k }) {
  // A class quiz shared from the finish card (?k=<card token>, web_quiz_card_v3): the card's own picture.
  if (view === 'quiz' && cardToken(k)) return `${origin}/wq/card/${k}.png`;
  const art = (payload && payload.art) || {};
  const ver = typeof v === 'string' && /^[0-9]{1,10}$/.test(v) ? v : null;
  const pic = (kind, id) => (id ? `${origin}/q/${code}/art/${kind}.jpg?a=${encodeURIComponent(id)}${ver ? `&v=${ver}` : ''}` : null);
  // The teacher's class link (art.teach, only while the bot's switches are on): after a child's own card and the
  // teacher's reminder link, before today's.
  // A story's class view has no table either: it previews with the class link picture (the story's cover).
  const story = Boolean(payload && payload.story);
  const teachId = view === 'quiz' || (view === 'class' && story) ? artId(art.teach, 'teach') : null;
  const teach = teachId && typeof art.teach_v === 'string' && TEACH_V_RX.test(art.teach_v)
    ? `${origin}/q/${code}/art/teach.png?a=${encodeURIComponent(teachId)}&v=${art.teach_v}` : null;
  // The teacher's reminder link (?v=<played>) keeps its live class picture ahead of the class link picture. A story's
  // reminder keeps the story's own picture: the live class picture is a quiz scoreboard (played, average, top score).
  const live = ver && view === 'quiz' && !story ? pic('class', artId(art.class, 'class')) : null;
  return pic('card', artId(a, 'card'))
    || pic('invite', artId(art.invite, 'invite'))
    || live
    || teach
    || (view === 'class' && !story ? pic('class', artId(art.class, 'class')) : null)
    || (view === 'schools' ? pic('schools', artId(art.schools, 'schools')) : null);
}

// The quiz page in three parts (the head, the Jugnu boot frame, the boot JSON + scripts): renderQuizPage joins them;
// the fast first page sends the first two before the bot answers and the third when it does.
// The class table and the league (/q/<code>/class|schools) open in the link's ?lang (en|ur) when the bot's answer carries
// class_doors (app_settings web_quiz_class_doors): the payload's ui_lang. Any other page, no lang, or off: the payload as it came.
// The order is: the link's ?lang, then the child's stored language (storedLangOf), then the quiz's own (never EN by
// default). storedLangOf is the named seam the child-language resolver fills when it lands; until then it reads
// nothing and passes nothing.
function storedLangOf(_req) { return null; }
function uiLangOf(body, view, lang) {
  if (!body || body.class_doors !== true || (view !== 'class' && view !== 'schools') || (lang !== 'en' && lang !== 'ur')) return body;
  return { ...body, ui_lang: lang };
}

function quizPageParts({ payload, code, view, origin, assetV, url, a, v, k }) {
  const q = (payload && payload.quiz) || {};
  // ui_lang: the class table / league in the link's language (uiLangOf, web_quiz_class_doors); else the quiz's.
  const ul = payload && payload.ui_lang;
  const lang = ul === 'ur' || ul === 'en' ? ul : q.lang === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const brand = brandOf(payload && payload.brand);
  const og = ogText(payload, view, brand);
  const boot = { ...payload, code, view, brand };
  payload = withOneFace(payload);
  const image = ogImageFor({ payload, code, view, origin, a, v, k });
  return {
    lang, dir, ur2: ur2On(payload && payload.ui, lang), title: og.title, bootsay: BOOT_COPY[lang],
    head: head({ lang, dir, title: og.title, desc: og.desc, origin, url: url || `${origin}/q/${code}`, assetV, brand, image, ui: payload && payload.ui, ...cardType(image) }),
    frame: `<main id="wq" class="wq-app" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(BOOT_COPY[lang])}</p></div></main>`,
    tail: `<script id="boot" type="application/json">${bootJson(boot)}</script>
${juiceTags(payload)}${identityV2(payload) ? `<script src="/wq/wq-identity.js?v=${assetV}" defer></script>\n` : ''}<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-lib.js?v=${assetV}" defer></script>
${payload && payload.story ? `<script src="/wq/wq-story-link.js?v=${challengeVersion('wq-story-link.js')}" defer></script>\n` : ''}<script src="/wq/wq.js?v=${assetV}" defer></script>
</body>
</html>`,
  };
}

function renderQuizPage(args) {
  const p = quizPageParts(args);
  return `${p.head}
</head>
<body>
${p.frame}
${p.tail}`;
}

// ── Fast first page (the bot's payload carries `fast: true` while app_settings web_quiz_fast is on) ──────────────
// The head is drawn from what this edge already knows about the code (its link-preview facts), else English with
// the last brand; the page's scripts are preloaded so they download while the bot works. When the bot's page is
// another language/look than the guess, one inline line sets it before any script runs.
function renderQuizFlushTop({ facts, code, origin, assetV, url, brandKey, ui, a, v, k }) {
  const payload = facts ? { ...facts, ui } : { quiz: { lang: 'en' }, cls: {}, art: {}, brand: brandKey, ui };
  const p = quizPageParts({ payload, code, view: 'quiz', origin, assetV, url, a, v, k });
  const preload = ['wq-tel.js', 'wq-lib.js', 'wq.js'].map((f) => `<link rel="preload" href="/wq/${f}?v=${assetV}" as="script">`).join('\n');
  return { guess: p, html: `${p.head}\n${preload}\n</head>\n<body>\n${p.frame}\n` };
}

const jsStr = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// web_quiz_closed_inline ON: a closed page (the full document renderClosedPage made) as the tail of a streamed page whose
// head and boot frame are already sent: the page's language/direction/title are set, the boot frame becomes the closed
// card. One document load; the status is the stream's (200, the head went first).
function closedInlineTail(html) {
  const tag = /<html lang="(ur|en)" dir="(rtl|ltr)"( class="wq-ur2")?>/.exec(html);
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  const main = /<main id="wq"[\s\S]*<\/main>/.exec(html);
  if (!tag || !main) return null;
  const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return `<script>(function(h){h.lang=${jsStr(tag[1])};h.dir=${jsStr(tag[2])};h.className=${jsStr(tag[3] ? 'wq-ur2' : '')};document.title=${jsStr(title ? unesc(title[1]) : '')};var m=document.getElementById("wq");if(m)m.outerHTML=${jsStr(main[0])}})(document.documentElement)</script>
</body>
</html>`;
}

// What the page the bot answered differs in from the head already sent: one statement each, run before any script.
function flushFixes(guess, p) {
  const fix = [];
  if (p.lang !== guess.lang) fix.push(`h.lang=${jsStr(p.lang)}`);
  if (p.dir !== guess.dir) fix.push(`h.dir=${jsStr(p.dir)}`);
  if (p.ur2 !== guess.ur2) fix.push(p.ur2 ? 'h.classList.add("wq-ur2")' : 'h.classList.remove("wq-ur2")');
  if (p.bootsay !== guess.bootsay) fix.push(`var b=document.querySelector(".wq-bootsay");if(b)b.textContent=${jsStr(p.bootsay)}`);
  if (p.title !== guess.title) fix.push(`document.title=${jsStr(p.title)}`);
  return fix;
}

function renderQuizFlushTail({ guess, payload, code, origin, assetV, url, a, v, k }) {
  const p = quizPageParts({ payload, code, view: 'quiz', origin, assetV, url, a, v, k });
  const fix = flushFixes(guess, p);
  return `${fix.length ? `<script>(function(h){${fix.join(';')}})(document.documentElement)</script>\n` : ''}${p.tail}`;
}

// Anything but a quiz after the head went (closed, unknown, the bot away): the page asks again the old way (nf=1),
// which answers with today's status and page.
const FLUSH_AGAIN = `<script>location.replace(location.pathname+(location.search?location.search+"&":"?")+"nf=1"+location.hash)</script>
</body>
</html>`;

// The finish card's picture is a PNG; every other share picture is a JPEG (head's default).
const cardType = (image) => (image && (/\/wq\/card\/[A-Za-z0-9_-]+\.png$/.test(image) || /\/art\/teach\.png\?/.test(image)) ? { imageType: 'image/png' } : {});

/**
 * A shared finish card (/k/<t>): the og head names the card's picture; the page shows it with ONE way in, this
 * bot's chat with the return words typed (the bot's /quiz then opens the child's own home). No script, no boot.
 */
// The one share's landing (web_quiz_share_v4 tokens: facts.v4): the card, the activity's mark in its colour, who did
// what, and ONE big way in — the bot's chat with the return words typed (with no bot number: WhatsApp with the words
// typed, the friend picks the chat), never a page without a door.
const CARD_LANDING = {
  en: { sub: 'Join in and play it too!', hint: 'Tap the green button, then press send in WhatsApp.' },
  ur: { sub: 'آپ بھی آئیں اور کھیلیں!', hint: 'سبز بٹن دبائیں، پھر واٹس ایپ میں بھیجنے کا بٹن دبائیں۔' },
};
function renderCardPageV4({ facts, token, origin, url, brandKey, oneFace }) {
  const lang = facts.lang === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const brand = brandOf(brandKey);
  const img = `${origin}/wq/card/${token}.png`;
  const title = facts.first ? `${facts.first}: ${facts.deed_text}` : facts.deed_text;
  const ret = facts.ret || {};
  const c = CARD_LANDING[lang];
  const accent = /^#[0-9A-Fa-f]{6}$/.test(String(facts.accent || '')) ? facts.accent : '#15803D';
  const href = ret.href && /^https:\/\/wa\.me\/\d{10,15}\?text=[^"<>\s]+$/.test(ret.href) ? ret.href : `https://wa.me/?text=${encodeURIComponent(ret.words || '')}`;
  // what the card lands on, by name (its book's title, its video's lesson), in its own script
  // Urdu is drawn at the Regular weight (a bold Nastaliq breaks joins: «پڑھی» as «پڑ ھی»); the name is its own line.
  const item = facts.item_title ? `<p class="it"><bdi>${esc(String(facts.item_title).slice(0, 80))}</bdi></p>` : '';
  const go = `<a class="wq-btn wq-go" data-primary data-tap="card_return" href="${esc(href)}">${esc(ret.cta || '')}</a><p class="hint">${esc(c.hint)}</p>`;
  return `${head({ lang, dir, title, desc: ret.text || '', origin, url, assetV: '', brand, image: img, imageType: 'image/png', ui: oneFace ? { uf: true } : null }).replace(/\n<link rel="stylesheet"[^>]*>/, '')}
<style>body{margin:0;background:#FFF8E7;font-family:system-ui,sans-serif;color:#1F2937}.k{max-width:560px;margin:0 auto;padding:16px;display:grid;gap:14px;box-sizing:border-box}
.k img{width:100%;height:auto;border-radius:20px;box-shadow:0 6px 0 ${accent}33,0 2px 10px rgba(15,23,42,.12)}.mark{justify-self:start;padding:4px 14px;border-radius:999px;background:${accent};color:#fff;font-weight:800;font-size:16px}
.k h1{margin:0;font-size:24px;line-height:${lang === 'ur' ? 2 : 1.25};color:${accent}}.k .it{font-weight:800;font-size:21px;color:#1F2937}.k p{margin:0;font-size:19px;line-height:${lang === 'ur' ? 2 : 1.4}}.k .hint{font-size:15px;color:#475569;text-align:center}
.wq-btn{display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;border-radius:18px;background:#15803D;color:#fff;font-weight:800;font-size:22px;text-decoration:none;min-height:60px;box-shadow:0 5px 0 #14532D}
.wq-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #14532D}.k h1 .nm{display:block}${lang === 'ur' ? `
.k h1,.k .it,.mark,.wq-btn{font-weight:400}` : ''}</style>
</head>
<body><main class="k" data-screen="card_landing" data-v="4"><span class="mark" dir="auto">${esc(facts.mark || '')}</span><img src="${esc(img)}" alt="${esc(title)}" width="1200" height="630"><h1 dir="${dir}">${facts.first ? `<bdi class="nm">${esc(facts.first)}</bdi>` : ''}${esc(facts.deed_text)}</h1>${item}<p>${esc(c.sub)}</p>${go}</main></body>
</html>`;
}

function renderCardPage({ facts, token, origin, url, brandKey, oneFace = false }) {
  if (facts && facts.v4 === true) return renderCardPageV4({ facts, token, origin, url, brandKey, oneFace });
  const lang = facts.lang === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const brand = brandOf(brandKey);
  const img = `${origin}/wq/card/${token}.png`;
  const title = facts.first ? `${facts.first}: ${facts.deed_text}` : facts.deed_text;
  const ret = facts.ret || {};
  const go = ret.href && /^https:\/\/wa\.me\/\d{10,15}\?text=[^"<>\s]+$/.test(ret.href)
    ? `<a class="wq-btn wq-go" data-primary data-tap="card_return" href="${esc(ret.href)}">${esc(ret.cta || '')}</a>` : '';
  return `${head({ lang, dir, title, desc: ret.text || '', origin, url, assetV: '', brand, image: img, imageType: 'image/png', ui: oneFace ? { uf: true } : null }).replace(/\n<link rel="stylesheet"[^>]*>/, '')}
<style>body{margin:0;background:#FFF8E7;font-family:system-ui,sans-serif;color:#1F2937}.k{max-width:560px;margin:0 auto;padding:16px;display:grid;gap:16px}
.k img{width:100%;height:auto;border-radius:16px}.k p{margin:0;font-size:20px;line-height:${lang === 'ur' ? 2 : 1.4}}
.wq-btn{display:block;text-align:center;padding:16px;border-radius:14px;background:#15803D;color:#fff;font-weight:700;font-size:20px;text-decoration:none;min-height:56px}</style>
</head>
<body><main class="k" data-screen="card_landing"><img src="${esc(img)}" alt="${esc(title)}" width="1200" height="630"><p>${esc(ret.text || '')}</p>${go}</main></body>
</html>`;
}

/**
 * The streamed page's wire (web-quiz-stream.js): compressed, the head sent at once. Always a 200: a revisit gets the
 * head at once too (an early paint beats a 304 that waits for the bot). `page(tail)` ends with the quiz/hub,
 * `again()` with FLUSH_AGAIN.
 */
function flushWire(req, res, top) {
  const out = Stream.open(req, res);
  out.write(top);
  // `again(inline)`: web_quiz_closed_inline ON passes the closed page's tail (closedInlineTail) instead of the ask-again line.
  return { again: (inline) => out.end(inline || FLUSH_AGAIN), page: (tail) => out.end(tail) };
}

/**
 * A link-preview fetch's answer: the quiz page's own head (og tags, lang, dir) from the facts the edge
 * remembered, and an empty body. A crawler reads only the head; no quiz payload travels in it.
 */
function renderPreviewPage({ facts, code, view, origin, assetV, url, a, v, k }) {
  const lang = facts.quiz.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(facts.brand);
  const og = ogText(facts, view, brand);
  const image = ogImageFor({ payload: facts, code, view, origin, a, v, k });
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title: og.title, desc: og.desc, origin, url, assetV, brand, image, ...cardType(image) })}
</head>
<body></body>
</html>`;
}

// M4a hub — the kid hub page: the same head and brand as the quiz page, its own script.
const HUB_TITLE = { en: 'Your quizzes and videos', ur: 'آپ کے کوئز اور ویڈیوز' };
const HUB_BOOT = { en: 'Opening…', ur: 'کھل رہا ہے…' };

// keep my place: the card's script and styles, only when the bot's hub JSON carries `bind` (web_quiz_phone_bind on).
function bindTags(payload, assetV) {
  if (!payload || !payload.bind) return '';
  return `<link rel="stylesheet" href="/wq/wq-bind.css?v=${assetV}">\n<script src="/wq/wq-bind.js?v=${assetV}" defer></script>\n`;
}

// The v3 child home: its stylesheet and script, only when the bot's hub JSON carries `home_v3` (web_quiz_home_v3 on).
// With `home_fb` (web_quiz_home_fallback_v3) the script is a preload of the same address instead: a hung request then
// cannot hold hub.js back (deferred scripts run in order), and hub.js's own ask, with its 5 s wait, retry and plain
// home, reuses the preloaded bytes. Same href, same `as`, no crossorigin: any other preload of it shares the download.
function homeTags(payload, assetV) {
  if (!payload || !payload.home_v3) return '';
  if (payload.home_fb) return `<link rel="stylesheet" href="/wq/wq-home.css?v=${assetV}">\n<link rel="preload" href="/wq/wq-home.js?v=${assetV}" as="script">\n`;
  return `<link rel="stylesheet" href="/wq/wq-home.css?v=${assetV}">\n<script src="/wq/wq-home.js?v=${assetV}" defer></script>\n`;
}

// The read-along preview (#listen/<pid>): its script, before hub.js, only when the bot's hub JSON says `listen: true`
// (web_quiz_readalong on, the hub's own phone). Its own version (the preview and the player it loads), so the hub's
// version and page stay today's while the switch is off.
let listenV = null;
function listenVersion() {
  if (listenV) return listenV;
  const h = crypto.createHash('sha256');
  for (const f of ['wq-readalong-listen.js', 'wq-readalong.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  return (listenV = h.digest('hex').slice(0, 10));
}
// The live reading meter (wq-pace.js / .css): only when the bot names its variant (`pace`, web_quiz_live_meter under
// live reading v3). Its own version, so the hub's and the Challenge's versions and pages stay today's while it is off.
let paceV = null;
function paceVersion() {
  if (paceV) return paceV;
  const h = crypto.createHash('sha256');
  for (const f of ['wq-pace.js', 'wq-pace.css']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (_) { /* absent in some tests */ }
  }
  return (paceV = h.digest('hex').slice(0, 10));
}
function paceTag(payload) {
  const m = payload && (payload.pace === 'sky' || payload.pace === 'vine') ? payload.pace : null;
  if (!m) return '';
  // the Challenge's menu carries the child's form (G1…G5): the meter fills at that grade's pace (none ⇒ the kinder G1–2)
  const g = payload && typeof payload.form === 'string' && /^[A-Za-z0-9-]{1,8}$/.test(payload.form) ? ` data-grade="${payload.form}"` : '';
  return `<link rel="stylesheet" href="/wq/wq-pace.css?v=${paceVersion()}">\n<script src="/wq/wq-pace.js?v=${paceVersion()}" data-meter="${m}"${g} defer></script>\n`;
}
function listenTag(payload) {
  return payload && payload.listen === true ? `<script src="/wq/wq-readalong-listen.js?v=${listenVersion()}" defer></script>\n` : '';
}

// The hub page in parts (the head, the install manifest's href or null, the Jugnu frame, the boot JSON + scripts):
// renderHubPage joins them; the fast first page sends the head and the frame before the bot answers.
function hubPageParts({ payload, token, origin, assetV }) {
  const lang = payload && payload.lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(payload && payload.brand);
  const boot = { ...payload, token, view: 'hub', brand };
  payload = withOneFace(payload);
  // The Jugnu corner (bot web-quiz-hub-play.js): its script, and the install manifest, only when the bot sent `play`.
  const play = payload && payload.play && typeof payload.play === 'object' ? payload.play : null;
  // The home's own tags (one string, so the head's preloads name the tail's addresses: web-quiz-home-preload.js). A bot
  // answer (it has `kids`) teaches the next early head what to preload (web_quiz_home_preload); the early head's guess
  // (no `kids`) carries what was learned. Off: learn() keeps nothing and head() is ''.
  const tags = `${bindTags(payload, assetV)}${homeTags(payload, assetV)}${play ? `<script src="/wq/hub-play.js?v=${assetV}" defer></script>\n` : ''}${listenTag(payload)}${paceTag(payload)}`;
  const answer = Boolean(payload && Array.isArray(payload.kids));
  if (answer) HomePre.learn(payload, tags, assetV);
  return {
    lang, dir: lang === 'ur' ? 'rtl' : 'ltr', ur2: ur2On(payload && payload.ui, lang), title: HUB_TITLE[lang], bootsay: HUB_BOOT[lang],
    head: `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title: HUB_TITLE[lang], desc: HUB_TITLE[lang], origin, url: origin, assetV, brand, ui: payload && payload.ui })}${answer ? '' : HomePre.head()}`,
    manifest: play && play.install ? `/h/${esc(token)}/manifest.webmanifest${payload.kid && /^[0-9a-f]{16}$/.test(payload.kid) ? `?kid=${payload.kid}` : ''}` : null,
    // web_quiz_wait_ux on (the bot's `wait_ux`): the progress bar and Jugnu's waiting moment ride the frame (web-quiz-wait-ux.js)
    frame: `<main id="wq" class="wq-app wq-hub" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(HUB_BOOT[lang])}</p></div></main>${WaitUx.tag(payload)}`,
    tail: `<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
${tags}<script src="/wq/hub.js?v=${assetV}" defer></script>
</body>
</html>`,
  };
}

function renderHubPage(args) {
  const p = hubPageParts(args);
  return `${p.head}
${p.manifest ? `<link rel="manifest" href="${p.manifest}">\n` : ''}</head>
<body>
${p.frame}
${p.tail}`;
}

// Fast first page for the hub: the head guessed from the phone's language and the last brand/look, the scripts
// preloaded, the Jugnu frame; then the corrections (and the install manifest) and today's tail when the bot answers.
function renderHubFlushTop({ lang, token, origin, assetV, brandKey, ui, waitUx = false, waitShare = false }) {
  const p = hubPageParts({ payload: { lang, brand: brandKey, ui, ...(waitUx ? { wait_ux: true } : {}), ...(waitUx && waitShare ? { wait_share: true } : {}) }, token, origin, assetV });
  const preload = ['wq-tel.js', 'hub.js'].map((f) => `<link rel="preload" href="/wq/${f}?v=${assetV}" as="script">`).join('\n');
  return { guess: p, html: `${p.head}\n${preload}\n</head>\n<body>\n${p.frame}\n` };
}

function renderHubFlushTail({ guess, payload, token, origin, assetV }) {
  const p = hubPageParts({ payload, token, origin, assetV });
  const fix = flushFixes(guess, p);
  if (p.manifest) fix.push(`var m=document.createElement("link");m.rel="manifest";m.href=${jsStr(p.manifest)};document.head.appendChild(m)`);
  // web_quiz_wait_ux on, but this portal process flushed the frame before it learnt so (each process learns from its own
  // last hub answer): the piece rides the tail instead, still before the page's scripts, so it is on the page once.
  const lateWait = WaitUx.on(payload) && !String(guess.frame || '').includes(WaitUx.TAG) ? WaitUx.TAG : '';
  return `${fix.length ? `<script>(function(h){${fix.join(';')}})(document.documentElement)</script>\n` : ''}${lateWait}${p.tail}`;
}

// M4b library: the video library opened from the kid's hub (/lib/<hub token>?kid=<chip>&l=<lang>).
// A shell only: wq-lib.js asks the bot for the library with the hub token, so the edge calls nothing.
const LIB_TITLE = { en: 'Video library', ur: 'ویڈیو لائبریری' };
function renderLibPage({ hub, kid, lang, origin, assetV, brandKey, rt = false, ui = null }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME }));
  const boot = { view: 'lib', hub, kid, lang: l, brand: Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, brandKey) ? brandKey : null, rt: rt === true };
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title: LIB_TITLE[l], desc: LIB_TITLE[l], origin, url: origin, assetV, brand, ui })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><div id="wql-root" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"></div></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-lib.js?v=${assetV}" defer></script>
</body>
</html>`;
}

// A closed class link's way home (the bot's known/home, web_quiz_link_known_child): only a hub path of this shape is drawn.
const CLOSED_HOME_RX = /^\/h\/[A-Za-z0-9._-]{16,700}\?from=link$/;
// How long a closed class link waits for the bot's answer about this phone's home before it is drawn without one.
const HOME_WAIT_MS = 1500;
/**
 * The closed page: kind 'hub' (an expired or forged child home link), 'closed' (a closed quiz / challenge link) or
 * 'off' (the service is not open right now). `back` (an href, given only while web_quiz_closed_way_back is ON) adds ONE tap back
 * to WhatsApp under the line on a 'hub' or 'closed' page, its words the signed sentence; 'off' never has one. `home` (given
 * only while web_quiz_link_known_child is ON, on a closed class link) is {href} = this phone's home, or {href: null} = a phone
 * that holds nobody. At most ONE button: a home of the right shape wins over the tap; with no home, the tap; with neither,
 * {href: null} adds the "/quiz on WhatsApp" line. Without `back` and `home` the page is byte for byte today's.
 */
function renderClosedPage({ lang, kind, origin, assetV, brandKey, ui = null, back = null, home }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME }));
  const c = CLOSED_COPY[l];
  const title = kind === 'off' ? c.off : kind === 'hub' ? c.hub : c.title;
  const say = kind === 'off' ? c.offSay : kind === 'hub' ? c.hubSay : c.say;
  const tap = typeof back === 'string' && back && kind !== 'off'
    ? `\n<a class="wq-btn wq-go" href="${esc(back)}" data-tap="open_whatsapp">${esc(ChatTap.backText(l))}</a>` : '';
  const homeBtn = home && kind === 'closed' && typeof home.href === 'string' && CLOSED_HOME_RX.test(home.href)
    ? `\n<a class="wq-btn wq-go" href="${esc(home.href)}">${esc(c.homeBtn)}</a>` : '';
  const line = home && kind === 'closed' ? `\n<p class="wq-sub">${esc(c.hubSay)}</p>` : '';
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title, desc: say, origin, url: origin, assetV, brand, ui })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><section class="wq-screen wq-closed">
<img class="wq-jugnu" src="/wq/jugnu_sleep.webp" alt="" width="160" height="160">
<h1>${esc(title)}</h1>
<p class="wq-sub">${esc(say)}</p>${homeBtn || tap || line}
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
 * PDF; with `timing` when the bot sent its timing headers, `disposition` when it named a download, and `security` when it
 * sent a page security header). Throws { unreachable: true } when the bot cannot be reached.
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

// The bot's own timing on a teacher report page (x-render-ms, x-queue-age; sent only with web_quiz_events_v2 on):
// whole numbers only, else not passed on. null when the bot sent neither.
const TIMING_RX = /^\d{1,7}$/;
function timingOf(res) {
  const one = (h) => { const v = res.headers && res.headers.get ? res.headers.get(h) : null; return typeof v === 'string' && TIMING_RX.test(v) ? v : null; };
  const t = { render: one('x-render-ms'), queue: one('x-queue-age') };
  return t.render != null || t.queue != null ? t : null;
}

const defaultLogEvent = (e, p) => { try { require('../services/telemetry.service').logEvent(e, p); } catch (_) { /* never decides a response */ } };

function createBotClient({ botUrl, apiKey, fetchImpl, logEvent = defaultLogEvent, now = Date.now, timeoutMs = BOT_TIMEOUT_MS }) {
  // One line per call that fails or is slow (web_quiz.bot_call): the 502 a child sees has its reason on record.
  const record = (method, route, t0, fields) => {
    try { logEvent('web_quiz.bot_call', { route, method, ms: now() - t0, ...fields }); } catch (_) { /* never decides a response */ }
  };
  return async function callBot(method, pathname, req, body, { raw = false, route = null, device = null } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const t0 = now();
    const where = route || botRouteOf(pathname);
    try {
      const headers = { 'x-api-key': apiKey, 'x-forwarded-for': clientIp(req), accept: raw ? '*/*' : 'application/json' };
      const ua = req.get('user-agent');
      if (ua) headers['user-agent'] = ua.slice(0, 300);
      // This phone's device_ref (the wq_dv cookie the hub page writes): a hub link opens nothing as a child on another phone.
      // (`device`: a ref the caller just gave this phone, before its cookie comes back)
      const dv = device || deviceCookie(req);
      if (dv) headers['x-wq-device'] = dv;
      const init = { method, headers, redirect: 'manual' };
      if (controller) init.signal = controller.signal;
      if (method !== 'GET') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body || {});
      }
      const res = await fetchImpl(`${botUrl}${pathname}`, init);
      // The bot's Server-Timing items (only sent with a timing switch on), only those on the shared list; else none.
      const steps = TimingNames.clean(res.headers && res.headers.get ? res.headers.get('server-timing') : null);
      if (res.status >= 500 && res.status !== 503) record(method, where, t0, { outcome: 'upstream_5xx', status: res.status, ...(steps ? { steps } : {}) });
      else if (now() - t0 >= BOT_SLOW_MS) record(method, where, t0, { outcome: 'slow', status: res.status, ...(steps ? { steps } : {}) });
      const location = res.headers && res.headers.get ? res.headers.get('location') : null;
      // A picture the bot answers as bytes (a cropped option, an inline option picture) is passed
      // through as that picture: parsing it as JSON turned every one into "{}" (a blank tile).
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if ((raw || (res.status >= 200 && res.status < 300 && /^image\//i.test(type))) && res.arrayBuffer) {
        const timing = timingOf(res);
        const disposition = raw && res.headers && res.headers.get ? res.headers.get('content-disposition') : null; // a report PDF's name
        const serverTiming = raw && res.headers && res.headers.get ? res.headers.get('server-timing') : null; // the teacher home's, as sent
        // The bot's own page security headers (CSP, nosniff, X-Frame-Options, Referrer-Policy) for the relays to carry
        // when quiz_edge_security_headers is on (edge-security-headers.js); absent when the bot sent none.
        const security = raw ? securityOf(res.headers) : null;
        return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), contentType: type, location, ...(timing ? { timing } : {}), ...(disposition ? { disposition } : {}), ...(serverTiming ? { serverTiming } : {}), ...(security ? { security } : {}) };
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      // `steps`: the bot's timing items (web_quiz_server_timing on its hub answer). Off: today's result.
      return { status: res.status, body: json, location, ...(steps ? { steps } : {}) };
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
  return `${head({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', title, desc: title, origin, url: `${origin}/c/`, assetV, brand, ui: menu && menu.ui })}
</head>
<body>
<main id="wq" class="wq-app wqc" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(CH_COPY[lang].boot)}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
${juiceTags(menu)}<script src="/wq/wq-tel.js?v=${assetV}" defer></script>
<script src="/wq/wq-read-live.js?v=${challengeVersion('wq-read-live.js')}" defer></script>
${menu && menu.lr3 ? `<link rel="stylesheet" href="/wq/wq-liveread.css?v=${challengeVersion('wq-liveread.css')}">\n<script src="/wq/wq-liveread.js?v=${challengeVersion('wq-liveread.js')}" defer></script>\n` : ''}${menu && menu.lr3 ? paceTag(menu) : ''}${menu && menu.v2 && menu.card_v3 === true ? `<script src="/wq/wq-finish-card.js?v=${challengeVersion('wq-finish-card.js')}" defer></script>\n` : ''}${menu && menu.read_feedback === true ? `<link rel="stylesheet" href="/wq/wq-moment.css?v=${challengeVersion('wq-moment.css')}">\n<script src="/wq/wq-moment.js?v=${challengeVersion('wq-moment.js')}" defer></script>\n` : ''}${menu && menu.v2 ? `<script src="/wq/wq-trail.js?v=${challengeVersion('wq-trail.js')}" defer></script>\n` : ''}<script src="/wq/wq-challenge.js?v=${chV}" defer></script>
</body>
</html>`;
}

// The pick_kid note's way back: the Challenge page's own Home label (wq-challenge.js homeBtn), to the hub of the token.
const CH_HOME = { en: 'Home', ur: 'ہوم' };

function renderChallengeNote({ lang, why, origin, assetV, brandKey, ui = null, hub = null }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const brand = brandOf(brandKey);
  const title = CH_COPY[l].title(brand.mascot[l]);
  return `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title, desc: title, origin, url: origin, assetV, brand, ui })}
</head>
<body>
<main id="wq" class="wq-app"><div class="wq-bar wq-topbar">${lockupHtml(brand, l)}</div><section class="wq-screen wq-closed">
<img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="160" height="160">
<h1>${esc(title)}</h1>
<p class="wq-sub">${esc(CH_COPY[l][why] || '')}</p>
${hub ? `<a class="wq-home" href="/h/${encodeURIComponent(hub)}"><span aria-hidden="true">🏠</span><span class="wq-homet">${esc(CH_HOME[l])}</span></a>\n` : ''}</section></main>
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
  let lastUi = null;   // the last payload's `ui` (the Urdu polish switch), for the shells that call no bot
  let lastFast = false; // the last quiz payload's `fast` (app_settings web_quiz_fast): send the page's head first
  let lastWaitUx = false; // the last hub answer's `wait_ux` (app_settings web_quiz_wait_ux): the flushed frame's progress bar
  let lastWaitShare = false; // and its `wait_share` (web_quiz_hub_fanout on too): the frame's read share

  // Link previews (web-quiz-preview.js): what the edge last learned about each code, and the drawn pictures.
  const now = opts.now || Date.now;
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, logEvent, now, timeoutMs: opts.botTimeoutMs || BOT_TIMEOUT_MS });
  const ogKnown = Preview.ttlCache({ max: 2000, now });
  const artKept = Preview.ttlCache({ max: 200, now });

  // web_quiz_closed_way_back (app_settings, default OFF): ON → a 'hub' / 'closed' page carries ONE tap back to
  // WhatsApp. Read from the cache only (lib/closed-way-back-switch.js peek: never waits, a cold or failed read is OFF =
  // today's page). `opts.wayBackOn(req)` stands in for the read (tests).
  const wayBackOn = typeof opts.wayBackOn === 'function'
    ? opts.wayBackOn
    : (req) => WayBackSwitch.peek(req && req.app && req.app.locals ? req.app.locals.supabase : null);
  // This deployment's number for the tap (WHATSAPP_BOT_NUMBER, else REFERRAL_BOT_NUMBER, digits only — the same
  // rule as quiz-go.routes botNumber()); none → the app's own link (chat-tap.js).
  const backFor = (req) => {
    try {
      if (wayBackOn(req) !== true) return null;
      return ChatTap.chatHref(String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '') || null);
    } catch (_) { return null; }
  };
  // A closed class link's way home (web_quiz_link_known_child): asked only when the bot's closed answer says `known: true`
  // (the switch is on) and the phone has its wq_dv cookie. {href} (the bot minted this phone's home), {href: null} (a phone
  // with no cookie, or the bot's own "nobody"), or undefined (switch off, or no answer within HOME_WAIT_MS: today's page, or
  // the tap when web_quiz_closed_way_back is ON). A slow bot never holds the page longer than that.
  const homeFor = async (req, closed) => {
    if (!(closed && closed.known === true)) return undefined;
    if (!deviceCookie(req)) return { href: null };
    let timer = null;
    try {
      const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), HOME_WAIT_MS); });
      const h = await Promise.race([callBot('POST', '/api/internal/wq/known/home', req, {}), late]);
      if (h && h.status === 200 && h.body && h.body.on === true) return { href: typeof h.body.home === 'string' ? h.body.home : null };
    } catch (_) { /* no answer */ } finally { if (timer) clearTimeout(timer); }
    return undefined;
  };
  // ON: the page speaks the LINK's language before the phone's (?lang=, then the token's own lang, then today's choice)
  const closedHtml = (req, args) => {
    const back = backFor(req);
    return renderClosedPage(back ? { ...args, lang: ChatTap.linkLang(req) || args.lang, back } : { ...args, back });
  };

  // web_quiz_closed_inline (app_settings, default OFF, JSON true only): ON -> a streamed child page whose link turns out
  // closed answers the closed page in the same stream, not by asking again. Read from the cache only (never waits).
  // `opts.closedInlineOn(req)` stands in for the read (tests). The page is always closedHtml's (the tap and the language).
  const closedInlineOn = typeof opts.closedInlineOn === 'function'
    ? opts.closedInlineOn
    : (req) => ClosedInlineSwitch.peek(req && req.app && req.app.locals ? req.app.locals.supabase : null);
  const inlineClosed = (req, args) => {
    try { return closedInlineOn(req) === true ? closedInlineTail(closedHtml(req, args)) : null; } catch (_) { return null; }
  };

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
    // a storybook's page and question events: ~30 a book, per child link
    stories: rateLimit({ ...common, max: 200, keyGenerator: (req) => `sh:${String((req.params && req.params.token) || clientIp(req)).slice(0, 200)}` }),
    // a story page's one-read speech key, per hub link (a class shares one school IP): 20 a minute is a sentence every 3 s
    lrKey: rateLimit({ ...common, max: 20, keyGenerator: (req) => `lr:${(req.body && typeof req.body.st === 'string' && req.body.st.slice(0, 200)) || clientIp(req)}` }),
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

  // With app_settings web_quiz_brotli on: br scripts/styles, a day for unversioned files, versioned Jugnu pictures (web-quiz-static.js).
  router.use(require('./web-quiz-static').createWqStatic({ publicDir: PUBLIC_DIR, on: opts.brotliOn }));
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
        if (r.cache && out.status === 200) res.set('Cache-Control', r.cache);
        if (out.status >= 500 && out.status !== 503) return res.status(502).json({ error: 'upstream_error' });
        return res.status(out.status).json(out.body == null ? {} : out.body);
      } catch (err) {
        return res.status(502).json({ error: 'bot_unreachable' });
      }
    });
  }
  // ── standing class link /j/<code> (web_quiz_class_link, decided by the bot): web-quiz-class-link.js ──
  let clV = null;
  const pageHeadersCl = (res) => res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
  require('./web-quiz-class-link').registerClassLink(router, {
    callBot, limiters, unknownCode, jsonBody, noStore, configured, ready: () => Boolean(botUrl && apiKey), pageHeaders: pageHeadersCl, originOf,
    version, jsVersion: () => clV || (clV = challengeVersion('class-link.js')), brand: () => brandOf(lastBrand), ui: () => lastUi, head, esc, bootJson, isPreviewFetch: (req) => Preview.isPreviewFetch(req),
    closedPage: (req, res, status, kind) => res.status(status).type('html').send(closedHtml(req, { lang: 'en', kind, origin: originOf(req), assetV: version(), brandKey: lastBrand, ui: lastUi })),
  });
  // ── end standing class link ──
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
    const b0 = Date.now();
    pageHeaders(res);
    const origin = originOf(req);
    const code = String(req.params.code || '');
    if (!CODE_RX.test(code)) return res.status(404).type('html').send(closedHtml(req, { lang: 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    if (!botUrl || !apiKey) return res.status(503).type('html').send(closedHtml(req, { lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
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
        if (f.status === 200 && f.body && f.body.quiz) { known = f.body; ogKnown.set(upper, known, ogKeepMs(known)); }
      } catch (_) { /* the full path below */ }
    }
    if (known && !(view === 'class' && known.invited)) {
      return res.status(200).type('html').send(renderPreviewPage({ facts: known, code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v, k: req.query.k }));
    }
    // Fast first page: the head and the Jugnu frame now, the quiz when the bot answers (never on a teacher's preview
    // link, never on a link-preview fetch: a crawler gets the preview page below, never the quiz).
    const flush = lastFast && view === 'quiz' && !p && !preview && req.query.nf !== '1'
      ? renderQuizFlushTop({ facts: ogKnown.get(upper), code: upper, origin, assetV: version(), url, brandKey: lastBrand, ui: lastUi, a: req.query.a, v: req.query.v, k: req.query.k })
      : null;
    const wire = flush ? flushWire(req, res, flush.html) : null;
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/quiz/${upper}${p}`, req);
    } catch (_) {
      if (flush) return wire.again(inlineClosed(req, { lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
      return res.status(502).type('html').send(closedHtml(req, { lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    }
    if (flush && !(out.status === 200 && out.body && out.body.quiz)) {
      const contract = (out.status === 404 || out.status === 410) && out.body && typeof out.body.error === 'string';
      // a closed answer with `known: true` (web_quiz_link_known_child) asks again: the nf=1 page draws this phone's way home
      if (contract && out.body.known === true) return wire.again(null);
      return wire.again(inlineClosed(req, { lang: out.body && out.body.lang === 'ur' ? 'ur' : 'en', kind: contract ? 'closed' : 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    }
    // A friend's challenge code has no class page: the class table is the challenger's classmates'.
    if (view === 'class' && out.status === 200 && out.body && out.body.invited) {
      return res.status(404).type('html').send(closedHtml(req, { lang: out.body.quiz && out.body.quiz.lang === 'ur' ? 'ur' : 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    }
    if (out.status === 200 && out.body && out.body.quiz) {
      if (Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, out.body.brand)) lastBrand = out.body.brand;
      if (typeof out.body.rt === 'boolean') lastRt = out.body.rt;
      lastUi = shellUi(out.body);
      lastFast = out.body.fast === true;
      if (!p) { const facts = Preview.ogFacts(out.body); ogKnown.set(upper, facts, ogKeepMs(facts)); }
      // Step timings (the bot's answer carried them: web_quiz_server_timing on), as on the hub page: the flushed page's
      // ride its boot JSON (`st`); a page whose headers have not gone yet says them as one Server-Timing: this edge's
      // wait for the bot, the bot's items, this page's render. Off: no `st`, and the page and its headers are today's.
      // `st` here = step timings, not the session token (no page script reads the boot's `st`: a source-scan row pins it)
      if (flush) return wire.page(renderQuizFlushTail({ guess: flush.guess, payload: out.steps ? { ...out.body, st: out.steps } : out.body, code: upper, origin, assetV: version(), url, a: req.query.a, v: req.query.v, k: req.query.k }));
      if (preview) {
        return res.status(200).type('html').send(renderPreviewPage({ facts: Preview.ogFacts(out.body), code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v, k: req.query.k }));
      }
      const render = () => renderQuizPage({ payload: uiLangOf(out.body, view, req.query.lang || storedLangOf(req)), code: upper, view, origin, assetV: version(), url, a: req.query.a, v: req.query.v, k: req.query.k });
      if (!out.steps) return res.status(200).type('html').send(render());
      const edgeMs = Date.now() - b0;
      const r0 = process.hrtime.bigint();
      const html = render();
      const renderMs = Math.round(Number(process.hrtime.bigint() - r0) / 1e6);
      TimingNames.appendTiming(res, TimingNames.clean([`edge;dur=${edgeMs}`, out.steps, `render;dur=${renderMs}`].join(', ')));
      return res.status(200).type('html').send(html);
    }
    const lang = out.body && out.body.lang === 'ur' ? 'ur' : 'en';
    // A 404/410 is "closed" only when it is the contract's answer; a bare 404 means the bot
    // endpoint is not deployed yet, which is "not open right now", not the child's fault.
    const contractAnswer = out.body && typeof out.body.error === 'string';
    if ((out.status === 404 || out.status === 410) && contractAnswer) {
      // A phone that holds a child (web_quiz_link_known_child; the bot reads this phone's wq_dv as x-wq-device): its way home.
      const home = await homeFor(req, out.body);
      // a page that carries this phone's home (a hub token) is never kept by a cache, as the hub page's own token
      if (home && typeof home.href === 'string' && CLOSED_HOME_RX.test(home.href)) {
        res.set('Cache-Control', 'private, no-store');
        logEvent('web_quiz.door_shown', { door: 'link_home', surface: 'closed', w: 'e' });   // the button is on this page
      }
      return res.status(out.status).type('html').send(closedHtml(req, { lang, kind: 'closed', origin, assetV: version(), brandKey: lastBrand, ui: lastUi, home }));
    }
    return res.status(out.status === 503 || out.status === 404 ? 503 : 502).type('html').send(closedHtml(req, { lang, kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
  }

  router.get('/q/:code', limiters.read, unknownCode, (req, res) => page(req, res, 'quiz'));
  // M4a hub — GET /h/:token, the kid hub (WhatsApp /quiz link), server-rendered like /q/:code.
  // The hub's web manifest (linked only when the bot's hub JSON has the install prompt on): the installed icon opens
  // this child's own hub, marked ?from=hs so the hub open carries the home-screen route (hub_open.src).
  router.get('/h/:token/manifest.webmanifest', limiters.read, (req, res) => {
    const token = String(req.params.token || '');
    if (!HUB_TOKEN_RX.test(token)) return res.status(404).end();
    const kid = typeof req.query.kid === 'string' && /^[0-9a-f]{16}$/.test(req.query.kid) ? `&kid=${req.query.kid}` : '';
    let base = {};
    try { base = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8')); } catch (_) { base = { name: 'Jugnu' }; }
    res.set('Cache-Control', 'private, max-age=300');
    return res.status(200).type('application/manifest+json').send(JSON.stringify({ ...base, start_url: `/h/${token}?from=hs${kid}`, scope: '/' }));
  });
  router.get('/h/:token', limiters.read, async (req, res) => {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    // No hub JSON on a closed link, so the phone's own language picks the page's (an Urdu phone reads Urdu).
    const phoneLang = /^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en';
    const closed = (status, kind) => res.status(status).type('html').send(closedHtml(req, { lang: phoneLang, kind, origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    if (!HUB_TOKEN_RX.test(token)) return closed(401, 'hub');
    if (!botUrl || !apiKey) return closed(503, 'off');
    const kid = typeof req.query.kid === 'string' && /^[0-9a-f]{16}$/.test(req.query.kid) ? `?kid=${req.query.kid}` : '';
    // The route that brought the child (?from=…) rides to the bot as `src` (hub_open.src, read as opts.src).
    const src = typeof req.query.from === 'string' && HUB_SRC_RX.test(req.query.from) ? `${kid ? '&' : '?'}src=${req.query.from}` : '';
    // The language the page that sent the child here was in (?lang=, only en|ur): the bot decides whether it wins.
    const lang = req.query.lang === 'en' || req.query.lang === 'ur' ? `${kid || src ? '&' : '?'}lang=${req.query.lang}` : '';
    // Fast first page: the head and the Jugnu frame now, the hub when the bot answers.
    // (never on a link-preview fetch: a crawler gets today's page)
    const flush = lastFast && req.query.nf !== '1' && !Preview.isPreviewFetch(req)
      ? renderHubFlushTop({ lang: req.query.lang === 'en' || req.query.lang === 'ur' ? req.query.lang : phoneLang, token, origin, assetV: version(), brandKey: lastBrand, ui: lastUi, waitUx: lastWaitUx, waitShare: lastWaitShare })
      : null;
    const wire = flush ? flushWire(req, res, flush.html) : null;
    let out;
    const b0 = Date.now();
    try {
      out = await callBot('GET', `/api/internal/wq/hub/${token}${kid}${src}${lang}`, req);
    } catch (_) {
      if (flush) return wire.again(inlineClosed(req, { lang: phoneLang, kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
      return closed(502, 'off');
    }
    if (flush && !(out.status === 200 && out.body && Array.isArray(out.body.kids))) return wire.again(inlineClosed(req, { lang: phoneLang, kind: out.status === 401 ? 'hub' : 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    if (out.status === 200 && out.body && Array.isArray(out.body.kids)) {
      if (Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, out.body.brand)) lastBrand = out.body.brand;
      if (typeof out.body.rt === 'boolean') lastRt = out.body.rt;
      lastUi = shellUi(out.body);
      lastFast = out.body.fast === true;
      lastWaitUx = WaitUx.on(out.body);
      lastWaitShare = WaitUx.share(out.body);
      // Step timings (the bot's answer carried them: a timing switch is on). The flushed page's headers went before the
      // bot answered, so they ride its boot JSON (`st`); a page whose headers have not gone yet says them as one
      // Server-Timing: any items already on it, this edge's wait for the bot, the bot's items, this page's render.
      // Off: no `st`, and the page and its headers are today's.
      // `st` here = step timings, not the session token (no page script reads the boot's `st`: a source-scan row pins it)
      if (flush) return wire.page(renderHubFlushTail({ guess: flush.guess, payload: out.steps ? { ...out.body, st: out.steps } : out.body, token, origin, assetV: version() }));
      if (!out.steps) return res.status(200).type('html').send(renderHubPage({ payload: out.body, token, origin, assetV: version() }));
      const edgeMs = Date.now() - b0;
      const r0 = process.hrtime.bigint();
      const html = renderHubPage({ payload: out.body, token, origin, assetV: version() });
      const renderMs = Math.round(Number(process.hrtime.bigint() - r0) / 1e6);
      const items = TimingNames.clean([`edge;dur=${edgeMs}`, out.steps, `render;dur=${renderMs}`].join(', '));
      TimingNames.appendTiming(res, items);
      return res.status(200).type('html').send(html);
    }
    if (out.status === 401) return closed(401, 'hub');
    return closed(out.status === 503 ? 503 : 502, 'off');
  });
  router.get('/q/:code/class', limiters.read, unknownCode, (req, res) => page(req, res, 'class'));
  router.get('/q/:code/schools', limiters.read, unknownCode, (req, res) => page(req, res, 'schools'));

  // M4c challenge: the kid's Challenge page, opened from the hub (or a quiz session token while testing).
  router.get('/c/:token', limiters.read, (req, res) => challengePage(req, res));
  // The class round's hand-back (the round end card's one button): the bot keeps the teacher's round page token
  // server-side and names it here; 303 there, else 303 to the turn's own page (Home). Never an error page.
  router.get('/c/:token/back', limiters.read, async (req, res) => {
    const token = String(req.params.token || '');
    const lang = req.query.lang === 'ur' ? 'ur' : 'en';
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    if (!TOKEN_RX.test(token)) return res.status(404).type('html').send(closedHtml(req, { lang, kind: 'closed', origin: originOf(req), assetV: version(), brandKey: lastBrand, ui: lastUi }));
    const home = `/c/${encodeURIComponent(token)}?lang=${lang}`;
    if (!botUrl || !apiKey) return res.redirect(303, home);
    let to = null;
    try {
      const out = await callBot('GET', `/api/internal/wq/ch/${encodeURIComponent(token)}/back?lang=${lang}`, req, null, { route: '/api/internal/wq/ch/:token/back' });
      to = out.status === 200 && out.body && typeof out.body.to === 'string' ? out.body.to : null;
    } catch (_) { to = null; }
    return res.redirect(303, to && /^\/r\/[A-Za-z0-9_.%-]{8,900}\/round\?lang=(?:en|ur)$/.test(to) ? to : home);
  });

  async function challengePage(req, res) {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    const brandKey = lastBrand || WebQuizBrand.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME });
    const lang0 = req.query.lang === 'ur' ? 'ur' : (req.query.lang === 'en' ? 'en' : null);
    if (!TOKEN_RX.test(token)) return res.status(404).type('html').send(closedHtml(req, { lang: lang0 || 'en', kind: 'closed', origin, assetV: version(), brandKey, ui: lastUi }));
    if (!botUrl || !apiKey) return res.status(503).type('html').send(closedHtml(req, { lang: lang0 || 'en', kind: 'off', origin, assetV: version(), brandKey, ui: lastUi }));
    const q = new URLSearchParams();
    if (typeof req.query.kid === 'string' && /^[0-9a-f]{16}$/.test(req.query.kid)) q.set('kid', req.query.kid);
    if (lang0) q.set('lang', lang0);
    const qs = q.toString() ? `?${q}` : '';
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/ch/${encodeURIComponent(token)}${qs}`, req);
    } catch (_) {
      return res.status(502).type('html').send(closedHtml(req, { lang: lang0 || 'en', kind: 'off', origin, assetV: version(), brandKey, ui: lastUi }));
    }
    // One Urdu face: the menu's own `one_face` (the bot's word) reaches the head as `ui.uf`; off, the menu untouched.
    if (out.body && typeof out.body === 'object') out.body = withOneFace(out.body);
    if (out.status === 200 && out.body && Array.isArray(out.body.exercises)) {
      return res.status(200).type('html').send(renderChallengePage({ menu: out.body, token, kid: q.get('kid'), origin, assetV: version(), chV: challengeVersion(), brandKey }));
    }
    const err = out.body && out.body.error;
    if (err === 'not_eligible' || err === 'pick_kid' || err === 'other_device') {
      // pick_kid (a deep link with no tap on this visit): the note links to the hub of this token (a hub token only),
      // where the child picks; never a dead end.
      const hub = err === 'pick_kid' && HUB_TOKEN_RX.test(token) ? token : null;
      return res.status(out.status).type('html').send(renderChallengeNote({ lang: lang0 || 'en', why: err, origin, assetV: version(), brandKey, ui: lastUi, hub }));
    }
    const kind = out.status === 401 ? 'closed' : 'off';
    return res.status(out.status === 401 ? 410 : 503).type('html').send(closedHtml(req, { lang: lang0 || 'en', kind, origin, assetV: version(), brandKey, ui: lastUi }));
  }

  // A storybook's pictures and voices (web-quiz-story-assets.js): content-addressed, immutable, from our own origin.
  // Off (app_settings web_quiz_stories) the path is not ours: the request goes on exactly as today.
  // A class behind one school NAT opens the same book at once: its own generous ceiling, applied only while on.
  router.get('/s/:bookId/:file', createStoryAssetHandler({
    storiesOn: opts.storiesOn, storyObject: opts.storyObject, storyEnv: opts.storyEnv, now,
    limiter: rateLimit({ ...common, max: 1200, keyGenerator: (req) => `sa:${clientIp(req)}` }),
  }));

  // The share pictures. The id is the permission (the bot checks its mac); the edge checks its shape and that it
  // is the kind the path names, so a link can never ask for one picture under another's name or cache life.
  // The file's extension is the kind's own (the class link's picture is a PNG): a kind under another extension is 404.
  // A .png path no kind owns is not this route's: it goes on exactly as before the class link's picture.
  const artRoute = (ext) => async (req, res, next) => {
    const kind = String(req.params.kind || '');
    if (ext !== 'jpg' && ART_EXT[kind] !== ext) return next();
    const id = Object.prototype.hasOwnProperty.call(ART_KIND, kind) && (ART_EXT[kind] || 'jpg') === ext ? artId(req.query.a, kind) : null;
    if (!id || !CODE_RX.test(String(req.params.code || ''))) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
    const teach = kind === 'teach';
    const tv = teach && typeof req.query.v === 'string' && TEACH_V_RX.test(req.query.v) ? req.query.v : '';
    if (!botUrl || !apiKey) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'web_quiz_off' });
    const sq = !teach && req.query.f === 'sq';
    // One event per picture handed out: which kind, kept here or asked of the bot, how long, and who fetched it
    // (WhatsApp Android/iOS, a browser…). A phone's preview fetch left no trace when the edge already held the picture.
    const t0 = Date.now();
    const seen = (from, extra = {}) => logEvent('web_quiz.art_edge', {
      kind, size: sq ? 'sq' : 'og', from, ms: Date.now() - t0, ua: Preview.fetcherOf(req), head: req.method === 'HEAD', ...extra,
    });
    const send = (pic) => res.status(200).set({ 'Cache-Control': `public, max-age=${ART_MAX_AGE[kind]}${teach ? ', immutable' : ''}`, 'X-Robots-Tag': 'noindex' }).type(pic.contentType).send(pic.bytes);
    // Kept at the edge: the card opening fetched it, so the sender's preview fetch never waits for a draw.
    const keyArt = `${kind}|${id}|${sq ? 'sq' : 'og'}${teach ? `|${String(req.params.code).toUpperCase()}|${tv}` : ''}`;
    const kept = artKept.get(keyArt);
    if (kept) { seen('edge'); return send(kept); }
    try {
      // the class link's picture is drawn only under its own code: the bot is told which one was asked
      const q = teach ? `?c=${String(req.params.code).toUpperCase()}` : (sq ? '?f=sq' : '');
      const out = await callBot('GET', `/api/internal/wq/art/${id}${q}`, req);
      if (out.bytes) {
        artKept.set(keyArt, { bytes: out.bytes, contentType: out.contentType }, ART_KEEP_MS[kind]);
        seen('bot');
        return send({ bytes: out.bytes, contentType: out.contentType });
      }
      seen('none', { status: out.status });
      return res.status(out.status === 404 ? 404 : 502).set('Cache-Control', 'no-store').json({ error: out.status === 404 ? 'not_found' : 'upstream_error' });
    } catch (_) {
      seen('none', { status: 0 });
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'bot_unreachable' });
    }
  };
  router.get('/q/:code/art/:kind.jpg', limiters.read, artRoute('jpg'));
  router.get('/q/:code/art/:kind.png', limiters.read, artRoute('png'));

  // ── the finish card (web_quiz_card_v3; the bot answers 404 while it is off) ──
  // The picture: a link preview fetches it twice (HEAD, then GET) with no session, so the sealed token is the permission;
  // kept at the edge after the first answer, so the second fetch (and the HEAD) never reaches the bot. Never logs the token.
  const cardKept = Preview.ttlCache({ max: 200, now });
  const cardFacts = Preview.ttlCache({ max: 500, now });
  router.get('/wq/card/:token.png', limiters.read, async (req, res) => {
    const token = cardToken(req.params.token);
    if (!token) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
    if (!botUrl || !apiKey) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'web_quiz_off' });
    const t0 = Date.now();
    const seen = (from, extra = {}) => logEvent('web_quiz.card_edge', { from, ms: Date.now() - t0, ua: Preview.fetcherOf(req), head: req.method === 'HEAD', ...extra });
    const send = (pic) => res.status(200).set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Robots-Tag': 'noindex' }).type(pic.contentType).send(pic.bytes);
    const kept = cardKept.get(token);
    if (kept) { seen('edge'); return send(kept); }
    try {
      const out = await callBot('GET', `/api/internal/wq/card/${token}.png`, req, null, { route: '/api/internal/wq/card/:token.png' });
      if (out.bytes) {
        const pic = { bytes: out.bytes, contentType: out.contentType || 'image/png' };
        cardKept.set(token, pic, CARD_KEEP_MS);
        seen('bot');
        return send(pic);
      }
      seen('none', { status: out.status });
      return res.status(out.status === 404 ? 404 : 502).set('Cache-Control', 'no-store').json({ error: out.status === 404 ? 'not_found' : 'upstream_error' });
    } catch (_) {
      seen('none', { status: 0 });
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'bot_unreachable' });
    }
  });
  // A lesson's small thumbnail (the bot draws it from the poster once; off, unknown or not drawn: 404). Kept here a day,
  // so a class opening the same shelf asks the bot once; the phone keeps it for good (the shelf's URL carries ?v=).
  // A lesson the bot says has no picture (no_picture) is kept as such for 10 minutes, here and on the phone.
  const thumbKept = Preview.ttlCache({ max: 600, now });
  const THUMB_NONE_MS = 10 * 60 * 1000;
  const NO_PICTURE = { none: true };
  router.get('/wq/vt/:vid.webp', limiters.read, async (req, res) => {
    const vid = String(req.params.vid || '').toLowerCase();
    if (!VID_RX.test(vid)) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
    if (!botUrl || !apiKey) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'web_quiz_off' });
    const send = (pic) => res.status(200).set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Robots-Tag': 'noindex' }).type(pic.contentType).send(pic.bytes);
    const noPicture = () => res.status(404).set('Cache-Control', `public, max-age=${THUMB_NONE_MS / 1000}`).json({ error: 'no_picture' });
    const kept = thumbKept.get(vid);
    if (kept) return kept.none ? noPicture() : send(kept);
    try {
      const out = await callBot('GET', `/api/internal/wq/vt/${vid}.webp`, req, null, { route: '/api/internal/wq/vt/:vid.webp' });
      if (out.bytes) {
        const pic = { bytes: out.bytes, contentType: out.contentType || 'image/webp' };
        thumbKept.set(vid, pic, CARD_KEEP_MS);
        return send(pic);
      }
      if (out.status === 404 && out.body && out.body.error === 'no_picture') { thumbKept.set(vid, NO_PICTURE, THUMB_NONE_MS); return noPicture(); }
      return res.status(out.status === 404 ? 404 : 502).set('Cache-Control', 'no-store').json({ error: out.status === 404 ? 'not_found' : 'upstream_error' });
    } catch (_) {
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'bot_unreachable' });
    }
  });
  router.get('/k/:token', limiters.read, async (req, res) => {
    pageHeaders(res);
    const origin = originOf(req);
    const token = cardToken(req.params.token);
    const closed = (status) => res.status(status).type('html').send(closedHtml(req, { lang: 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    if (!token) return closed(404);
    if (!botUrl || !apiKey) return res.status(503).type('html').send(closedHtml(req, { lang: 'en', kind: 'off', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    let facts = cardFacts.get(token);
    if (!facts) {
      try {
        const out = await callBot('GET', `/api/internal/wq/card/${token}`, req, null, { route: '/api/internal/wq/card/:token' });
        if (out.status === 200 && out.body && typeof out.body.deed_text === 'string') { facts = out.body; cardFacts.set(token, facts, CARD_KEEP_MS); }
        else return closed(out.status === 404 ? 404 : 502);
      } catch (_) {
        return closed(502);
      }
    }
    // A shared card opened (a classmate's tap, or the preview crawler): kind and who fetched it, never the token.
    logEvent('web_quiz.card_open', { kind: String(facts.kind || '').slice(0, 12), lang: facts.lang === 'ur' ? 'ur' : 'en', ua: Preview.fetcherOf(req), head: req.method === 'HEAD' });
    return res.status(200).type('html').send(renderCardPage({ facts, token, origin, url: `${origin}/k/${token}`, brandKey: lastBrand, oneFace: Boolean(lastUi && lastUi.uf === true) }));
  });

  // M4b library
  router.get('/lib/:token', limiters.read, (req, res) => {
    pageHeaders(res);
    const origin = originOf(req);
    const token = String(req.params.token || '');
    if (!TOKEN_RX.test(token)) return res.status(404).type('html').send(closedHtml(req, { lang: 'en', kind: 'closed', origin, assetV: version(), brandKey: lastBrand, ui: lastUi }));
    const kid = typeof req.query.kid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(req.query.kid) ? req.query.kid : null;
    const lang = req.query.l === 'ur' || req.query.lang === 'ur' ? 'ur' : 'en';
    return res.status(200).type('html').send(renderLibPage({ hub: token, kid, lang, origin, assetV: version(), brandKey: lastBrand, rt: lastRt, ui: lastUi }));
  });

  router.get('/wq-probe', (req, res) => {
    pageHeaders(res);
    res.type('html').sendFile(PROBE_FILE);
  });

  // The sound + motion kit's demo page (ten answers to tap through): only while web_quiz_juice is on, never cached;
  // no child page links to it. Off, or the bot not answering, it is not there (404). The file lives in views/, outside
  // the /wq static handler, so no other spelling of the path reaches it.
  router.get('/wq/juice-demo.html', limiters.read, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
    let on = false;
    if (botUrl && apiKey) {
      try {
        const out = await callBot('GET', '/api/internal/wq/juice', req);
        on = out.status === 200 && Boolean(out.body) && out.body.on === true;
      } catch (_) { on = false; }
    }
    if (!on) return res.status(404).type('text').send('not found');
    let html;
    try { html = fs.readFileSync(JUICE_DEMO_FILE, 'utf8'); } catch (_) { return res.status(404).type('text').send('not found'); }
    return res.status(200).type('html').send(html.replace(/__JV__/g, challengeVersion('wq-juice.js')).replace(/__CV__/g, challengeVersion('wq-juice.css')));
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


module.exports = { createWebQuizRouter, createBotClient, clientIp, renderQuizPage, renderPreviewPage, renderClosedPage, renderCardPage, renderChallengePage, renderLibPage, bootJson, renderHubPage, assetVersion };
