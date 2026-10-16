'use strict';
/**
 * The keyed child key for the web quiz's events, and the v2 event envelope.
 *
 *   kid  = hex(HMAC-SHA256(K, 'kid|'  + canonical id, lower-case))[0:16]   a child, countable without a name or phone
 *   dk   = hex(HMAC-SHA256(K, 'dev|'  + device ref))[0:12]                 a phone, the per-device count beside a kid
 *   cls  = hex(HMAC-SHA256(K, 'cls|'  + class id, lower-case))[0:12]       a class
 *   ukey = hex(HMAC-SHA256(K, 'ukey|' + normalised phone))[0:16]           an unknown phone, never beside kid/dk/cls
 *
 * K is the env var WEB_QUIZ_KID_KEY (at least 32 bytes; never in the logs, the repo or the page, and not the token
 * secret, so rotating that never moves a kid); WEB_QUIZ_KID_KEY_V labels it (the academic year it starts, e.g.
 * '2026') and rides every v2 event as kid_v. The key turns on 1 April and the old one is destroyed, so a kid is
 * comparable only inside one kid_v.
 *
 * No key (or a short one): every key is null and web_quiz.kid_key_missing is logged at most once per Pakistan day
 * per process. Never a fallback to an unkeyed hash: anyone holding the phone could recompute one.
 *
 * envelope(fields) is the v2 event shape {w, ev_v: 2, kid_v, kid|null, ...fields}. When the event carries a kid,
 * every id that would let a row be joined back to a phone, a share code or a session is removed from it.
 */
const crypto = require('crypto');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');

const KEY_ENV = 'WEB_QUIZ_KID_KEY';
const KEY_V_ENV = 'WEB_QUIZ_KID_KEY_V';
const MIN_KEY_BYTES = 32;
const PKT_MS = 5 * 3600 * 1000;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE_RX = /^\d{10,15}$/;
const KEY_V_RX = /^[A-Za-z0-9._-]{1,16}$/;
// Never on an event that carries a kid (device, unkeyed device hash, session, share code, raw ids, phone, name, token).
const FORBIDDEN = new Set(['device_ref', 'dr', 'dh', 'sid', 'code', 'code_h', 'to_h', 'share_code', 'share_code_id', 'shareCodeId',
  'sessionId', 'session_id', 'student_id', 'studentId', 'class_id', 'classId', 'userId', 'user_id', 'name', 'token', 'ukey']);
const FORBIDDEN_RX = /^phone/i;

let missingDay = null;

const pktDay = (now = Date.now()) => new Date(now + PKT_MS).toISOString().slice(0, 10);

/** The key label ('2026'), or null when unset or malformed. */
function kidV() {
  const v = String(process.env[KEY_V_ENV] || '').trim();
  return KEY_V_RX.test(v) ? v : null;
}

function noteMissing(now) {
  const day = pktDay(now);
  if (missingDay === day) return;
  missingDay = day;
  logEvent('web_quiz.kid_key_missing', { w: 's', ev_v: 2, kid_v: kidV(), kid: null });
}

function key(now) {
  const k = process.env[KEY_ENV];
  if (typeof k === 'string' && Buffer.byteLength(k, 'utf8') >= MIN_KEY_BYTES) return k;
  noteMissing(now);
  return null;
}

function mac(domain, value, len, now) {
  const k = key(now);
  if (!k) return null;
  return crypto.createHmac('sha256', k).update(`${domain}|${value}`).digest('hex').slice(0, len);
}

const uuidOf = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return UUID_RX.test(s) ? s : null;
};

/** A child's key from its canonical id (a uuid, after the merge fold). Null for anything else, or without the key. */
function kid(canonicalId, { now = Date.now() } = {}) {
  const id = uuidOf(canonicalId);
  return id ? mac('kid', id, 16, now) : null;
}

/** A phone's key from its device ref (one the token module could have minted). */
function dk(deviceRef, { now = Date.now() } = {}) {
  const ref = T.cleanDeviceRef(deviceRef);
  return ref ? mac('dev', ref, 12, now) : null;
}

/** A class's key from its class id. */
function cls(classId, { now = Date.now() } = {}) {
  const id = uuidOf(classId);
  return id ? mac('cls', id, 12, now) : null;
}

/** An unknown phone's key from its normalised number (digits only). */
function ukey(phoneNorm, { now = Date.now() } = {}) {
  const p = typeof phoneNorm === 'string' && PHONE_RX.test(phoneNorm) ? phoneNorm : null;
  return p ? mac('ukey', p, 16, now) : null;
}

/** The v2 envelope of an event's fields; with a kid present the forbidden ids are removed. Pure (but kidV). */
function envelope(fields = {}) {
  const out = { w: 's', ev_v: 2, kid_v: kidV(), kid: null, ...fields };
  if (out.kid) {
    for (const k of Object.keys(out)) if (FORBIDDEN.has(k) || FORBIDDEN_RX.test(k)) delete out[k];
  }
  return out;
}

// kidOf / dkOf / clsOf / ukeyOf: the names the callers use (the same functions).
module.exports = { kid, dk, cls, ukey, kidOf: kid, dkOf: dk, clsOf: cls, ukeyOf: ukey, kidV, envelope, pktDay, KEY_ENV, KEY_V_ENV, _reset: () => { missingDay = null; } };
