'use strict';
/**
 * Keyed ids for FLN Send to teacher (PR-E): what leaves the server, or reaches a log or an event row, instead of
 * a users.id or a phone number.
 *
 *   teacherKey(id) = hex(HMAC-SHA256(K, 'fln-teacher|' + users.id))[0:16]        a teacher in a leader's picker
 *   userKey(id)    = hex(HMAC-SHA256(WEB_QUIZ_KID_KEY, 't|' + users.id))[0:16]   a user on a log line / event row
 *
 * userKey IS web-quiz-kid `tk` (the one helper for the teacher reference; the portal's userKeyOf calls it too), so a
 * `send` row's clip (the recipient's userKey) joins that recipient's own `open_link` row. Null without a
 * WEB_QUIZ_KID_KEY of at least 32 bytes — never an unkeyed hash. Required when called, so the portal, which loads
 * this module for teacherKey, never loads web-quiz-kid through it.
 *
 * teacherKey's K is derived from INTERNAL_API_KEY (the bot and the portal both hold it) and this environment's
 * Supabase host, under its OWN label — the app-login-link.js pattern — so a picker key from one environment means
 * nothing in another, and it is never the event-row key. The portal maps a picker key back by recomputing it over
 * the leader's own scope, so a key outside that scope matches nobody. No key here → null.
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'fln-keys-v1';

function environment() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return null;
  try {
    const { protocol, host } = new URL(String(raw).trim());
    if (!host || !/^https?:$/.test(protocol)) return null;
    return host.toLowerCase();
  } catch (_) {
    return null;
  }
}

function key() {
  const k = process.env.INTERNAL_API_KEY;
  const env = environment();
  if (!k || !env) return null;
  return crypto.createHmac('sha256', k).update(`${DERIVE_LABEL}\u0000${env}`).digest();
}

function mac(domain, userId) {
  const id = userId == null ? '' : String(userId).trim();
  const k = key();
  if (!id || !k) return null;
  return crypto.createHmac('sha256', k).update(`${domain}|${id}`).digest('hex').slice(0, 16);
}

const teacherKey = (userId) => mac('fln-teacher', userId);
const userKey = (userId) => require('./quiz/web-quiz-kid').tk(userId);
const KEY_RX = /^[0-9a-f]{16}$/;

module.exports = { teacherKey, userKey, KEY_RX };
