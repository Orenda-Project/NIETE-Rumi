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
 * One share for every finish (app_settings web_quiz_share_v4, on top of the card): the page may name the item it
 * finished (`item: {type: 'book'|'video'|'quiz', id}`); the server checks it exists and seals it into the token, so the
 * shared link lands a new child, through the join, on that item (a Jugnu read, story or game: on the Games door, where
 * those live). The picture gets the kind's ribbon and colour (one
 * theme, one mark per activity); the landing's button carries a short ref of the item in the words the child sends.
 *   ref(item) / byRef(ref)  pure / one read: the ref the join words carry (`jb1a2b3c4d` a book, `jv…` a video) and back
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

// The switches and the item refs live in their own small module, so the bot's join and home paths can read them
// without loading the picture's renderer (and its quiz requires).
const Switch = require('./web-quiz-card-switch');
const { KEY, SHARE_KEY, JOINED_KEY, on, shareOn, joinedOn, field, UUID_RX, REF_RX, ref, byRef } = Switch;
// The card's short id (its token hashed) the friend's words carry, kept 90 days against the sharer; never a phone.
const CARD_KEEP_S = 90 * 24 * 60 * 60;
const cardId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 8);
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
    if (f.i && !(ITEM_RX[f.i.t] && ITEM_RX[f.i.t].test(String(f.i.id || '')))) delete f.i;
    return f;
  } catch (_) {
    return null;
  }
}
/** The card's facts for a genuine token, else null. */
function facts(token) {
  const f = open(token);
  if (!f) return null;
  const out = { kind: f.k, deed: f.d, lang: LANG(f.l), first: f.n || '', code: f.c || null };
  // a one-share token (web_quiz_share_v4 when minted): its mark, and the item it lands on
  if (f.s === 4) { out.v4 = true; out.item = f.i ? { type: f.i.t, id: f.i.id } : null; }
  // minted with web_quiz_share_joined on: the friend's words carry the card's short id
  if (f.s === 4 && f.j === 1) out.joined = true;
  // minted with web_quiz_share_data on: the finish's result (score, stars, words, badge), from the server's rows
  if (f.s === 4 && f.x) { const x = require('./web-quiz-card-data').clean(f.x); if (x) out.data = x; }
  // minted with web_quiz_share_card_a on: its picture is design A (web-quiz-card-a.js)
  if (f.s === 4 && f.a === 1) out.a = true;
  // minted with web_quiz_card_ready on: its picture and page are drawn and stored at mint (prepare)
  if (f.s === 4 && f.r === 1) out.ready = true;
  return out;
}

// ─── the item a share lands on (web_quiz_share_v4) ──────────────────────────

const ITEM_RX = Object.freeze({ book: UUID_RX, video: UUID_RX, quiz: CODE_RX, door: /^games$/ });
// The finishes that have no item of their own: the friend lands on the door they live behind.
const DOOR_OF = Object.freeze({ read: 'games', listen: 'games', story: 'games', game: 'games' });
// Which items a finish of each kind may name: a storybook's card its book (also a storybook finished on its questions,
// kind story), a video's its video; a quiz's is its class code, the server's own.
const ITEM_TYPES = Object.freeze({ book: ['book', 'story'], video: ['video'] });
async function readyBook(id) {
  const { data } = await supabase.from('story_books').select('id, status').eq('id', id).maybeSingle();
  return Boolean(data && data.status === 'ready');
}
async function liveVideo(id) {
  const ix = await require('./web-quiz-bank').bank();
  return Boolean(ix && Array.isArray(ix.rows) && ix.rows.some((r) => r.id === id));
}
/** The item a finish names, checked: {t, id} when it is real and of the finish's kind, else null. Never throws. */
async function checkItem(raw, kind, w) {
  try {
    // a class quiz's own code: the server's, never the page's
    if (kind === 'quiz') return w && w.code ? { t: 'quiz', id: w.code } : null;
    const t = raw && typeof raw === 'object' ? raw.type : null;
    const id = String(raw && raw.id != null ? raw.id : '');
    const ok = ITEM_TYPES[t] && ITEM_TYPES[t].includes(kind) && ITEM_RX[t].test(id) && (t === 'book' ? await readyBook(id) : await liveVideo(id));
    if (ok) return { t, id };
    // no item of its own (a Jugnu read, story or game): the door it lives behind
    return DOOR_OF[kind] ? { t: 'door', id: DOOR_OF[kind] } : null;
  } catch (_) {
    return null;
  }
}
// ─── who finished (the server says; the page never names the child) ─────────

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
// A first name as the picture draws it: letters, marks, an apostrophe or a hyphen, at most 24 characters.
function cleanFirst(name) {
  return firstName(name).replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 24);
}

