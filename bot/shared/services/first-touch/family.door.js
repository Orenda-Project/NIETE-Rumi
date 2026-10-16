'use strict';
/**
 * The family door: the page a parent or child lands on after "Play" (`GET /f/<token>`), its code box
 * (`POST /api/ft/code`), its quiet "I'm a teacher" escape (`GET /f/<token>/teacher`), and the maker page's
 * "Change my choice" (`POST /api/ft/door`), which lands the SAME web view here. Routes: family.routes.js.
 *
 *   GET  /f/:token           token kind 'f' (family.token.js): 200 the page in the token's language (`bi` → Urdu with an
 *                            "English" switch, ?lang=en); a genuine but expired token → 200 the same page with the
 *                            "this link has expired" line (mk.stale) in Jugnu's bubble; a forged/garbled token → 403
 *                            the same page with no teacher link. Never a 404, never a 500.
 *   POST /api/ft/code        {t, code}: a QUIZ- code (any case, a space for the hyphen, the bare six characters typed
 *                            after the page's fixed "QUIZ-", or a pasted /q/ link) → 302 /q/<CODE>, today's child page,
 *                            unchanged; anything else (a JUGNU- code, junk, empty) → 200 the page with fd.bad. The page
 *                            is not the chat: a JUGNU- code never reaches the binder here. The code is never logged.
 *   GET  /f/:token/teacher   302 → wa.me/<the bot's number>?text=<the claim phrase> ("I am a teacher" / «میں ٹیچر ہوں»,
 *                            both looksLikeTeacherClaim's words); the hop is what makes the escape countable, and the
 *                            page's own markup then carries no number.
 *   POST /api/ft/door        {t}: ONLY a maker token (kind 'm', any via; the switch on) → the child key through
 *                            door.keys.js, two events, 302 → /f/<a new family token>. Any other token → 403, no write.
 *
 * Events: onboard.family_door { step ∈ open | code_ok | code_bad | teacher_link, ukey, w:'s' } — `ukey` only from the
 * family token's `uk`, absent when null; never kid, dk, the code value or the token. "Change my choice" emits
 * onboard.quiz_door{door:'change', …} and onboard.maker{step:'change_choice', …} and no family_door event.
 *
 * The page asks nothing about a person (no name, phone or grade), carries no link to the maker page, no
 * "Change my choice", no test word, no phone number. Every word is a signed row of the first-touch copy, quoted verbatim below.
 * Light at load: the token signer, the brand table and fs; every module that touches the store is required inside
 * the handler that needs it.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Token = require('../quiz/web-quiz-token');

const CSS = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'family.page.css'), 'utf8'); } catch (_) { return ''; }
})();

// The first-touch copy v1.2 (`fd.*`; the maker page's `mk.stale`, `mk.error`, `mk.lang.switch`), every row signed; copied, never retyped.
// `mk.lang.switch` is written in the language it switches TO: the English page shows «اردو», the Urdu page "English".
const STRINGS = Object.freeze({
  'fd.h': Object.freeze({ en: "Playing from home?", ur: "گھر سے کھیلنا ہے؟" }),
  'fd.sub': Object.freeze({ en: "Open the link your teacher sent to the class group, or type the code written on it.", ur: "ٹیچر نے کلاس گروپ میں جو لنک بھیجا ہے وہ کھولیں، یا اُس پیغام میں لکھا کوڈ یہاں لکھیں۔" }),
  'fd.code': Object.freeze({ en: "Code", ur: "کوڈ" }),
  'fd.open': Object.freeze({ en: "Open my class quiz", ur: "کلاس کا کوئز کھولیں" }),
  'fd.none': Object.freeze({ en: "No class link yet? Ask your teacher.", ur: "ابھی لنک نہیں ملا؟ اپنے ٹیچر سے پوچھیں۔" }),
  'fd.bad': Object.freeze({ en: "That code didn't open. Check the letters and try again.", ur: "یہ کوڈ نہیں کھلا۔ انگریزی حروف دھیان سے دیکھ کر دوبارہ لکھیں۔" }),
  'fd.teacher': Object.freeze({ en: "I'm a teacher", ur: "میں ٹیچر ہوں" }),
  'fd.ask': Object.freeze({ en: "Hello! Please send me the class quiz link.", ur: "السلام علیکم! براہ کرم مجھے کلاس کے کوئز کا لنک بھیج دیں۔" }),
  'fd.ask.btn': Object.freeze({ en: "Ask the teacher", ur: "ٹیچر سے پوچھیں" }),
  'mk.stale': Object.freeze({ en: "This link has expired. For a new one, send “quiz” in the chat.", ur: "اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔" }),
  'mk.error': Object.freeze({ en: "That didn't work. Try again in a moment.", ur: "یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔" }),
  'mk.lang.switch': Object.freeze({ en: "اردو", ur: "English" }),
});

// The claim phrase the "I'm a teacher" link pre-types: student-mode.service's looksLikeTeacherClaim accepts both whole.
const CLAIM = Object.freeze({ en: 'I am a teacher', ur: 'میں ٹیچر ہوں' });

// The share code's own shape (video-quiz-share.service.js CODE_RX: QUIZ-[A-Z0-9]{6}); /q/ serves the six characters.
const QUIZ_IN_LINK_RX = /\/Q\/(?:QUIZ[\s_-]*)?([A-Z0-9]{6})(?![A-Z0-9])/;
const QUIZ_WORD_RX = /(?:^|[^A-Z0-9])QUIZ[\s_-]*([A-Z0-9]{6})(?![A-Z0-9])/;
const BARE_RX = /^[A-Z0-9]{6}$/;
// Invisible marks a phone's keyboard or a paste can carry (bidi controls, zero-width, BOM).
const INVISIBLE_RX = /[​-‏‪-‮⁠-⁩﻿]/g;
// A signed token's shape (web-quiz-token.js): base64url payload "." 22-character signature.
const TOKEN_RX = /^[A-Za-z0-9_-]{8,1000}\.[A-Za-z0-9_-]{22}$/;
const UKEY_RX = /^[0-9a-f]{16}$/;
const ASSET_BASE = '/wq';
const CODE_MAX = 300;

const WA_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8.9-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1.1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.7 3.1.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.2-.3-.2-.5-.3z"/></svg>';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const str = (id, lang) => STRINGS[id][lang === 'ur' ? 'ur' : 'en'];

/** structured-logger's logEvent, required at call time (a test mocks it); a failed log never decides a response. */
function emit(event, fields) {
  try { require('../../utils/structured-logger').logEvent(event, fields); } catch (_) { /* never decides a response */ }
}

