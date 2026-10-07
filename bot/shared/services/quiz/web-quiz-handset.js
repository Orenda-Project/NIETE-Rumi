'use strict';
/**
 * THE ONE-SHOT HANDSET LINK — a chat child is their old self on the web page.
 *
 * The chat route knows a child by the parent's phone (students.phone); the web page knows a
 * child by a browser (quiz_sessions.device_ref). At the one moment the bot knows BOTH the phone
 * and the page it is about to send — the old-link redirect — it already looks the phone's
 * children up. This module keeps those ids server-side (Redis, one hour) under a random nonce
 * and puts only the signed nonce on the button's URL, in the FRAGMENT: never sent to a server,
 * never in a log, never seen by a link-preview crawler. The phone never reaches the page.
 *
 *   withLink(url, ids, shareCodeId)   the bot, sending a web link to ONE phone: `url#x=<token>`
 *                                     once the Redis entry is written — else `url` unchanged
 *                                     (no nonce ever ships without its entry).
 *   bind({code, x, device_ref})       the page, on landing (the fragment is kept in sessionStorage
 *                                     and dropped from the address bar first): spends the nonce
 *                                     (first device wins; the same device may retry), mints the
 *                                     device when the browser has none, trusts that device for
 *                                     the ids exactly as the hub does (the same Redis keys, so
 *                                     hubChipKid / deviceMayName accept the chips unchanged), and
 *                                     answers the children as chips for THIS code: one child =
 *                                     straight in, several = "Who is playing?" cards.
 *                                     → { kids:[{chip, first, animal}], one, device_ref }
 *
 * MERGES. A page-made row on that browser that looks like the same child — canonical name equal
 * to exactly ONE of the handset's children, the same teacher, made before the link was sent, no
 * class list, nothing open — is a would-merge CANDIDATE. Phase 1 logs it
 * (`web_quiz.handset_would_merge`) and moves nothing: the log says how precise the rule is before
 * any row moves. With app_settings `web_quiz_handset_merge` on, the candidate goes to the SQL
 * function `web_quiz_merge_student` (service role only; moves every FK in one transaction and
 * writes the moved row ids to record_history). Nothing is ever written "because it was on the
 * same phone".
 *
 * Flags: `web_quiz_handset_link` (mint + bind), `web_quiz_handset_merge` (auto-merge), both
 * read like web-quiz-old-link.js (30 s cache, fail closed, OFF unless the row says true). Off =
 * the bare URL, 503 on bind, no Redis touched, nothing written. Telemetry: ids and counts only.
 *
 * A LEAF MODULE: supabase, Redis, the token signer, the hub's device trust and the identity
 * canon. It must not require web-quiz.service (which requires it) nor the chat engine.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const HubDevice = require('./web-quiz-hub-device');

const LINK_KEY = 'web_quiz_handset_link';
const MERGE_KEY = 'web_quiz_handset_merge';
const TTL_MS = 30 * 1000;
const ENTRY_PREFIX = 'wq:x:';          // the nonce's ids: {ids, sc, at}
const CLAIM_PREFIX = 'wq:x:used:';     // the device that spent it
const IDS_MAX = 10;                    // as the chat route's findByPhone
const PAST_ROWS_MAX = 50;
const OPEN_RUN_S = 60 * 60;
const ACTOR = 'web_quiz_handset';
let cache = null; // { at, link, merge }

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 32);
const entryKey = (n) => ENTRY_PREFIX + sha(n);
const claimKey = (n) => CLAIM_PREFIX + sha(n);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

class HandsetError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = { error: code, ...extra };
  }
}
let ErrorClass = HandsetError;
const fail = (status, code, extra) => {
  if (ErrorClass === HandsetError) throw new HandsetError(status, code, extra);
  throw new ErrorClass(status, { error: code, ...(extra || {}) });   // the caller's class (web-quiz.service WqError), as hub-door
};

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** The two flags, read like web-quiz-hub-flags.js: cached 30 s, both false on any read error (never cached). */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [LINK_KEY, MERGE_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, link: isTrue(by[LINK_KEY]), merge: isTrue(by[MERGE_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ handset link: settings lookup failed — off', { error: err.message });
    return { link: false, merge: false };
  }
}
const on = async () => (await flags()).link;

function redisStore() {
  const redis = require('../cache/railway-redis.service');
  return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
}

/**
 * `url#x=<token>` for these children (the phone's known student ids) once their entry is in Redis;
 * `url` unchanged when the link is off, there is nobody to carry, Redis is down or the write failed.
 * Never throws.
 */
async function withLink(url, studentIds, shareCodeId = null) {
  try {
    const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).map(String).filter(Boolean))].slice(0, IDS_MAX);
    if (!url || !ids.length || !(await on())) return url;
    const redis = redisStore();
    if (!redis) return url;
    const n = T.newNonce();
    const x = T.signHandset({ n, shareCodeId });
    if (!x) return url;
    const ok = await redis.set(entryKey(n), { ids, sc: shareCodeId || null, at: Date.now() }, T.HANDSET_TTL_S);
    if (ok === false) return url;
    logEvent('web_quiz.handset_minted', { shareCodeId: shareCodeId || null, kids: ids.length });
    return `${url}#x=${x}`;
  } catch (err) {
    logToFile('⚠️ handset link: no token on the link', { error: err.message });
    return url;
  }
}