// info (the one share only): told whether the child has a class (`plain`: none, so the Share button says friends)
async function studentFirst(studentId, lang, info) {
  const { data: kid } = await supabase.from('students').select(info ? 'id, student_name, student_name_urdu, list_id' : 'id, student_name, student_name_urdu').eq('id', studentId).maybeSingle();
  if (!kid) return '';
  if (info) info.plain = kid.list_id == null;
  return cleanFirst(require('./web-quiz-roster').displayName(kid, lang));
}

// data (web_quiz_share_data): also the session's score and the run's id, for the card's result
async function who(body, lang, device, info, data = false) {
  const s = typeof body.st === 'string' ? T.verify(body.st, 's') : null;
  if (s && s.sid) {
    const { data: row } = await supabase.from('quiz_sessions').select(data ? 'id, student_id, student_name, share_code_id, status, user_id, correct_answers, total_questions_answered' : 'id, student_id, student_name, share_code_id, status, user_id').eq('id', s.sid).maybeSingle();
    // a child's own finished run; a teacher's test run has no child to name
    if (!row || row.status !== 'completed' || row.user_id) fail(401, 'bad_token');
    let code = null;
    let video = false;
    if (row.share_code_id) {
      const { data: sc } = await supabase.from('quiz_share_codes').select(data ? 'code, video_id' : 'code').eq('id', row.share_code_id).maybeSingle();
      code = sc && CODE_RX.test(String(sc.code || '')) ? String(sc.code) : null;
      video = Boolean(sc && sc.video_id);
    }
    const first = row.student_id ? await studentFirst(row.student_id, lang) : '';
    return { first: first || cleanFirst(row.student_name), code, sid: row.student_id || null, ...(data ? { session: row, video } : {}) };
  }
  const c = typeof body.ct === 'string' ? T.verify(body.ct, 'c') : null;
  if (c && c.sid) return { first: await studentFirst(c.sid, lang, info), code: null, sid: c.sid, ...(data && c.r ? { run: c.r } : {}) };
  const h = typeof body.hub === 'string' ? T.verify(body.hub, 'h') : null;
  if (h && Array.isArray(h.ids)) {
    const ids = h.ids.filter((x) => typeof x === 'string').slice(0, 4);
    const hit = body.kid ? ids.find((id) => T.chipId('h', id) === body.kid) : (ids.length === 1 ? ids[0] : null);
    if (!hit) fail(401, 'bad_token');
    // A forwarded hub link names nobody: only the phone the link is bound to (or one this child played on), as the hub.
    const trust = await require('./web-quiz-hub-device').deviceTrusted(body.hub, device);
    if (!trust.ok || !trust.ids.map(String).includes(String(hit))) fail(403, 'other_device');
    return { first: await studentFirst(hit, lang, info), code: null, sid: hit };
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
  // the one share: the item checked and sealed, and the token marked (its picture and landing are the new ones)
  const v4 = await shareOn();
  // the finish's result on the card (web_quiz_share_data, the same read): from the server's rows, never the page's
  const data = v4 && Switch.dataCached();
  let w;
  const info = v4 ? { plain: false } : null;
  try {
    w = await who(body, lang, device, info, data);
  } catch (err) {
    // the one share on a phone the hub does not know (a forwarded or opened-elsewhere link): a card that names nobody,
    // so the child still sends a picture and a link, never bare words
    if (!(v4 && err instanceof CardError && err.status === 403)) throw err;
    w = { first: '', code: null };
  }
  const item = v4 ? await checkItem(body.item, kind, w) : null;
  // "A friend joined" (web_quiz_share_joined): a card with a child behind it is kept against that child, by its short id
  const joined = v4 && w.sid && Switch.joinedCached();
  const Data = data ? require('./web-quiz-card-data') : null;
  const x = Data ? Data.clean(await Data.resultOf({ kind, item, w, ct: body.ct })) : null;
  const token = seal({ v: 1, k: kind, d: deed, l: lang, n: w.first, ...(kind === 'quiz' && w.code ? { c: w.code } : {}), ...(v4 ? { s: 4, ...(item ? { i: item } : {}), ...(joined ? { j: 1 } : {}), ...(x ? { x } : {}), ...(Switch.cardACached() ? { a: 1 } : {}), ...(Switch.readyCached() ? { r: 1 } : {}) } : {}), t: Math.floor(Date.now() / 1000) });
  if (!token) fail(503, 'web_quiz_off');
  if (joined) {
    try {
      await require('../cache/railway-redis.service').set(`wq:share:card:${cardId(token)}`, { s: String(w.sid) }, CARD_KEEP_S);
    } catch (err) {
      logToFile('⚠️ web quiz card: the card was not kept for "a friend joined" (the share still works)', { error: err.message });
    }
  }
  const long = kind === 'quiz' && w.code ? `/q/${w.code}?k=${token}` : `/k/${token}`;
  // short links on (web_quiz_share_short, the same read): /s/<the card's short id>, else the long link
  const url = v4 && Switch.shortCached() ? (await shortUrl(token)) || long : long;
  const out = { token, url, img: `/wq/card/${token}.png`, ret: returnLine(lang) };
  if (v4) { out.v4 = true; out.item = item ? item.t : null; out.plain = info.plain === true; }
  if (x) out.data = x;
  // ready (web_quiz_card_ready): the picture and the page are drawn and stored now, while the child is still on the
  // finish screen, so the link's preview never waits for a draw (never awaited; a failure leaves today's way)
  if (v4 && Switch.readyCached()) prepare(token).catch(() => {});
  return out;
}

// ─── short links (web_quiz_share_short) ─────────────────────────────────────

const SHORT_RX = /^[0-9a-f]{8}$/;
const shortKey = (id) => `wq:share:short:${id}`;
/** /s/<id>: the card's short id kept 90 days against its token (first come keeps it); null when taken or Redis away. */
async function shortUrl(token) {
  try {
    const id = cardId(token);
    const redis = require('../cache/railway-redis.service');
    if (await redis.setNX(shortKey(id), token, CARD_KEEP_S)) return `/s/${id}`;
    return (await redis.get(shortKey(id))) === token ? `/s/${id}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz card: no short link (the long one goes)', { error: err.message });
    return null;
  }
}
/** A short id back to its card: {token, url} (the long path) for a token that still opens; CardError(404) else. */
async function byShort(id) {
  if (!SHORT_RX.test(String(id || ''))) fail(404, 'not_found');
  let token = null;
  try { token = await require('../cache/railway-redis.service').get(shortKey(id)); } catch (_) { token = null; }
  const f = typeof token === 'string' ? facts(token) : null;
  if (!f) fail(404, 'not_found');
  // an Urdu card names its language, so the edge opens the friend's door in Urdu (an English card's answer is today's)
  return { token, url: f.kind === 'quiz' && f.code ? `/q/${f.code}?k=${token}` : `/k/${token}`, ...(f.lang === 'ur' ? { lang: 'ur' } : {}) };
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

// One theme, one mark per activity (web_quiz_share_v4 tokens only): the ribbon's word and the card's accent colour.
const MARK = Object.freeze({
  quiz: { c: '#1D4ED8', en: 'Quiz', ur: 'کوئز' },
  read: { c: '#C2410C', en: 'Reading', ur: 'پڑھنا' },
  listen: { c: '#7C3AED', en: 'Story', ur: 'کہانی' },
  story: { c: '#7C3AED', en: 'Story', ur: 'کہانی' },
  book: { c: '#7C3AED', en: 'Storybook', ur: 'کہانی کی کتاب' },
  game: { c: '#0F766E', en: 'Game', ur: 'کھیل' },
  video: { c: '#DC2626', en: 'Video', ur: 'ویڈیو' },
});
// The mark follows what was finished: a storybook finished on its questions alone (kind story) wears the book's.
function markOf(f) {
  if (!f.v4) return null;
  const t = f.item && f.item.type;
  return MARK[t === 'book' || t === 'video' ? t : f.kind] || null;
}
function markCss(f, rtl) {
  const m = markOf(f);
  if (!m) return '';
  return `.card{border-bottom-color:${m.c}}.name{color:${m.c}}.brand{color:${m.c}}
.rib{position:absolute;top:0;${rtl ? 'right' : 'left'}:72px;padding:${rtl ? '6px 28px 14px' : '10px 28px 14px'};background:${m.c};color:#fff;font-weight:800;font-size:${rtl ? 30 : 32}px;line-height:${rtl ? 1.6 : 1};border-radius:0 0 18px 18px}
${rtl ? INK_CSS : ''}`;
}
// Room for the ink on an Urdu card of the one share: Nastaliq at line-height 2, and the clipped name padded (the padding
// given back as margin, so nothing moves) so a ک or گ keeps the stroke it throws past the start of its line.
// An Urdu line's closing "!" (drawn in Lexend) set against its last word: on its own it stands a gap apart.
const bang = (html, tight) => (tight ? html.replace(/!$/, '<span class="ex">!</span>') : html);
// The ribbon hangs from the card's top edge: its letters' tops stay inside the card (padding above them, not a clip).
const INK_CSS = `.name{line-height:2;padding:.3em .4em;margin:-.3em -.4em}.deed{line-height:2.1;padding:.4em 0 .25em;margin:-.4em 0 -.25em}.st{line-height:2}.rib{line-height:2;padding:14px 28px 10px}.ex{margin-inline-start:-.08em}
`;
function markHtml(f, lang) {
  const m = markOf(f);
  return m ? `<div class="rib">${esc(m[lang])}</div>` : '';
}

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
${markCss(f, rtl)}</style></head><body><div class="card">${markHtml(f, lang)}${jug}<div class="txt">
<div class="name" dir="${nameDir}">${esc(f.first || '')}</div>
<div class="deed">${bang(esc(t[f.deed] || ''), rtl && f.v4)}</div>
${f.deed === 'read_tried' || /_practice$/.test(f.deed) ? '' : `<div class="st">${STICKER}<span>${bang(esc(t.sticker), rtl && f.v4)}</span></div>`}
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

// Design A (web_quiz_share_card_a tokens): rays, confetti and the medal want more colours; its own budget
const MAX_BYTES_A = 120 * 1024;
async function toPngA(png, f) {
  const sharp = require('sharp');
  let out = null;
  // no dithering: the rays' soft gradients stay smooth bands instead of a speckled grain
  for (const colors of [192, 128, 96]) {
    out = await sharp(png).resize(W, H, { fit: 'cover' }).png({ palette: true, colors, dither: 0, compressionLevel: 9, effort: 8 }).toBuffer();
    if (out.length <= MAX_BYTES_A) return out;
  }
  logToFile('⚠️ web quiz card A: picture over 120 KB at 96 colours', { kind: f.kind || null, lang: f.lang || null, bytes: out.length });
  return out;
}

async function drawNow(f) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  if (f.a) {
    const A = require('./web-quiz-card-a');
    const png = await htmlToImage(A.renderCardA(f, { art: await A.artOf(f) }), { width: W, height: H, deviceScaleFactor: 1, selector: '.card' });
    return toPngA(png, f);
  }
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

// ─── ready before Send (web_quiz_card_ready) ────────────────────────────────

// Where a card's picture and page are kept, shared by every bot and portal process and kept across deploys: the
// stories' bucket, under the token's hash (never the token). The portal reads the same key (dashboard web-quiz.routes).
function storeKey(token, ext) {
  const StoryStore = require('./story-store');
  return `wq-card/${StoryStore.deployEnv()}/${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}.${ext}`;
}
// web_quiz_card_fast: the page's facts also kept in Redis (shared by every portal copy) under the same hash, 14 days.
const CACHE_TTL_S = 14 * 24 * 3600;
function cardCacheKey(token) {
  const StoryStore = require('./story-store');
  return `wq:card:${StoryStore.deployEnv()}:${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}`;
}
/** The page's facts into Redis; false when Redis is away or the write fails. Never throws. */
async function keepFast(token, page) {
  try {
    const redis = require('../cache/railway-redis.service');
    if (!redis || typeof redis.isAvailable !== 'function' || !redis.isAvailable()) return false;
    return (await redis.set(cardCacheKey(token), JSON.stringify(page), CACHE_TTL_S)) !== false;
  } catch (err) {
    logToFile('⚠️ web quiz card: page not kept in Redis (storage still has it)', { error: err.message });
    return false;
  }
}
const prepared = new Map();
/** Draw the card's picture and its page's facts and store both (immutable); once per token per process. Never throws. */
function prepare(token) {
  if (prepared.has(token)) return prepared.get(token);
  const p = (async () => {
    const f = facts(token);
    if (!f || !f.ready) return false;
    const t0 = Date.now();
    try {
      const StoryStore = require('./story-store');
      const r2 = require('../../storage/r2');
      const bucket = StoryStore.storyBucket() || undefined;
      const [pic, page] = await Promise.all([image(token), landing(token)]);
      if (Switch.fastCached()) keepFast(token, page);
      await Promise.all([
        r2.uploadBuffer(pic.bytes, storeKey(token, 'png'), 'image/png', { bucket, cacheControl: StoryStore.IMMUTABLE }),
        r2.uploadBuffer(Buffer.from(JSON.stringify(page)), storeKey(token, 'json'), 'application/json', { bucket, cacheControl: StoryStore.IMMUTABLE }),
      ]);
      logToFile('web quiz card: ready before Send', { kind: f.kind, lang: f.lang, bytes: pic.bytes.length, ms: Date.now() - t0 });
      return true;
    } catch (err) {
      prepared.delete(token);
      logToFile('⚠️ web quiz card: not stored at mint (the preview draws it as before)', { error: err.message, ms: Date.now() - t0 });
      return false;
    }
  })();
  prepared.set(token, p);
  if (prepared.size > MEM_MAX) prepared.delete(prepared.keys().next().value);
  return p;
}

// The name of the item a one-share card lands on (its book's title, its video's lesson), else '', and its cover (the
// book's cover file, the lesson's small picture), only when that picture exists. Never throws.
const COVER_FILE_RX = /^[a-z0-9-]+\.webp$/;
const THUMB_WAIT_MS = 1500;
async function itemOf(item) {
  try {
    if (item && item.type === 'book') {
      const { data } = await supabase.from('story_books').select('id, title, status, cover_file').eq('id', item.id).maybeSingle();
      if (!data || data.status !== 'ready') return { title: '' };
      const cover = COVER_FILE_RX.test(String(data.cover_file || '')) && UUID_RX.test(String(data.id)) ? `/s/${data.id}/${data.cover_file}` : null;
      return { title: String(data.title || '').trim().slice(0, 80), cover };
    }
    if (item && item.type === 'video') {
      const ix = await require('./web-quiz-bank').bank();
      const r = ix && Array.isArray(ix.rows) ? ix.rows.find((x) => x.id === item.id) : null;
      if (!r) return { title: '' };
      // the lesson's small picture (the Videos shelf's), drawn or remembered; a slow or missing one: no cover
      const Thumb = require('./web-quiz-video-thumb');
      const pic = await Promise.race([Thumb.thumb(r.id).catch(() => null), new Promise((ok) => setTimeout(ok, THUMB_WAIT_MS, null).unref())]);
      return { title: String(r.clean_title || '').trim().slice(0, 80), cover: pic ? `/wq/vt/${r.id}.webp?v=${Thumb.VERSION}` : null };
    }
  } catch (_) { /* no name: the landing still has its card and its door */ }
  return { title: '' };
}

/** The shared link's page (/k/<t> at the edge): the deed in words and the return line; CardError(404) else. */
async function landing(token) {
  const f = facts(token);
  if (!f) fail(404, 'not_found');
  const out = { kind: f.kind, lang: f.lang, first: f.first, deed_text: COPY[f.lang][f.deed], ret: returnLine(f.lang) };
  if (f.v4) {
    // the one share's landing: the finish's mark in its colour, the name of what it lands on, and the item's ref in
    // the join words
    const m = markOf(f);
    out.v4 = true;
    out.mark = m ? m[f.lang] : '';
    out.accent = m ? m.c : '#15803D';
    const it = await itemOf(f.item);
    if (it.title) {
      out.item_title = it.title;
      if (it.cover) out.item_cover = it.cover;
    }
    // the join words carry the item's short ref, so the bot lands the new child on it
    const r = ref(f.item);
    if (r) {
      out.ref = r;
      const n = botNumber();
      // with "a friend joined" on when minted: the card's short id right after the ref (one word)
      const words = `${CARD_RETURN_WORDS[f.lang]} ${r}${f.joined ? cardId(token) : ''}`;
      out.ret = { ...out.ret, words, href: n ? `https://wa.me/${n}?text=${encodeURIComponent(words)}` : null };
    }
    // the finish's result, kept at mint: its numbers, and its lines in the card's language (the score, the words,
    // the stars, the badge and the dare); never a reading speed
    // card A (web_quiz_share_card_a): the landing does not repeat what its picture shows
    if (f.a) out.a = true;
    if (f.data) {
      out.result = f.data;
      out.result_text = require('./web-quiz-card-data').words(f.data, f.kind, f.lang);
    }
  }
  return out;
}

function _reset() { Switch._reset(); mem.clear(); inflight.clear(); prepared.clear(); }

module.exports = {
  KEY, SHARE_KEY, DEEDS, COPY, CARD_RETURN_WORDS, CardError, MAX_BYTES, MAX_BYTES_A, MARK, REF_RX, toPngA, prepare, storeKey, cardCacheKey,
  JOINED_KEY, on, shareOn, joinedOn, cardId, field, mint, image, facts, landing, returnLine, renderCard, ref, byRef, byShort, _reset, _seal: seal,
};