/** onboard.family_door: the step, and the ukey ONLY when the token carried one. */
function familyEvent(step, payload) {
  const uk = payload && typeof payload.uk === 'string' && UKEY_RX.test(payload.uk) ? payload.uk : null;
  emit('onboard.family_door', { step, ...(uk ? { ukey: uk } : {}), w: 's' });
}

// ─── the token ───────────────────────────────────────────────────────────────────────────────────────────────────

/** family.token.js's verify when it is there, else the same check through the signer (kind 'f'). */
function verifyFamily(token, opts) {
  try {
    const FamilyToken = require('./family.token');
    if (FamilyToken && typeof FamilyToken.verifyFamilyToken === 'function') return FamilyToken.verifyFamilyToken(token, opts);
  } catch (_) { /* the signer below */ }
  return Token.verify(token, 'f', opts);
}

/** { payload, stale } for a genuine family token (stale = expired), else null (forged, garbled, another kind). */
function readFamilyToken(token) {
  if (typeof token !== 'string' || !TOKEN_RX.test(token)) return null;
  const fresh = verifyFamily(token, { allowExpired: false });
  if (fresh) return { payload: fresh, stale: false };
  const old = verifyFamily(token, { allowExpired: true });
  return old ? { payload: old, stale: true } : null;
}

