'use strict';
/**
 * The signed id of a web-quiz share picture (pure; no database): "<kind>.<ref>.<mac12>".
 *
 *   c  my card     ref = the session id
 *   i  the invite  ref = the challenge code
 *   l  my class    ref = the class code, or the sharer's session
 *   s  my school   ref = the class code
 *
 * A link preview fetches the picture with no session, so the id itself is the
 * permission; the mac stops anyone making the server draw for an id it never
 * issued. A session id travels as its 16 bytes in base64url (22 characters);
 * a code is at most 12, so a 22-character ref is always a session.
 * Its own module so web-quiz.service (which hands ids out) and web-quiz-art
 * (which draws them) need not require each other.
 */
const crypto = require('crypto');
const T = require('./web-quiz-token');

const MAC_LEN = 12;
const KIND_RX = /^[cils]$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RX = /^([cils])\.([A-Za-z0-9_-]{4,24})\.([A-Za-z0-9_-]{12})$/;

function mac(kind, ref) {
  const key = T.secret();
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(`wq-art|${kind}|${ref}`).digest('base64url').slice(0, MAC_LEN);
}

function encRef(ref) {
  if (UUID_RX.test(String(ref))) return Buffer.from(String(ref).replace(/-/g, ''), 'hex').toString('base64url');
  return String(ref || '').toUpperCase();
}
function decRef(enc) {
  if (enc.length !== 22) return enc;
  const h = Buffer.from(enc, 'base64url').toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The signed id of one picture, or null when signing is off (no secret). */
function artId(kind, ref) {
  if (!KIND_RX.test(kind) || !ref) return null;
  const m = mac(kind, String(ref));
  return m ? `${kind}.${encRef(ref)}.${m}` : null;
}

/** {kind, ref} for an id this server issued, else null. */
function parseArtId(id) {
  const x = ID_RX.exec(typeof id === 'string' ? id : '');
  if (!x) return null;
  const ref = decRef(x[2]);
  const want = mac(x[1], ref);
  if (!want || want.length !== x[3].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(x[3]))) return null;
  return { kind: x[1], ref };
}

module.exports = { artId, parseArtId, UUID_RX };