/** The class code a page code belongs to: {id, own, language, teacher}, following an invite to its parent. */
async function rootCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(c)) fail(400, 'bad_request', { why: 'code' });
  const { data: row } = await supabase.from('quiz_share_codes').select('id, language, parent_share_code_id, teacher_user_id').eq('code', c).maybeSingle();
  if (!row) fail(404, 'unknown_code');
  if (!row.parent_share_code_id) return { id: row.id, own: row.id, language: row.language, teacher: row.teacher_user_id || null };
  const { data: parent } = await supabase.from('quiz_share_codes').select('id, language, teacher_user_id').eq('id', row.parent_share_code_id).maybeSingle();
  return {
    id: parent ? parent.id : row.parent_share_code_id, own: row.id,
    language: (parent && parent.language) || row.language, teacher: (parent && parent.teacher_user_id) || row.teacher_user_id || null,
  };
}

/** The handset's children among `ids` that are still active (a merged or removed child is not offered). */
async function kidsOf(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('students')
    .select('id, student_name, student_name_urdu, list_id, enrolled_by_user_id, is_active, status, created_at')
    .in('id', ids).eq('is_active', true);
  if (error) throw new Error(error.message || 'students read failed');
  const by = new Map((data || []).filter((r) => r.status !== 'merged').map((r) => [String(r.id), r]));
  return ids.map((id) => by.get(String(id))).filter(Boolean);
}

/** True when the row has a sitting still in its window, or a reading run still being scored. */
async function hasOpenRow(studentId) {
  const nowIso = new Date().toISOString();
  const { data: open } = await supabase.from('quiz_sessions').select('id, expires_at').eq('student_id', studentId).eq('status', 'in_progress').limit(20);
  if ((open || []).some((s) => s.expires_at && String(s.expires_at) > nowIso)) return true;
  const since = new Date(Date.now() - OPEN_RUN_S * 1000).toISOString();
  try {
    const { data: runs } = await supabase.from('web_quiz_challenge_runs').select('id, created_at').eq('student_id', studentId).eq('status', 'scoring').limit(5);
    return (runs || []).some((r) => r.created_at && String(r.created_at) > since);
  } catch (_) {
    return true;   // when the table cannot be read, treat the row as open: never merge blind
  }
}

/**
 * The would-merge candidates on this browser: page-made rows (no phone, no class list, active) it has
 * played as, created BEFORE the link was minted, whose canonical name equals exactly ONE of the
 * handset's children of the SAME teacher, with nothing open. → [{from, to}].
 */
async function mergeCandidates(deviceRef, kids, mintedAt) {
  const Identity = require('./web-quiz-identity');
  const canonOf = (name) => { try { return Identity.canon(name) || ''; } catch (_) { return ''; } };
  const byCanon = new Map();
  const dupes = new Set();
  for (const k of kids) {
    const c = canonOf(k.student_name);
    if (!c) continue;
    if (byCanon.has(c)) dupes.add(c); else byCanon.set(c, k);
  }
  const { data: played } = await supabase.from('quiz_sessions').select('student_id').eq('device_ref', deviceRef).not('student_id', 'is', null).limit(PAST_ROWS_MAX);
  const ids = [...new Set((played || []).map((r) => String(r.student_id)))].filter((id) => !kids.some((k) => String(k.id) === id));
  if (!ids.length) return [];
  const { data: rows } = await supabase.from('students')
    .select('id, student_name, phone, list_id, enrolled_by_user_id, status, is_active, created_at')
    .in('id', ids).is('phone', null).is('list_id', null).eq('status', 'active').eq('is_active', true);
  const out = [];
  const mintIso = new Date(mintedAt || 0).toISOString();
  for (const row of rows || []) {
    if (!row.created_at || String(row.created_at) >= mintIso) continue;
    const c = canonOf(row.student_name);
    const twin = c && !dupes.has(c) ? byCanon.get(c) : null;
    if (!twin || String(twin.id) === String(row.id)) continue;
    if (!row.enrolled_by_user_id || !twin.enrolled_by_user_id || row.enrolled_by_user_id !== twin.enrolled_by_user_id) continue;
    if (await hasOpenRow(row.id)) continue;
    out.push({ from: row.id, to: twin.id });
  }
  return out;
}