/**
 * The maker token (kind 'm': uid, lang, tour, pf, via, exp) — read straight through web-quiz-token's verify, the signer the
 * maker's own module wraps; unexpired only. Any other kind (a family token included) → null.
 */
function readMakerToken(t) {
  if (typeof t !== 'string' || !TOKEN_RX.test(t)) return null;
  const p = Token.verify(t, 'm');
  return p && typeof p.uid === 'string' && p.uid ? p : null;
}

// ─── language ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page's language and the switch it offers: `ur` → Urdu; `bi` → Urdu with "English" (?lang=en flips it). */
function pageLang(tokenLang, asked) {
  if (tokenLang === 'ur') return { lang: 'ur', switchTo: null };
  if (tokenLang === 'en') return { lang: 'en', switchTo: null };
  return asked === 'en' ? { lang: 'en', switchTo: 'ur' } : { lang: 'ur', switchTo: 'en' };
}

/** A page with no genuine token: the phone's language (Accept-Language), else English. */
function phoneLang(req) {
  const a = String((req && req.get && req.get('accept-language')) || '');
  return /^\s*ur\b/i.test(a) ? 'ur' : 'en';
}

const asked = (v) => (v === 'en' || v === 'ur' ? v : null);

// ─── the code ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The six characters of a QUIZ- code in what a person typed or pasted, or null. Accepts `QUIZ-A7K2PQ`,
 * `quiz-a7k2pq`, `QUIZ A7K2PQ`, `A7K2PQ` (typed after the page's fixed "QUIZ-"), and a pasted link
 * `…/q/A7K2PQ` or `…/q/QUIZ-A7K2PQ`. A JUGNU- code, junk and empty are null.
 */
function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.slice(0, CODE_MAX).normalize('NFKC').replace(INVISIBLE_RX, '').trim().toUpperCase();
  if (!s) return null;
  const inLink = QUIZ_IN_LINK_RX.exec(s);
  if (inLink) return inLink[1];
  const word = QUIZ_WORD_RX.exec(s);
  if (word) return word[1];
  return BARE_RX.test(s) ? s : null;
}

// ─── the bot's number (the teacher escape only) ─────────────────────────────────────────────────────────────────

/** The number a wa.me link opens: the SAME variables the share uses (video-quiz-share.service.js botNumber()). */
function botNumber() {
  return String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
}

// ─── the page ────────────────────────────────────────────────────────────────────────────────────────────────────

function brandParts() {
  try {
    const B = require('../../config/web-quiz-brand');
    const key = B.brandKey({ orgName: process.env.ORG_NAME, botName: process.env.BOT_NAME });
    const brand = B.publicBrand(key);
    return { vars: B.cssVars(brand), brand };
  } catch (_) {
    return { vars: '', brand: null };
  }
}

function lockup(brand, lang) {
  if (!brand || !brand.mark || !brand.label) return '<span class="fd-brand"></span>';
  const l = lang === 'ur' ? 'ur' : 'en';
  return `<span class="fd-brand"><span class="fd-mark${brand.mark.tile ? '' : ' fd-bare'}" aria-hidden="true">${brand.mark.svg}</span>`
    + `<span class="fd-lock"><b>${esc(brand.label[l])}</b><small>${esc(brand.sub && brand.sub[l])}</small></span></span>`;
}

function fontFace(assetBase) {
  return `@font-face{font-family:"WQ Nastaliq 2";src:url(${assetBase}/fonts/wq-nastaliq-2.woff2) format("woff2");font-weight:400;font-display:swap;`
    + 'unicode-range:U+0020,U+00A0,U+00AB,U+00BB,U+060C,U+061B,U+061F,U+0621-063A,U+0640-0656,U+0658,U+0660-066D,U+0670,U+0679,U+067E,U+0686,U+0688,U+0691,U+0698,U+06A9,U+06AF,U+06BA,U+06BE,U+06C0-06C3,U+06CC,U+06D2-06D4,U+06F0-06F9,U+200C-200F,U+2066-2069,U+25CC}';
}

