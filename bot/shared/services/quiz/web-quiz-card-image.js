'use strict';
/**
 * THE FINISH CARD'S PICTURE (web quiz, app_settings web_quiz_card_v3): one shareable card after every finish — a
 * teacher's quiz, a read-aloud, a story, a numbers game, a listening story, a storybook, a video.
 *
 *   mint(body, {device}) POST /card {st | ct | hub+kid, kind, deed, lang}: a card token for THIS child's finish
 *                    (a hub token only from the phone it is bound to, x-wq-device, as the hub itself).
 *                    The first name comes from the server (the session, the run or the hub token), never from the
 *                    page; the deed is one of a fixed list; nothing else the page sends reaches the picture.
 *                    -> {token, url, img, ret: {text, href}}  (url: /q/<CODE>?k=<t> for a class quiz, else /k/<t>)
 *   image(token)     GET /card/<t>.png: the 1200x630 picture (≤ 40 KB PNG), first name + the deed + one sticker,
 *                    drawn through web-quiz-art.js's own headless turn queue and kept in memory by token.
 *   field()          {card_v3: true} on the quiz finish and the Jugnu page's menu when the switch is on, else {};
 *                    with web_quiz_share_v4 on too, {card_v3: true, share_v4: true} (the quiz card's share is the page's own)
 *   facts(token)     {kind, deed, lang, first, code} for a genuine token, else null (the og head of /k/<t>).
 *
 * The token is the card's facts sealed with AES-256-GCM under a key derived from the web-quiz token secret: a
 * forwarded link carries no readable name or id, and nobody can make the server draw a card it never issued.
 * The picture never carries a number, a score, a class position, a phone or anyone else's name.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const { clampLanguage } = require('../../config/ux-strings');
// The card speaks the deployment's two languages only.
const LANG = (v) => clampLanguage(v, ['en', 'ur']);

const KEY = 'web_quiz_card_v3';
// The one share on top of the card (finish's `share_v4`): read in the card's own settings read, never a read of its own.
const SHARE_KEY = 'web_quiz_share_v4';
const TTL_MS = 30 * 1000;
const W = 1200;
const H = 630;
const MAX_BYTES = 40 * 1024;
const MEM_MAX = 128;
const TOKEN_RX = /^[A-Za-z0-9_-]{40,400}$/;
const CODE_RX = /^[A-Z0-9]{4,12}$/;

// What a child did, by kind. A deed outside its kind's list is refused (400), so the picture only ever says these.
const DEEDS = Object.freeze({
  quiz: ['quiz_done'],
  // *_practice: a stop played again with the child home on (no "today", no sticker: the Book is counted runs only)
  read: ['read_all', 'read_some', 'read_tried', 'read_practice', 'read_some_practice'],
  listen: ['listen_done', 'listen_practice'],
  story: ['story_read', 'answered', 'read_tried', 'story_practice'],
  game: ['game_done', 'game_practice'],
  // a storybook (the reader's one result object, source 'story'): read, only listened to, or opened with nothing read
  book: ['book_read', 'listen_done', 'read_tried'],
  video: ['video_watched'],
});

// The deed in the child's own first-person words: on the picture and as the share's first line. Urdu uses the
// ergative «میں نے …» so the verb agrees with the thing done, never with the child (gender-neutral).
const COPY = {
  en: {
    quiz_done: "I finished my teacher's quiz today!",
    read_all: 'I read a whole story out loud today!',
    read_some: 'I read out loud with Jugnu today!',
    read_tried: 'I tried a new story with Jugnu today!',
    listen_done: 'I listened to a story with Jugnu today!',
    story_read: 'I read a story with Jugnu today!',
    answered: 'I answered the story questions today!',
    game_done: 'I played a numbers game with Jugnu today!',
    book_read: 'I read a storybook with Jugnu today!',
    video_watched: 'I watched a video with Jugnu today!',
    read_practice: 'I read a whole story out loud!',
    read_some_practice: 'I read out loud with Jugnu!',
    listen_practice: 'I listened to a story with Jugnu!',
    story_practice: 'I read a story with Jugnu!',
    game_practice: 'I played a numbers game with Jugnu!',
    sticker: 'A new sticker!',
    with: 'Jugnu',
    ret: 'Play with Jugnu any day. Tap, then send:',
    cta: 'Play with Jugnu',
  },
  ur: {
    quiz_done: 'میں نے آج ٹیچر کا کوئز مکمل کیا!',
    read_all: 'میں نے آج پوری کہانی اونچی آواز میں پڑھی!',
    read_some: 'میں نے آج جگنو کے ساتھ اونچی آواز میں پڑھا!',
    read_tried: 'میں نے آج جگنو کے ساتھ ایک نئی کہانی پڑھنے کی کوشش کی!',
    listen_done: 'میں نے آج جگنو کے ساتھ کہانی سنی!',
    story_read: 'میں نے آج جگنو کے ساتھ کہانی پڑھی!',
    answered: 'میں نے آج کہانی کے سوالوں کے جواب دیے!',
    game_done: 'میں نے آج جگنو کے ساتھ گنتی کا کھیل کھیلا!',
    book_read: 'میں نے آج جگنو کے ساتھ کہانی کی کتاب پڑھی!',
    video_watched: 'میں نے آج جگنو کے ساتھ ویڈیو دیکھی!',
    read_practice: 'میں نے پوری کہانی اونچی آواز میں پڑھی!',
    read_some_practice: 'میں نے جگنو کے ساتھ اونچی آواز میں پڑھا!',
    listen_practice: 'میں نے جگنو کے ساتھ کہانی سنی!',
    story_practice: 'میں نے جگنو کے ساتھ کہانی پڑھی!',
    game_practice: 'میں نے جگنو کے ساتھ گنتی کا کھیل کھیلا!',
    sticker: 'ایک نیا اسٹیکر!',
    with: 'جگنو',
    ret: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:',
    cta: 'جگنو کے ساتھ کھیلیں',
  },
};

// The words the return link types for the child. Both pass quiz-menu-request.js isQuizMenuRequest today, and both
// differ from the class message's `quiz`, so a /quiz from a shared card is countable (quiz_cmd{src:'card_share'}).
const CARD_RETURN_WORDS = Object.freeze({ en: 'quiz please', ur: 'کوئز دکھائیں' });

class CardError extends Error {
  constructor(status, error) { super(error); this.status = status; this.body = { error }; }
}
const fail = (status, error) => { throw new CardError(status, error); };

// ─── the switch ─────────────────────────────────────────────────────────────

let cache = null;
// On only as JSON true: a string "true" row is off, as every child-page switch reads it (one truth across the pages).
function isTrue(value) {
  return value === true;
}
/** true only with app_settings web_quiz_card_v3 literally true; 30 s cache; fails closed. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, SHARE_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const val = (k) => ((data || []).find((r) => r && r.key === k) || {}).value;
    cache = { at: now, on: isTrue(val(KEY)), share: isTrue(val(SHARE_KEY)) };
    return cache.on;
  } catch (err) {
    // the read that names the share failed: the card reads its own key as before, and only the share is off
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
      if (error) throw new Error(error.message || 'app_settings read failed');
      cache = { at: now, on: isTrue(((data || [])[0] || {}).value), share: false };
      return cache.on;
    } catch (err2) {
      logToFile('⚠️ web quiz card v3: settings lookup failed — card off', { error: err2.message });
      return false;
    }
  }
}
/** true only with the card on AND app_settings web_quiz_share_v4 literally true (the same read and cache). */
async function shareOn(now = Date.now()) {
  return (await on(now)) && cache.share === true;
}
async function field() {
  try {
    if (!(await on())) return {};
    return cache.share === true ? { card_v3: true, share_v4: true } : { card_v3: true };
  } catch (_) { return {}; }
}

