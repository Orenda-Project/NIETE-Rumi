'use strict';
/**
 * PEER PULSE — "Sara got Q4 right ✓" while classmates play the same class code.
 *
 * In memory, per bot process, zero database reads: recordAnswers() pushes each
 * newly recorded RIGHT answer into a small ring per share code; the page reads
 * it back on its next /answers response (piggyback, no extra request) or, when
 * a child sits on one question, through a light idle poll (poll() below).
 *
 *   - Only right answers, never wrong ones. Never the caller's own answers
 *     (compared by a short hash of the session id, so the ring holds no ids).
 *   - Class-code children show their first name as the page shows it (on an
 *     Urdu quiz the class list's Urdu spelling, resolved once per session by
 *     the service); an invited friend carries NO name — the page says
 *     "A friend". No surname, ever.
 *   - Bounded: the last 30 events per code, each lives 120 s, at most 2,000
 *     codes (the least recently active code is dropped first).
 *   - With N bot replicas each process sees only its own share of the answers:
 *     fewer pulses, never a wrong one.
 */
const crypto = require('crypto');
const T = require('./web-quiz-token');

const RING_MAX = 30;
const TTL_MS = 120 * 1000;
const CODES_MAX = 2000;
const SINCE_MAX = 3;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RX = /^[A-Z0-9]{4,12}$/;
const FIRST_MAX = 24;

const NAMES_MAX = 5000;
const rings = new Map();   // shareCodeId -> [{h, first, invited, qn, at}], Map order = least recently active first
const codeIds = new Map(); // code -> {id, until}: the idle poll's one lookup per code per process
const names = new Map();   // sha8(session id) -> the first name the page shows for that child (once per session)
let clock = null;
const now = () => (clock ? clock() : Date.now());

const hashOf = (sessionId) => crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 8);

function fresh(list, t) {
  let i = 0;
  while (i < list.length && t - list[i].at >= TTL_MS) i += 1;
  return i ? list.slice(i) : list;
}

/** Record one right answer. Returns false (and stores nothing) for an event it cannot show. */
function push({ shareCodeId, sessionId, first, qn, invited = false } = {}) {
  if (!shareCodeId || !sessionId || !Number.isInteger(qn) || qn < 1) return false;
  const name = invited ? null : String(first || '').trim().split(/\s+/)[0].slice(0, FIRST_MAX);
  if (!invited && !name) return false;
  const t = now();
  const list = fresh(rings.get(shareCodeId) || [], t);
  list.push(invited ? { h: hashOf(sessionId), first: null, invited: true, qn, at: t } : { h: hashOf(sessionId), first: name, qn, at: t });
  rings.delete(shareCodeId); // re-insert: newest activity last
  rings.set(shareCodeId, list.length > RING_MAX ? list.slice(-RING_MAX) : list);
  while (rings.size > CODES_MAX) rings.delete(rings.keys().next().value);
  return true;
}

/** The name already resolved for this session (undefined when not yet looked up). */
function knownName(sessionId) {
  return names.get(hashOf(sessionId));
}

/** Remember the shown name of a session (bounded; the oldest is forgotten first). Returns the name. */
function rememberName(sessionId, name) {
  const h = hashOf(sessionId);
  names.delete(h);
  names.set(h, name);
  while (names.size > NAMES_MAX) names.delete(names.keys().next().value);
  return name;
}

/** Other children's right answers after `sinceMs` (server ms), newest first, at most `max`. */
function since({ shareCodeId, sessionId, sinceMs = 0, max = SINCE_MAX } = {}) {
  const list = rings.get(shareCodeId);
  if (!list) return [];
  const t = now();
  const live = fresh(list, t);
  if (live !== list) rings.set(shareCodeId, live);
  const mine = hashOf(sessionId);
  const after = Number(sinceMs) || 0;
  const out = [];
  for (let i = live.length - 1; i >= 0 && out.length < max; i -= 1) {
    const e = live[i];
    if (e.at <= after || e.h === mine) continue;
    out.push(e.invited ? { first: null, invited: true, qn: e.qn, at: e.at } : { first: e.first, qn: e.qn, at: e.at });
  }
  return out;
}

/**
 * How many different children of this class code got a question right in the last 2 minutes
 * (distinct session hashes in the ring) — "3 classmates are playing right now". A count only.
 * Right answers are what the ring holds, so a child with only wrong answers so far is not counted:
 * the number can be low, never high.
 */
function liveNow(shareCodeId) {
  const list = rings.get(shareCodeId);
  if (!list) return 0;
  return new Set(fresh(list, now()).map((e) => e.h)).size;
}

/**
 * GET /pulse/:code?st=&since= — the idle poll. The signed session token names the
 * session and its class code, so no session row is read; the code's id is looked
 * up once per process and cached (a challenge code resolves to its class code,
 * exactly as resolveCode does for every other endpoint).
 */
async function poll(rawCode, { st, since: sinceMs } = {}, WQ) {
  // WQ = the web-quiz service (resolveCode, WqError), passed in by the router: the service
  // requires this module, so requiring it back here would be a cycle.
  if (!T.secret()) throw new WQ.WqError(503, { error: 'web_quiz_off' });
  const tok = T.verify(st, 's');
  if (!tok || !tok.sid || !tok.sc) throw new WQ.WqError(401, { error: 'bad_token' });
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RX.test(code)) throw new WQ.WqError(404, { error: 'not_found' });
  const t = now();
  let hit = codeIds.get(code);
  if (!hit || hit.until <= t) {
    const ctx = await WQ.resolveCode(code);
    hit = { id: ctx.shareCodeId, until: t + CODE_TTL_MS };
    codeIds.delete(code);
    codeIds.set(code, hit);
    while (codeIds.size > CODES_MAX) codeIds.delete(codeIds.keys().next().value);
  }
  if (hit.id !== tok.sc) throw new WQ.WqError(401, { error: 'bad_token' });
  return { pulse: since({ shareCodeId: tok.sc, sessionId: tok.sid, sinceMs }) };
}

module.exports = {
  push, since, poll, liveNow, knownName, rememberName,
  RING_MAX, TTL_MS, CODES_MAX,
  // tests
  _reset: () => { rings.clear(); codeIds.clear(); names.clear(); },
  _setClock: (fn) => { clock = fn || null; },
  _size: () => rings.size,
};