/**
 * The page HTML. `state`: 'fresh' | 'code_bad' | 'stale' | 'denied' (no genuine token: no teacher link, no token in
 * the form). `token` is the family token (null when denied). `switchTo` names the language the switch link opens
 * (a bilingual token only). `typed` re-fills the field after a bad code (escaped; never logged). Returns
 * { html, styleHash } — the hash goes into the response's Content-Security-Policy.
 */
function buildFamilyDoor({ token = null, lang = 'en', state = 'fresh', switchTo = null, typed = '', assetBase = ASSET_BASE } = {}) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const ur = l === 'ur';
  const st = ['fresh', 'code_bad', 'stale', 'denied'].includes(state) ? state : 'fresh';
  const hasToken = st !== 'denied' && typeof token === 'string' && TOKEN_RX.test(token);
  const { vars, brand } = brandParts();
  const style = `${ur ? fontFace(assetBase) : ''}${CSS}${vars}`;
  const styleHash = crypto.createHash('sha256').update(style, 'utf8').digest('base64');
  const enc = hasToken ? encodeURIComponent(token) : '';
  const say = st === 'stale' ? str('mk.stale', l) : str('fd.sub', l);
  const bad = st === 'code_bad';
  // A bad code is shown again only as the part typed after the page's fixed "QUIZ-" and only when it is plain
  // letters and digits (a typo to fix); anything else (a JUGNU- code, a link, junk) leaves the field empty.
  const rest = bad ? String(typed || '').normalize('NFKC').replace(INVISIBLE_RX, '').trim().replace(/^QUIZ[\s_-]*/i, '') : '';
  const again = /^[A-Za-z0-9]{1,12}$/.test(rest) ? rest : '';
  const sw = hasToken && switchTo
    ? `<a class="fd-sw" lang="${switchTo}" href="/f/${enc}?lang=${switchTo}">${esc(str('mk.lang.switch', l))}</a>`
    : '';
  const askHref = `https://wa.me/?text=${encodeURIComponent(str('fd.ask', l))}`;
  const html = `<!doctype html>
<html lang="${l}" dir="${ur ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#47BA7D">
<title>${esc(str('fd.h', l))}</title>${ur ? `\n<link rel="preload" href="${assetBase}/fonts/wq-nastaliq-2.woff2" as="font" type="font/woff2" crossorigin>` : ''}
<style>${style}</style>
</head>
<body>
<main class="fd">
<header class="fd-top">${lockup(brand, l)}${sw}</header>
<h1>${esc(str('fd.h', l))}</h1>
<div class="fd-jug"><img src="${assetBase}/jugnu/hello.webp" alt="" width="64" height="64"><p class="fd-say">${esc(say)}</p></div>
<form class="fd-form${bad ? ' fd-is-bad' : ''}" method="post" action="/api/ft/code" autocomplete="off" novalidate>
${hasToken ? `<input type="hidden" name="t" value="${esc(token)}">\n` : ''}<input type="hidden" name="l" value="${l}">
<label class="fd-lab" for="fd-code">${esc(str('fd.code', l))}</label>
<div class="fd-field" dir="ltr"><span class="fd-pre" aria-hidden="true">QUIZ-</span><input id="fd-code" class="fd-input" name="code" type="text" lang="en" dir="ltr" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="${CODE_MAX}" value="${esc(again)}"${bad ? ' aria-invalid="true" aria-describedby="fd-bad"' : ''}></div>
${bad ? `<p class="fd-err" id="fd-bad" role="alert">${esc(str('fd.bad', l))}</p>\n` : ''}<button class="fd-btn fd-go" type="submit">${esc(str('fd.open', l))}</button>
</form>
<p class="fd-note">${esc(str('fd.none', l))}</p>
<a class="fd-btn fd-ask" href="${esc(askHref)}" rel="noopener noreferrer">${WA_ICON}<span>${esc(str('fd.ask.btn', l))}</span></a>
${hasToken ? `<p class="fd-foot"><a href="/f/${enc}/teacher?l=${l}" rel="nofollow">${esc(str('fd.teacher', l))}</a></p>\n` : ''}</main>
</body>
</html>`;
  return { html, styleHash };
}