// ─── the token ──────────────────────────────────────────────────────────────

function sealKey() {
  const s = T.secret();
  return s ? crypto.createHmac('sha256', s).update('wq-card-v3').digest() : null;
}
function seal(facts) {
  const key = sealKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(facts), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
function open(token) {
  try {
    const key = sealKey();
    if (!key || typeof token !== 'string' || !TOKEN_RX.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const f = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    if (!f || f.v !== 1 || !DEEDS[f.k] || !DEEDS[f.k].includes(f.d)) return null;
    return f;
  } catch (_) {
    return null;
  }
}
/** The card's facts for a genuine token, else null. */
function facts(token) {
  const f = open(token);
  if (!f) return null;
  return { kind: f.k, deed: f.d, lang: LANG(f.l), first: f.n || '', code: f.c || null };
}

// ─── who finished (the server says; the page never names the child) ─────────

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
// A first name as the picture draws it: letters, marks, an apostrophe or a hyphen, at most 24 characters.
function cleanFirst(name) {
  return firstName(name).replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 24);
}

async function studentFirst(studentId, lang) {
  const { data: kid } = await supabase.from('students').select('id, student_name, student_name_urdu').eq('id', studentId).maybeSingle();
  if (!kid) return '';
  return cleanFirst(require('./web-quiz-roster').displayName(kid, lang));
}

async function who(body, lang, device) {
  const s = typeof body.st === 'string' ? T.verify(body.st, 's') : null;
  if (s && s.sid) {
    const { data: row } = await supabase.from('quiz_sessions').select('id, student_id, student_name, share_code_id, status, user_id').eq('id', s.sid).maybeSingle();
    // a child's own finished run; a teacher's test run has no child to name
    if (!row || row.status !== 'completed' || row.user_id) fail(401, 'bad_token');
    let code = null;
    if (row.share_code_id) {
      const { data: sc } = await supabase.from('quiz_share_codes').select('code').eq('id', row.share_code_id).maybeSingle();
      code = sc && CODE_RX.test(String(sc.code || '')) ? String(sc.code) : null;
    }
    const first = row.student_id ? await studentFirst(row.student_id, lang) : '';
    return { first: first || cleanFirst(row.student_name), code };
  }
  const c = typeof body.ct === 'string' ? T.verify(body.ct, 'c') : null;
  if (c && c.sid) return { first: await studentFirst(c.sid, lang), code: null };
  const h = typeof body.hub === 'string' ? T.verify(body.hub, 'h') : null;
  if (h && Array.isArray(h.ids)) {
    const ids = h.ids.filter((x) => typeof x === 'string').slice(0, 4);
    const hit = body.kid ? ids.find((id) => T.chipId('h', id) === body.kid) : (ids.length === 1 ? ids[0] : null);
    if (!hit) fail(401, 'bad_token');
    // A forwarded hub link names nobody: only the phone the link is bound to (or one this child played on), as the hub.
    const trust = await require('./web-quiz-hub-device').deviceTrusted(body.hub, device);
    if (!trust.ok || !trust.ids.map(String).includes(String(hit))) fail(403, 'other_device');
    return { first: await studentFirst(hit, lang), code: null };
  }
  return fail(401, 'bad_token');
}

// ─── mint ───────────────────────────────────────────────────────────────────

function botNumber() {
  const digits = String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}
/** The return line: the words, and the chat with this deployment's bot with them typed (null with no number). */
function returnLine(lang) {
  const l = LANG(lang);
  const n = botNumber();
  return { text: COPY[l].ret, cta: COPY[l].cta, words: CARD_RETURN_WORDS[l], href: n ? `https://wa.me/${n}?text=${encodeURIComponent(CARD_RETURN_WORDS[l])}` : null };
}

async function mint(body = {}, { device = null } = {}) {
  if (!(await on())) fail(404, 'not_found');
  if (!T.secret()) fail(503, 'web_quiz_off');
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const deed = typeof body.deed === 'string' ? body.deed : '';
  if (!DEEDS[kind] || !DEEDS[kind].includes(deed)) fail(400, 'bad_request');
  const lang = LANG(body.lang);
  const w = await who(body, lang, device);
  const token = seal({ v: 1, k: kind, d: deed, l: lang, n: w.first, ...(kind === 'quiz' && w.code ? { c: w.code } : {}), t: Math.floor(Date.now() / 1000) });
  if (!token) fail(503, 'web_quiz_off');
  const url = kind === 'quiz' && w.code ? `/q/${w.code}?k=${token}` : `/k/${token}`;
  return { token, url, img: `/wq/card/${token}.png`, ret: returnLine(lang) };
}

// ─── the picture ────────────────────────────────────────────────────────────

let _assets = null;
function b64(rel) {
  try {
    const abs = path.join(__dirname, '..', '..', rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch (_) { return ''; }
}
function assets() {
  if (!_assets) {
    _assets = {
      lexendBold: b64('fonts/Lexend-Bold.ttf'),
      // the Regular file, drawn bold by the browser: the Bold file breaks a join («پڑھی» draws as «پڑ  ھی»)
      nastaliq: b64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      celebrate: b64('assets/wq-art/celebrate.webp'),
    };
  }
  return _assets;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URDU_RX = /[؀-ۿ]/;

// One sticker, drawn (the renderer has no emoji font): a gold star on a ribbon disc — never a count of stars. A try
// (read_tried: Done with almost nothing read) earns no sticker, so its picture draws none; nor does a stop played again.
const STICKER = '<svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#FDE68A" stroke="#F59E0B" stroke-width="6"/>'
  + '<path d="M60 22l11 23 25 3-18 17 5 25-23-12-23 12 5-25-18-17 25-3z" fill="#F59E0B"/></svg>';

/** The card's HTML (pure): what the headless browser photographs. opt.fonts false only for a layout snapshot. */
function renderCard(f, opt = {}) {
  const lang = LANG(f.lang);
  const t = COPY[lang];
  const a = opt.fonts === false ? {} : assets();
  const rtl = lang === 'ur';
  const fonts = opt.fonts === false ? '' : `@font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.lexendBold});unicode-range:U+0021}`;
  const face = rtl ? "'NastaliqUrdu','Lexend',sans-serif" : "'Lexend','NastaliqUrdu',sans-serif";
  // A name keeps the script it is written in: "Amal" on an Urdu card is its own LTR run.
  const nameDir = URDU_RX.test(f.first || '') ? 'rtl' : 'ltr';
  const jug = a.celebrate ? `<img class="jug" src="data:image/webp;base64,${a.celebrate}" alt="">` : '<div class="jug"></div>';
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#FFF8E7}
.card{position:relative;width:${W}px;height:${H}px;display:flex;align-items:center;gap:40px;padding:56px 72px;background:#FFF8E7;color:#1F2937;font-family:${face};border-bottom:18px solid #15803D}
.jug{width:300px;height:300px;flex:0 0 300px;object-fit:contain}
.txt{flex:1;display:flex;flex-direction:column;gap:${rtl ? 14 : 18}px;min-width:0}
.name{font:800 76px/${rtl ? 1.7 : 1.1} ${face};color:#14532D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:isolate;text-align:${rtl ? 'right' : 'left'}}
.deed{font-weight:${rtl ? 700 : 800};font-size:${rtl ? 44 : 50}px;line-height:${rtl ? 1.9 : 1.2};word-break:keep-all;overflow-wrap:normal;text-wrap:balance}
.st{display:flex;align-items:center;gap:20px;font-weight:700;font-size:${rtl ? 34 : 36}px;line-height:${rtl ? 1.9 : 1.2};color:#92400E}
.brand{position:absolute;${rtl ? 'left' : 'right'}:72px;bottom:34px;font:800 28px/1 'Lexend',sans-serif;color:#15803D;letter-spacing:.04em}
</style></head><body><div class="card">${jug}<div class="txt">
<div class="name" dir="${nameDir}">${esc(f.first || '')}</div>
<div class="deed">${esc(t[f.deed] || '')}</div>
${f.deed === 'read_tried' || /_practice$/.test(f.deed) ? '' : `<div class="st">${STICKER}<span>${esc(t.sticker)}</span></div>`}
</div><div class="brand">JUGNU</div></div></body></html>`;
}

const mem = new Map();
function remember(token, bytes) {
  mem.set(token, bytes);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}
const inflight = new Map();

// Fewer colours until the picture fits: a flat card quantises well, so the first try almost always does.
async function toPng(png, f = {}) {
  const sharp = require('sharp');
  let out = null;
  for (const colors of [64, 32, 16]) {
    out = await sharp(png).resize(W, H, { fit: 'cover' }).png({ palette: true, colors, compressionLevel: 9, effort: 8 }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  // still served (a preview beats none), and said: the kind and the size only, never the token
  logToFile('⚠️ web quiz card v3: picture over 40 KB at 16 colours', { kind: f.kind || null, lang: f.lang || null, bytes: out.length });
  return out;
}

async function drawNow(f) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const png = await htmlToImage(renderCard(f), { width: W, height: H, deviceScaleFactor: 1, selector: '.card' });
  return toPng(png, f);
}

/** {bytes, contentType:'image/png'} for a genuine token; CardError(404) else. Memory-cached by token. */
async function image(token) {
  const f = facts(token);
  if (!f) fail(404, 'not_found');
  if (mem.has(token)) return { bytes: mem.get(token), contentType: 'image/png', from: 'mem' };
  if (inflight.has(token)) return inflight.get(token);
  const p = (async () => {
    // one renderer, one queue: the share pictures' own turn (web-quiz-art.js DRAW_MAX)
    const { drawTurn } = require('./web-quiz-art');
    const bytes = await drawTurn(() => drawNow(f));
    remember(token, bytes);
    return { bytes, contentType: 'image/png', from: 'drawn' };
  })().finally(() => inflight.delete(token));
  inflight.set(token, p);
  return p;
}

/** The shared link's page (/k/<t> at the edge): the deed in words and the return line; CardError(404) else. */
function landing(token) {
  const f = facts(token);
  if (!f) fail(404, 'not_found');
  return { kind: f.kind, lang: f.lang, first: f.first, deed_text: COPY[f.lang][f.deed], ret: returnLine(f.lang) };
}

function _reset() { cache = null; mem.clear(); inflight.clear(); }

module.exports = {
  KEY, SHARE_KEY, DEEDS, COPY, CARD_RETURN_WORDS, CardError, MAX_BYTES,
  on, shareOn, field, mint, image, facts, landing, returnLine, renderCard, _reset, _seal: seal,
};
