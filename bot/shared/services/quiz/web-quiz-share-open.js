'use strict';
/**
 * A SHARED CARD LANDS THE NEW CHILD ON ITS ITEM (app_settings web_quiz_share_v4, default OFF).
 *
 * A shared card's landing (/k/<t>) sends the friend to this bot with the return words and the item's short ref
 * ("quiz please jb1a2b3c4d": web-quiz-card-switch.js ref()). The one door keeps that item for the phone; the home link the
 * phone gets next — the join's, the bind pick's, or a known child's hub reply — opens it (#story/<id> | #watch/<vid> | #games,
 * which the home already opens on load). Once: the item is taken when its link is made.
 *
 *   refOf(text)                 pure: the one ref token in a message, or null
 *   refMenu(text)               true when the message is the menu words with one ref and the switch is on (no ref: no read)
 *   note(phone, text)           the item behind the message's ref, kept for this phone (24 h); true when kept
 *   hashFor(phone)              '#story/<id>' | '#watch/<vid>' | '#games' for the kept item (taken), else ''
 *   withOpen(phone, url)        a home link (/h/… or https://…/h/…) with the kept item's hash; the url unchanged else
 *
 * The phone is never a key in the clear (a keyed hash of its digits, with the family-phone salt where it is set).
 * Switch off: nothing is kept and nothing is looked for: the join and the hub reply call withOpen() only when the switch
 * read they already make says on (HubFlags.shareOpenNow, the join's flags). A message without a ref reads nothing.
 * Never throws.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Card = require('./web-quiz-card-switch');

const TTL_S = 24 * 60 * 60;
// the item's ref, and (web_quiz_share_joined when the card was minted) the card's short id right after it
const REF_TOKEN_RX = /^j[bvg][0-9a-f]{8}([0-9a-f]{8})?$/;
// "A friend joined from your card!": the sharer's count and its day (PKT), 90 days; once per card per friend phone
const JOINED_S = 90 * 24 * 60 * 60;
const PKT_MS = 5 * 3600 * 1000;
const dayPkt = (now = Date.now()) => new Date(now + PKT_MS).toISOString().slice(0, 10);
// The sharer's friends are counted per day in Pakistan ("today"), kept two days so a late-evening count is still read
const DAY_KEEP_S = 2 * 24 * 60 * 60;
const friendsKey = (studentId, day = dayPkt()) => `wq:share:joined:n:${studentId}:${day}`;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME_RX = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?)?\/h\/[A-Za-z0-9._~-]+(\?[^#\s]*)?$/;

const redis = () => require('../cache/railway-redis.service');
const digits = (p) => String(p == null ? '' : p).replace(/\D/g, '');
// keyed by the family-phone salt (WQ_TOMB_SALT) where it is set, so a key read from Redis names no phone
const keyOf = (phone) => {
  const salt = process.env.WQ_TOMB_SALT;
  const h = salt ? crypto.createHmac('sha256', salt) : crypto.createHash('sha256');
  return `wq:share:open:${h.update(digits(phone)).digest('hex').slice(0, 32)}`;
};

function refOf(text) {
  const toks = String(text == null ? '' : text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = toks.filter((t) => REF_TOKEN_RX.test(t));
  return hits.length === 1 ? hits[0] : null;
}

async function refMenu(text) {
  try {
    if (!refOf(text) || !(await Card.shareOn())) return false;
    return require('./quiz-menu-request').isQuizMenuRequest(text, { ref: true });
  } catch (_) {
    return false;
  }
}

// The language of a shared card's words: Urdu script → 'ur' (the Urdu card's words), else 'bi' (the English card's,
// the landing's English with its Urdu lines); null with no ref or the switch off. Never throws.
async function cardLang(text) {
  try {
    if (!refOf(text) || !(await Card.shareOn())) return null;
    return /[\u0600-\u06FF]/.test(String(text)) ? 'ur' : 'bi';
  } catch (_) {
    return null;
  }
}

async function note(phone, text) {
  try {
    const r = refOf(text);
    if (!r || digits(phone).length < 10 || !(await Card.shareOn())) return false;
    const item = await Card.byRef(r.slice(0, 10));
    if (!item) return false;
    await redis().set(keyOf(phone), { type: item.type, id: item.id, ...(r.length > 10 ? { c: r.slice(10) } : {}) }, TTL_S);
    return true;
  } catch (err) {
    logToFile('⚠️ share open: the item was not kept', { error: err.message });
    return false;
  }
}

// opts.fresh {id, set}: a NEW child just joined on this phone (the join's own word; `set` the children it had before)
async function hashFor(phone, opts = null) {
  try {
    if (digits(phone).length < 10) return '';
    // nothing kept (every message without a ref, and every phone with the switch off): no settings read at all
    const k = keyOf(phone);
    const v = await redis().get(k);
    if (!v) return '';
    await redis().delete(k);
    if (opts && opts.fresh && typeof v.c === 'string') await credit(v.c, phone, opts.fresh);
    if (!(await Card.shareOn())) return '';
    if (v.type === 'door' && v.id === 'games') return '#games';
    if (!UUID_RX.test(String(v.id || ''))) return '';
    if (v.type === 'book') return `#story/${String(v.id).toLowerCase()}`;
    if (v.type === 'video') return `#watch/${String(v.id).toLowerCase()}`;
    return '';
  } catch (err) {
    logToFile('⚠️ share open: the kept item was not read', { error: err.message });
    return '';
  }
}

async function withOpen(phone, url, opts = null) {
  if (typeof url !== 'string' || !HOME_RX.test(url)) return url;
  const h = await hashFor(phone, opts);
  return h ? url + h : url;
}

/**
 * A new child joined on the phone a card's words came from (web_quiz_share_joined): the card's sharer gains one friend
 * — never when the sharer is already on that phone (a sibling is not a new friend), and once per card per phone.
 * The keys carry the card's short id and the phone's hash, never the phone or the friend. Never throws.
 */
async function credit(c, phone, fresh) {
  try {
    if (!/^[0-9a-f]{8}$/.test(c) || !(await Card.joinedOn())) return false;
    const card = await redis().get(`wq:share:card:${c}`);
    const s = card && typeof card.s === 'string' ? card.s : null;
    if (!s || s === String(fresh.id) || (fresh.set || []).map(String).includes(s)) return false;
    if (!(await redis().setNX(`wq:share:joined:once:${c}:${keyOf(phone).slice(-32)}`, 1, JOINED_S))) return false;
    const k = friendsKey(s);
    const count = Number(await redis().incr(k)) || 0;
    await redis().expire(k, DAY_KEEP_S);
    // the count and nothing else: no friend, no sharer, no phone
    logEvent('share_joined', { count });
    return true;
  } catch (err) {
    logToFile('⚠️ share open: a friend\'s join was not counted', { error: err.message });
    return false;
  }
}

/** The sharer's friends today (a day in Pakistan): {n} when web_quiz_share_joined is on and one joined today, else null.
 * A count, never who or when. */
async function friendsOf(studentId) {
  try {
    if (!studentId || !(await Card.joinedOn())) return null;
    const n = Number(await redis().get(friendsKey(studentId))) || 0;
    return n > 0 ? { n } : null;
  } catch (_) {
    return null;
  }
}

module.exports = { refOf, refMenu, cardLang, note, hashFor, withOpen, credit, friendsOf, REF_TOKEN_RX, TTL_S, _keyOf: keyOf };
