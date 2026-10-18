/**
 * A child joins on their own, at the edge (switch quiz_student_join, decided by the BOT; OFF by default).
 *
 *   GET /quiz/join/:token   the ONE join screen: "Which class are you in?" (chips 1–5), "What should Jugnu call you?",
 *                           the saving notice, then "Let's go!". The bot verifies the token and names the language and
 *                           the mode (GET /api/internal/wq/join/page/:token, no database read but the cached switch);
 *                           the edge draws the page. Switch off (the bot's 404), a malformed token or no bot configured
 *                           → next(): the portal answers exactly as it does today. A stale link → the signed "expired"
 *                           words, never a 500.
 *   POST /api/wq/join/grade, POST /api/wq/join   forwarded by the web quiz router (its API_ROUTES).
 *
 * The page carries no phone, no school, no test word and no "register"; the name the child types goes in a POST body
 * only, never a URL. The edge holds no token secret and verifies nothing.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ChildCsp = require('./child-csp');
const { createBotClient, bootJson, assetVersion } = require('./web-quiz.routes');

// A signed j token (bot web-quiz-student-join.js signJoin): base64url payload "." 22-char signature.
const JOIN_TOKEN_RX = /^[A-Za-z0-9_-]{16,700}\.[A-Za-z0-9_-]{22}$/;
const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'wq');
// The home's long-cached files the grade tap warms (the bot names the same list: HOME_ASSETS), at the home's ?v=.
const WARM = ['/wq/hub.js', '/wq/wq.css', '/wq/hub-play.js', '/wq/wq-tel.js'];
// The Urdu face the child home's wq.css already uses (same URL, so the join's download is the home's cache hit).
const UR_FONT = '/wq/fonts/wq-nastaliq-5.woff2';

// Every line had a native Urdu read; the existing strings reused are named beside each.
const COPY = {
  en: {
    title: 'Jugnu',
    h: 'Which class are you in?',
    grades: ['1', '2', '3', '4', '5'],
    name: 'What should Jugnu call you?',
    hint: 'Just your first name',
    go: "Let's go!",
    later: 'Your teacher can add you to the class later.',
    // wq-bind.js noticeSave / noticeReadings / noticeStopPhoneOnly (REAL, signed), byte for byte (the tests compare the
    // file): IDENTITY §8, above "Let's go!"
    noticeSave: "Jugnu will save this phone number with {n}'s name until the end of the school year (31 March), longer only if you keep playing.",
    noticeReadings: 'Readings {n} makes with the microphone are kept too.',
    noticeStop: 'A grown-up can remove this phone number any time by sending STOP on WhatsApp.',
    // wq.js isYou / yesMe / diff (REAL)
    isYou: 'Are you {n}?', yesMe: "Yes, it's me", diff: "I'm a different {n}",
    full: 'This phone already has 4 children. Open it and pick your name.',
    open: 'Open',
    teacher: "This is a teacher's phone, so nothing is saved here. Play anyway!",
    practice: 'Practice: nothing is saved on this phone',
    // the family door's fd.sub / fd.none: the words when the join cannot save
    off: 'Open the link your teacher sent to the class group, or type the code written on it.',
    offNone: 'No class link yet? Ask your teacher.',
    stale: 'This link has expired. For a new one, send “quiz” in the chat.',   // mk.stale (signed)
    error: "That didn't work. Try again in a moment.",                        // mk.error (signed)
    wait: 'Opening…',
    openWa: 'Open WhatsApp',                                                  // the one tap back to the bot (native read: OK)
    going: 'Getting your games ready…',                                       // quiz_join_wait_word: the go button while the join runs
  },
  ur: {
    title: 'جگنو',
    h: 'آپ کس جماعت میں ہیں؟',
    grades: ['۱', '۲', '۳', '۴', '۵'],
    name: 'جگنو آپ کو کیا کہہ کر بلائے؟',
    hint: 'بس اپنا پہلا نام لکھیں',
    go: 'چلو شروع کریں!',
    later: 'کلاس میں شامل کرنا ٹیچر کا کام ہے، وہ بعد میں ہو جائے گا۔',
    noticeSave: 'جگنو اس فون نمبر کو ⁨{n}⁩ کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔',
    noticeReadings: 'مائیک پر ⁨{n}⁩ کی پڑھائی کی ریکارڈنگ بھی رکھی جاتی ہے۔',
    noticeStop: 'گھر کے بڑے کسی بھی وقت واٹس ایپ پر ⁦STOP⁩ بھیج کر یہ نمبر ہٹا سکتے ہیں۔',
    isYou: 'کیا آپ ⁨{n}⁩ ہیں؟', yesMe: 'جی ہاں، یہ میں ہوں', diff: 'میں کوئی اور ⁨{n}⁩ ہوں',
    full: 'اس فون پر پہلے ہی ۴ بچے ہیں۔ کھولیں اور اپنا نام چنیں۔',
    open: 'کھولیں',
    teacher: 'یہ ٹیچر کا فون ہے، اس لیے یہاں کچھ محفوظ نہیں ہوگا۔ پھر بھی کھیلیں!',
    practice: 'مشق: اس فون پر کچھ محفوظ نہیں ہوگا',
    off: 'ٹیچر نے کلاس گروپ میں جو لنک بھیجا ہے وہ کھولیں، یا اُس پیغام میں لکھا کوڈ یہاں لکھیں۔',
    // fd.none with the native read's fix: «اپنے ٹیچر» assumed a man; the bare noun is neutral
    offNone: 'ابھی لنک نہیں ملا؟ ٹیچر سے پوچھیں۔',
    stale: 'اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔',
    error: 'یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    wait: 'کھل رہا ہے…',
    openWa: 'واٹس ایپ کھولیں',
    going: 'آپ کے کھیل تیار ہو رہے ہیں…',   // native read: signed (the noun agrees, never the child)
  },
};

// The bot's WhatsApp number as the bot gave it: digits only, or nothing (never a link built from anything else).
const BOT_RX = /^\d{10,15}$/;
const cleanBot = (n) => (typeof n === 'string' && BOT_RX.test(n) ? n : null);
const waLink = (bot) => `https://wa.me/${bot}?text=quiz`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fileVersion(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10); } catch (_) { return '0'; }
}

// ≤ 2.5 KB of CSS, inline. The Urdu face is the home's own file (swap: the text never waits for it).
const CSS = `@font-face{font-family:"WQ Nastaliq";src:url(${UR_FONT}) format("woff2");font-display:swap;size-adjust:155%;unicode-range:U+0600-06FF,U+00A0,U+00AB,U+00BB,U+200C-200F,U+2066-2069,U+25CC,U+0020,U+0021}
*{box-sizing:border-box}html,body{margin:0;background:#fff8ec;color:#2b2118;font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
[lang=ur] body{font-family:"WQ Nastaliq","Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif;line-height:1.9}
main{max-width:480px;margin:0 auto;padding:16px 16px 32px}.jg{display:block;margin:4px auto 8px;width:96px;height:96px}
h1{font-size:24px;margin:8px 0 12px;text-align:center}.chips{display:flex;gap:8px;justify-content:center;margin:0 0 20px;padding:0;list-style:none}
.chip{min-width:56px;height:56px;border-radius:16px;border:2px solid #e3c48a;background:#fff;font:700 24px/1 system-ui,sans-serif;color:#2b2118}
.chip[aria-pressed=true]{background:#ffb703;border-color:#e08e00}label{display:block;font-size:20px;font-weight:700;margin:4px 0 6px}
input{width:100%;height:56px;border-radius:14px;border:2px solid #e3c48a;padding:0 14px;font-size:22px;background:#fff;font-family:inherit}
.hint,.small{font-size:16px;color:#6b5a48;margin:6px 0 0}[lang=ur] .hint,[lang=ur] .small{font-size:18px}
.notice{font-size:16px;color:#4a3b2c;background:#fff;border-radius:14px;padding:10px 14px;margin:16px 0 0}[lang=ur] .notice{font-size:20px}.notice p{margin:4px 0}
.go{display:block;width:100%;height:60px;margin:16px 0 12px;border:0;border-radius:18px;background:#2a9d8f;color:#fff;font-size:22px;font-weight:700;font-family:inherit;text-align:center;line-height:60px;text-decoration:none}
.go:disabled{background:#b9c9c6}.note{font-size:15px;color:#6b5a48;margin:10px 0 0}[lang=ur] .note{font-size:18px}
.line{background:#fff;border-radius:14px;padding:12px 14px;margin:12px 0;font-size:18px}.strip{background:#264653;color:#fff;border-radius:12px;padding:8px 12px;margin:0 0 8px;font-size:16px;text-align:center}[lang=ur] .strip{font-size:18px}
.pick{display:block;width:100%;min-height:56px;margin:8px 0;border-radius:14px;border:2px solid #e3c48a;background:#fff;font-size:20px;font-family:inherit}
[dir=rtl] main{text-align:right}[dir=rtl] h1{text-align:center}bdi{unicode-bidi:isolate}`;

// quiz_join_early_tap: the chips are drawn before join.js (deferred) binds its listener, so a tap in that window was
// lost. This runs before the chips exist: it presses the tapped chip at once and keeps its grade on <html data-early>;
// join.js replays it once it has bound (window.__jnBound stops the keeping). ES5, inline, < 400 bytes.
const EARLY_TAP = '<script>(function(){var d=document;d.addEventListener("click",function(e){if(window.__jnBound)return;'
  + 'var t=e.target,c=t&&t.closest?t.closest("[data-tap=grade]"):null;if(!c)return;var a=d.querySelectorAll(".chip");'
  + 'for(var i=0;i<a.length;i++)a[i].setAttribute("aria-pressed",a[i]===c?"true":"false");'
  + 'd.documentElement.setAttribute("data-early",c.getAttribute("data-grade"))},true)})();</script>';

// quiz_join_wait_word: the go button keeps its colour while it waits (join.js marks it aria-busy); on the page only then.
const WAIT_CSS = '.go[aria-busy=true]:disabled{background:#2a9d8f}';

function shell({ l, title, body, fontPreload, css = CSS }) {
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin">
<title>${esc(title)}</title>
${fontPreload && l === 'ur' ? `<link rel="preload" href="${UR_FONT}" as="font" type="font/woff2" crossorigin>\n` : ''}<style>${css}</style>
</head>
${body}
</html>`;
}

/** The join screen. Practice: the strip, the grade only (no name, no notice). */
function renderJoinPage({ token, lang, practice, assetV, jsV, bot = null, earlyTap = false, waitWord = false }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const c = COPY[l];
  const b = cleanBot(bot);
  const wait = waitWord === true;
  const boot = { view: 'join', t: token, lang: l, practice: Boolean(practice), v: assetV, warm: WARM, ...(b ? { bot: b } : {}), ...(wait ? { waitWord: true } : {}), copy: {
    noticeSave: c.noticeSave, noticeReadings: c.noticeReadings, isYou: c.isYou, yesMe: c.yesMe, diff: c.diff, full: c.full, open: c.open,
    teacher: c.teacher, off: c.off, offNone: c.offNone, stale: c.stale, error: c.error, wait: c.wait, openWa: c.openWa, ...(wait ? { going: c.going } : {}),
  } };
  const chips = c.grades.map((g, i) => `<li><button type="button" class="chip" data-tap="grade" data-grade="${i + 1}" aria-pressed="false">${esc(g)}</button></li>`).join('');
  const name = practice ? '' : `<label for="jn-name">${esc(c.name)}</label>
<input id="jn-name" name="first" type="text" maxlength="20" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="go">
<p class="hint">${esc(c.hint)}</p>
<div class="notice" id="jn-notice" hidden><p id="jn-n1"></p><p id="jn-n2"></p><p>${esc(c.noticeStop).replace('STOP', '<bdi dir="ltr">STOP</bdi>')}</p></div>`;
  const body = `<body${practice ? ' class="practice"' : ''}>
${earlyTap ? `${EARLY_TAP}\n` : ''}<main id="jn" data-screen="join">
${practice ? `<p class="strip">${esc(c.practice)}</p>\n` : ''}<img class="jg" src="/wq/jugnu/hello.webp" alt="" width="96" height="96">
<h1 id="jn-h">${esc(c.h)}</h1>
<ul class="chips" role="group" aria-labelledby="jn-h">${chips}</ul>
${name}
<button type="button" class="go" id="jn-go" data-primary data-tap="go" disabled>${esc(c.go)}</button>
<div id="jn-out" aria-live="polite"></div>
${practice ? '' : `<p class="note">${esc(c.later)}</p>\n`}</main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/join.js?v=${esc(jsV || assetV)}" defer></script>
</body>`;
  return shell({ l, title: c.title, body, fontPreload: !practice, ...(wait ? { css: CSS + WAIT_CSS } : {}) });
}