/** The HTML string alone (the brief's renderFamilyDoor({ token, lang, state })). */
function renderFamilyDoor(opts = {}) {
  return buildFamilyDoor(opts).html;
}

/** A one-line plain page for a refused "Change my choice" or a failure there (mk.stale / mk.error; no form, no link). */
function buildPlainPage({ lang = 'en', id = 'mk.stale' } = {}) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const ur = l === 'ur';
  const { vars, brand } = brandParts();
  const style = `${ur ? fontFace(ASSET_BASE) : ''}${CSS}${vars}`;
  const styleHash = crypto.createHash('sha256').update(style, 'utf8').digest('base64');
  const line = str(id === 'mk.error' ? 'mk.error' : 'mk.stale', l);
  const html = `<!doctype html>
<html lang="${l}" dir="${ur ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(line)}</title>
<style>${style}</style>
</head>
<body>
<main class="fd">
<header class="fd-top">${lockup(brand, l)}</header>
<div class="fd-jug"><img src="${ASSET_BASE}/jugnu/hello.webp" alt="" width="64" height="64"><p class="fd-say">${esc(line)}</p></div>
</main>
</body>
</html>`;
  return { html, styleHash };
}

// ─── responses ───────────────────────────────────────────────────────────────────────────────────────────────────

function pageHeaders(res, styleHash) {
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'self'; font-src 'self'; `
      + "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}

function sendPage(res, status, built) {
  pageHeaders(res, built.styleHash);
  return res.status(status).type('html').send(built.html);
}

function bodyOf(req) {
  return req && req.body && typeof req.body === 'object' ? req.body : {};
}

/** GET /f/:token */
function handleGetFamily(req, res) {
  try {
    const token = String((req.params && req.params.token) || '');
    const read = readFamilyToken(token);
    if (!read) return sendPage(res, 403, buildFamilyDoor({ lang: phoneLang(req), state: 'denied' }));
    const { lang, switchTo } = pageLang(read.payload.lang, asked(req.query && req.query.lang));
    familyEvent('open', read.payload);
    return sendPage(res, 200, buildFamilyDoor({ token, lang, switchTo, state: read.stale ? 'stale' : 'fresh' }));
  } catch (_) {
    return sendPage(res, 200, buildFamilyDoor({ lang: phoneLang(req), state: 'denied' }));
  }
}

/** POST /api/ft/code {t, code, l} */
function handlePostCode(req, res) {
  const body = bodyOf(req);
  try {
    const token = typeof body.t === 'string' ? body.t : '';
    const read = readFamilyToken(token);
    const code = normaliseCode(body.code);
    if (code) {
      if (read) familyEvent('code_ok', read.payload);
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.redirect(302, `/q/${code}`);
    }
    if (read) familyEvent('code_bad', read.payload);
    const typed = typeof body.code === 'string' ? body.code : '';
    if (!read) return sendPage(res, 200, buildFamilyDoor({ lang: asked(body.l) || phoneLang(req), state: 'code_bad', typed }));
    const { lang, switchTo } = pageLang(read.payload.lang, asked(body.l));
    return sendPage(res, 200, buildFamilyDoor({ token, lang, switchTo, state: 'code_bad', typed }));
  } catch (_) {
    return sendPage(res, 200, buildFamilyDoor({ lang: asked(body.l) || phoneLang(req), state: 'code_bad' }));
  }
}

/** GET /f/:token/teacher — the countable hop to the chat's claim phrase. */
function handleTeacherLink(req, res) {
  try {
    const token = String((req.params && req.params.token) || '');
    const read = readFamilyToken(token);
    if (!read) return sendPage(res, 403, buildFamilyDoor({ lang: phoneLang(req), state: 'denied' }));
    const { lang } = pageLang(read.payload.lang, asked(req.query && req.query.l));
    const n = botNumber();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!n) return res.redirect(303, `/f/${encodeURIComponent(token)}`);
    familyEvent('teacher_link', read.payload);
    return res.redirect(302, `https://wa.me/${n}?text=${encodeURIComponent(CLAIM[lang])}`);
  } catch (_) {
    return sendPage(res, 200, buildFamilyDoor({ lang: phoneLang(req), state: 'denied' }));
  }
}