/** The SQL function moves every FK and writes the move log; → true when it merged. */
async function mergeNow(from, to) {
  const { data, error } = await supabase.rpc('web_quiz_merge_student', { p_from: from, p_to: to, p_actor: ACTOR });
  if (error) { logToFile('⚠️ handset link: merge refused', { from, to, error: error.message }); return false; }
  if (!data || data.refused) { logToFile('⚠️ handset link: merge refused', { from, to, refused: data && data.refused }); return false; }
  logEvent('web_quiz.handset_merged', { from, to, moved: data.moved || null });
  return true;
}

/**
 * Redeem a handset link on this device. → { kids, one, device_ref }. Throws (status + body) for the
 * route to answer; the page then takes today's path (the name step).
 */
async function bind(body = {}, WqError = null) {
  ErrorClass = typeof WqError === 'function' ? WqError : HandsetError;
  const f = await flags();
  if (!f.link) fail(503, 'web_quiz_off');
  const tok = T.verify(body.x, 'x');
  if (!tok || !tok.n) { logEvent('web_quiz.handset_refused', { why: 'bad_token' }); fail(401, 'bad_token'); }
  const sc = await rootCode(body.code);
  if (tok.sc && tok.sc !== sc.id && tok.sc !== sc.own) { logEvent('web_quiz.handset_refused', { why: 'wrong_code', shareCodeId: sc.id }); fail(401, 'wrong_code'); }
  const redis = redisStore();
  if (!redis) { logEvent('web_quiz.handset_refused', { why: 'no_store', shareCodeId: sc.id }); fail(503, 'no_store'); }
  // A browser that never played has no device yet: it is minted here, as the session start would.
  const deviceRef = T.cleanDeviceRef(body.device_ref) || T.newDeviceRef();
  const ttl = Math.max(60, tok.exp - Math.floor(Date.now() / 1000));
  // Single use: the first device to claim the nonce keeps it; the same device may retry (a dropped answer).
  let holder = null;
  try {
    await redis.setNX(claimKey(tok.n), deviceRef, ttl);
    holder = await redis.get(claimKey(tok.n));   // read back: setNX answers "claimed" when Redis errors
  } catch (_) { holder = null; }
  if (holder !== deviceRef) {
    logEvent('web_quiz.handset_refused', { why: holder ? 'used' : 'no_store', shareCodeId: sc.id });
    fail(holder ? 409 : 503, holder ? 'used' : 'no_store');
  }
  const entry = await redis.get(entryKey(tok.n));
  if (!entry || !Array.isArray(entry.ids) || !entry.ids.length) { logEvent('web_quiz.handset_refused', { why: 'gone', shareCodeId: sc.id }); fail(410, 'gone'); }
  const kids = await kidsOf(entry.ids.map(String).slice(0, IDS_MAX));
  if (kids.length && !(await HubDevice.rememberKids(kids.map((k) => k.id), deviceRef))) {
    logEvent('web_quiz.handset_refused', { why: 'no_store', shareCodeId: sc.id });
    fail(503, 'no_store');   // never a card that cannot start
  }
  let candidates = [];
  try {
    candidates = kids.length ? await mergeCandidates(deviceRef, kids, entry.at) : [];
  } catch (err) {
    logToFile('⚠️ handset link: merge candidates not read', { error: err.message });
  }
  let merged = 0;
  for (const c of candidates) {
    logEvent('web_quiz.handset_would_merge', { from: c.from, to: c.to, shareCodeId: sc.id });
    if (f.merge && await mergeNow(c.from, c.to)) merged += 1;
  }
  const lang = String(sc.language || 'en').toLowerCase() === 'ur' ? 'ur' : 'en';
  const nameOf = (r) => firstName(lang === 'ur' && r.student_name_urdu && String(r.student_name_urdu).trim() ? r.student_name_urdu : r.student_name);
  const out = {
    kids: kids.map((k) => ({ chip: T.chipId(sc.id, k.id), first: nameOf(k), animal: T.animalFor(k.id) })),
    one: kids.length === 1 ? T.chipId(sc.id, kids[0].id) : null,
    device_ref: deviceRef,
  };
  logEvent('web_quiz.handset_bound', { shareCodeId: sc.id, kids: kids.length, would_merge: candidates.length, merged });
  return out;
}

module.exports = { flags, on, withLink, bind, mergeCandidates, HandsetError, LINK_KEY, MERGE_KEY, ACTOR, _resetCache: () => { cache = null; } };