/** The expired (or failed) link: the signed words and ONE tap back to WhatsApp (when the bot's number is known). */
function renderJoinNote({ lang, kind, bot = null }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const c = COPY[l];
  const b = cleanBot(bot);
  const tap = b ? `<a class="go" href="${esc(waLink(b))}">${esc(c.openWa)}</a>` : '';
  return shell({ l, title: c.title, body: `<body>
<main data-screen="join_note"><img class="jg" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><p class="line">${esc(kind === 'stale' ? c.stale : c.error)}</p>${tap}</main>
</body>` });
}

function createQuizJoinRouter(opts = {}) {
  const rateLimit = require('express-rate-limit');
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const logEvent = opts.logEvent || ((e, p) => { try { require('../services/telemetry.service').logEvent(e, p); } catch (_) { /* never decides a response */ } });
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, logEvent });
  // web_quiz_child_csp (child-csp.js): the drawn join page's report-only policy (the early tap's script by its hash)
  const joinCsp = ChildCsp.createChildCsp({ on: typeof opts.childCspOn === 'function' ? opts.childCspOn : ChildCsp.childCspOn, hashes: [ChildCsp.scriptHash(EARLY_TAP)] });
  const router = express.Router();
  const read = rateLimit({ windowMs: 60 * 1000, standardHeaders: false, legacyHeaders: false, max: 300 });
  let assetV = null;
  let jsV = null;
  let lastBot = null;   // the number the bot gave last, for an error page drawn when the bot answers with a failure
  const phoneLang = (req) => (/^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en');

  // The limiter counts only pages the bot agreed to draw: with the switch off, every request still falls through to the
  // portal's own answer (a school's shared connection never meets a 429 from a page that does not exist).
  router.get('/quiz/join/:token', async (req, res, next) => {
    const token = String(req.params.token || '');
    if (!JOIN_TOKEN_RX.test(token) || !botUrl || !apiKey) return next();
    let out;
    try {
      out = await callBot('GET', `/api/internal/wq/join/page/${token}`, req, null, { route: '/api/internal/wq/join/page/:token' });
    } catch (_) {
      return next();   // the bot cannot be reached (the switch may be off): the portal's own answer, no page of ours
    }
    // the switch off (or a bot that has no such route yet): the portal's own answer, byte for byte
    if (out.status === 404) return next();
    lastBot = cleanBot(out.body && out.body.bot) || lastBot;
    return read(req, res, () => draw(req, res, token, out));
  });

  function draw(req, res, token, out) {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
    joinCsp(res);
    if (out.status === 410) return res.status(410).type('html').send(renderJoinNote({ lang: (out.body && out.body.lang) || phoneLang(req), kind: 'stale', bot: cleanBot(out.body && out.body.bot) }));
    if (out.status !== 200 || !out.body || !out.body.ok) return res.status(502).type('html').send(renderJoinNote({ lang: phoneLang(req), kind: 'error', bot: lastBot }));
    assetV = assetV || assetVersion();
    jsV = jsV || fileVersion('join.js');
    return res.status(200).type('html').send(renderJoinPage({ token, lang: out.body.lang, practice: out.body.practice === true, assetV, jsV, bot: out.body.bot, earlyTap: out.body.earlyTap === true, waitWord: out.body.waitWord === true }));
  }
  return router;
}

module.exports = { createQuizJoinRouter, renderJoinPage, renderJoinNote, COPY, WARM, JOIN_TOKEN_RX, UR_FONT, EARLY_TAP, WAIT_CSS };
