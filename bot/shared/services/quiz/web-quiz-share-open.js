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
 * The phone is never a key in the clear (a hash of its digits). Switch off: nothing is kept, and no setting is read
 * (a home link asks Redis for a kept item that is never there). A message without a ref reads nothing. Never throws.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const Card = require('./web-quiz-card-switch');

const TTL_S = 24 * 60 * 60;
const REF_TOKEN_RX = /^j[bvg][0-9a-f]{8}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME_RX = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?)?\/h\/[A-Za-z0-9._~-]+(\?[^#\s]*)?$/;

const redis = () => require('../cache/railway-redis.service');
const digits = (p) => String(p == null ? '' : p).replace(/\D/g, '');
const keyOf = (phone) => `wq:share:open:${crypto.createHash('sha256').update(digits(phone)).digest('hex').slice(0, 32)}`;

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

async function note(phone, text) {
  try {
    const r = refOf(text);
    if (!r || digits(phone).length < 10 || !(await Card.shareOn())) return false;
    const item = await Card.byRef(r);
    if (!item) return false;
    await redis().set(keyOf(phone), { type: item.type, id: item.id }, TTL_S);
    return true;
  } catch (err) {
    logToFile('⚠️ share open: the item was not kept', { error: err.message });
    return false;
  }
}

async function hashFor(phone) {
  try {
    if (digits(phone).length < 10) return '';
    // nothing kept (every message without a ref, and every phone with the switch off): no settings read at all
    const k = keyOf(phone);
    const v = await redis().get(k);
    if (!v) return '';
    await redis().delete(k);
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

async function withOpen(phone, url) {
  if (typeof url !== 'string' || !HOME_RX.test(url)) return url;
  const h = await hashFor(phone);
  return h ? url + h : url;
}

module.exports = { refOf, refMenu, note, hashFor, withOpen, REF_TOKEN_RX, TTL_S, _keyOf: keyOf };
