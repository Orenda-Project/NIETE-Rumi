'use strict';
/**
 * The bot's page security headers, carried through the portal's relays (app_settings quiz_edge_security_headers).
 *
 * The relays (teacher home, quiz maker / family door, the one door, the teacher report, the teacher's stories page)
 * forward the bot's bytes and set their own small header set; the bot's own security headers never reached the phone.
 * With the switch ON, a relayed answer also carries the bot's:
 *   Content-Security-Policy, X-Content-Type-Options, X-Frame-Options   (the bot's value replaces any the edge set)
 *   Referrer-Policy                                                     (only when the edge set none: never two values)
 * Nothing else the bot sends is passed on. Redirects and the edge's own pages are not changed.
 *
 * Default OFF. ON only when the stored value is the JSON boolean true: the string 'true', '"true"', 1, {}, no row,
 * no database client or a failed read are all OFF. Read by the web quiz's switch reader (web-quiz-brotli-flag.js):
 * never per request, at most one background read per 30 s per process, and only once a bot answer carried one of
 * these headers. OFF: every relayed answer's headers and bytes are exactly today's.
 */
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'quiz_edge_security_headers';
const CARRIED = [
  ['content-security-policy', 'Content-Security-Policy'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['x-frame-options', 'X-Frame-Options'],
];
const REFERRER = ['referrer-policy', 'Referrer-Policy'];
const ALLOW = [...CARRIED, REFERRER].map(([k]) => k);
const MAX_LEN = 4096;

/** The allowlisted security headers of a bot answer (a fetch Response's headers), or null when it sent none. */
function securityOf(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const out = {};
  ALLOW.forEach((k) => {
    const v = headers.get(k);
    if (typeof v === 'string' && v.length > 0 && v.length <= MAX_LEN && !/[\r\n]/.test(v)) out[k] = v;
  });
  return Object.keys(out).length ? out : null;
}

/**
 * Sets the bot's carried headers on a relayed answer when the switch is on. `on` is the switch (a function → boolean);
 * it is asked only when the bot sent one of the headers. Never throws: a failure leaves today's headers.
 */
function carryBotSecurity(res, out, on) {
  const sec = out && out.security;
  if (!sec || typeof on !== 'function') return;
  try {
    if (on() !== true) return;
    CARRIED.forEach(([k, name]) => { if (sec[k]) res.set(name, sec[k]); });
    if (sec[REFERRER[0]] && !res.get(REFERRER[1])) res.set(REFERRER[1], sec[REFERRER[0]]);
  } catch (_) { /* never decides a response */ }
}

/** The switch reader for `key`, on the web quiz's rule and cache (tests pass db/now). */
function createEdgeSecurityFlag(opts = {}) {
  return createBrotliFlag({ ...opts, key: KEY });
}

let shared = null;
/** The process's one switch (shared by every relay). */
function edgeSecurityOn() {
  if (!shared) shared = createEdgeSecurityFlag();
  return shared();
}

module.exports = { KEY, ALLOW, securityOf, carryBotSecurity, createEdgeSecurityFlag, edgeSecurityOn };