/** The user's phone (server-side only, never logged) and whether the users row is ≤ 24 h old. */
async function userFacts(uid) {
  try {
    const supabase = require('../../config/supabase');
    const { data, error } = await supabase.from('users').select('phone, created_at').eq('id', uid).maybeSingle();
    if (error || !data) return { phone: null, newPhone: false };
    const at = data.created_at ? Date.parse(data.created_at) : NaN;
    return { phone: data.phone || null, newPhone: Number.isFinite(at) && Date.now() - at <= 24 * 3600 * 1000 };
  } catch (_) {
    return { phone: null, newPhone: false };
  }
}

function ukeyOf(phone) {
  if (!phone) return null;
  try {
    const k = require('../quiz/child-phone-bindings.repo').ukeyOf(phone);
    return typeof k === 'string' && UKEY_RX.test(k) ? k : null;
  } catch (_) {
    return null;
  }
}

async function firstDoorOn() {
  try {
    return Boolean((await require('../quiz/web-quiz-identity-flags').flags()).firstDoor);
  } catch (_) {
    return false;
  }
}

/** POST /api/ft/door {t} — "Change my choice" (DOOR §6): the maker token only; 0 replies; lands on the family door. */
async function handlePostDoor(req, res) {
  const refuse = () => sendPage(res, 403, buildPlainPage({ lang: phoneLang(req), id: 'mk.stale' }));
  try {
    const body = bodyOf(req);
    const maker = readMakerToken(body.t);
    if (!maker) return refuse();                       // any genuine maker token (kind 'm'); the PAGE shows the link only for via 'door'
    if (!(await firstDoorOn())) return refuse();
    const { uid } = maker;
    const makerLang = maker.lang === 'ur' || maker.lang === 'bi' || maker.lang === 'en' ? maker.lang : 'bi';
    const { phone, newPhone } = await userFacts(uid);
    try {
      await require('./door.keys').markChild(uid, phone);
    } catch (err) {
      try { require('../../utils/logger').logToFile('⚠️ first touch: change-my-choice write failed', { error: String((err && err.message) || err).slice(0, 120) }); } catch (_) { /* nothing */ }
      return sendPage(res, 200, buildPlainPage({ lang: makerLang === 'ur' ? 'ur' : 'en', id: 'mk.error' }));
    }
    const ukey = ukeyOf(phone);
    const uk = ukey ? { ukey } : {};
    emit('onboard.quiz_door', {
      door: 'change', verdict: 'child', reason: 'child_key', new_phone: newPhone, store: 'child', reply: 'none', tap: 'none',
      lang: makerLang, script: 'none', ...uk, w: 's',
    });
    emit('onboard.maker', { step: 'change_choice', via: maker.via, lang: makerLang, ...uk, w: 's' });
    // The family token's language is 'ur' or 'bi' (family.token.js); an English maker page lands on the English side.
    let family = null;
    try {
      family = require('./family.token').mintFamilyToken({ uid, lang: makerLang === 'ur' ? 'ur' : 'bi', ukey });
    } catch (_) { family = null; }
    if (!family) return sendPage(res, 200, buildPlainPage({ lang: makerLang === 'ur' ? 'ur' : 'en', id: 'mk.error' }));
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(302, `/f/${encodeURIComponent(family)}${makerLang === 'en' ? '?lang=en' : ''}`);
  } catch (_) {
    return refuse();
  }
}

module.exports = {
  renderFamilyDoor, buildFamilyDoor, buildPlainPage,
  handleGetFamily, handlePostCode, handleTeacherLink, handlePostDoor,
  normaliseCode, readFamilyToken, readMakerToken, pageLang, botNumber,
  STRINGS, CLAIM,
};
