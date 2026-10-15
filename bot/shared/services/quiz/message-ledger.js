'use strict';
/**
 * The send ledger (table message_ledger): one row per (PKT day, trigger, class_id, initiated, recipient),
 * `count` sends and `usd` = 0.015 × count. Every counted send writes its row AND the `web_quiz.msg_sent`
 * event in the same call, so the table's count equals the event count per trigger per PKT day.
 *
 * The write is ONE call to the database function message_ledger_add (INSERT … ON CONFLICT DO UPDATE
 * count = count + n). Only when that function is missing (42883) or the client has no rpc does it fall back to
 * select-then-write. A bot-initiated send to a family is never recorded (it must not exist). A missing table
 * (42P01) is logged once and the call returns false. Never throws.
 *
 * A counted reply is one the bot DECIDED to send (an attempt), not a delivery: callers record first and send
 * only when record() returned true, so a send that fails afterwards is still counted.
 *
 * The per-phone daily reply cap (app_settings web_quiz_reply_cap_per_phone, default 8, never below 1): when the
 * caller passes `phone`, the cap runs before anything else. The count lives in Redis under
 * wq:reply_cap:<PKT day>:<keyed hash of the phone> (48-hour TTL so the strip's daily snapshot always sees it; the key never holds the phone). Over the cap →
 * web_quiz.reply_capped{trigger} and false, with no ledger row and no msg_sent. With a phone, the return value is
 * the send decision: false ONLY when capped (a ledger write that fails is logged, web_quiz.ledger_write_failed{trigger}
 * once per process, and the reply still goes out). `reason` (bind, renew, stop, stop_nothing, max_kids, teacher_phone,
 * guest, home) rides on msg_sent; the ledger row stays keyed by trigger.
 * No hash key (neither secret set) or a Redis failure → no cap (fail open), logged once.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const TABLE = 'message_ledger';
const USD_PER_SEND = 0.015;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const TRIGGERS = Object.freeze(['home_reply', 'bind_reply', 'guest_reply', 'teacher_refusal', 'class_link', 'class_round', 'teacher_queue']);
const INITIATED = Object.freeze(['user', 'bot']);
const RECIPIENTS = Object.freeze(['family', 'teacher']);
const CAP_KEY = 'web_quiz_reply_cap_per_phone';
const CAP_DEFAULT = 8;
const CAP_TTL_MS = 30 * 1000;
const CAP_WINDOW_SECS = 48 * 60 * 60;   // the counter outlives its PKT day so the daily strip snapshot never misses it

let missingLogged = false;
let capCache = null; // { at, cap }
let unkeyedLogged = false;
let redisFailLogged = false;
let writeFailLogged = false;

/** The PKT calendar day of `now` as 'YYYY-MM-DD'. */
const pktDay = (now = new Date()) => new Date(new Date(now).getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
const usdOf = (count, each = USD_PER_SEND) => Math.round(each * count * 1e6) / 1e6;

function missingTable(error) {
  if (!error || error.code !== '42P01') return false;
  if (!missingLogged) { missingLogged = true; logToFile('⚠️ message ledger: table missing — sends not counted'); }
  return true;
}

/** The keyed class (`cls`) when the kid-key module exists; else null. Never throws. */
function clsFor(classId) {
  if (!classId) return null;
  try {
    const Kid = require('./web-quiz-kid');
    return (Kid && typeof Kid.clsOf === 'function' && Kid.clsOf(classId)) || null;
  } catch (_) {
    return null;
  }
}

// ── the per-phone daily reply cap ──

/** An app_settings value → an integer cap ≥ 1; anything that is not an integer → the default. */
function capOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return CAP_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(1, n) : CAP_DEFAULT;
}

/** The cap, read like the identity switches (30 s cache); a failed read → the default. Never throws. */
async function capPerPhone(now = Date.now()) {
  if (capCache && now - capCache.at < CAP_TTL_MS) return capCache.cap;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [CAP_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === CAP_KEY);
    capCache = { at: now, cap: capOf(row ? row.value : null) };
    return capCache.cap;
  } catch (err) {
    logToFile('⚠️ message ledger: reply cap lookup failed — the default applies', { error: err.message });
    return CAP_DEFAULT;
  }
}

/** The phone's keyed hash: ukey (WEB_QUIZ_KID_KEY), else the tombstone HMAC (WQ_TOMB_SALT), else null. */
function phoneHash(phone) {
  try {
    const ukey = require('./web-quiz-bind.service').ukeyOf(phone);
    if (ukey) return ukey;
  } catch (_) { /* the tombstone */ }
  try {
    return require('./child-phone-bindings.repo').tombOf(phone) || null;
  } catch (_) {
    return null;
  }
}

/** → true when this reply may go out (counted under the cap, or no cap could run); false when over the cap. */
async function underCap(phone, trigger, now) {
  const hash = phoneHash(phone);
  if (!hash) {
    if (!unkeyedLogged) { unkeyedLogged = true; logToFile('⚠️ message ledger: reply cap unkeyed — no phone hash secret, replies not capped'); }
    return true;
  }
  const redisService = require('../cache/railway-redis.service');
  const key = `wq:reply_cap:${pktDay(now)}:${hash}`;
  let count = null;
  try { count = await redisService.incr(key); } catch (_) { count = null; }
  if (count === null || count === undefined || !Number.isFinite(Number(count))) {
    if (!redisFailLogged) { redisFailLogged = true; logToFile('⚠️ message ledger: reply cap: redis unavailable — reply sent uncapped'); }
    return true;
  }
  if (Number(count) === 1) {
    try { await redisService.expire(key, CAP_WINDOW_SECS); } catch (_) { /* the count still holds */ }
  }
  if (Number(count) > await capPerPhone()) {
    logEvent('web_quiz.reply_capped', { trigger, w: 's' });
    return false;
  }
  return true;
}

/** ONE atomic add through message_ledger_add → true (written) | false (failed) | null (no function: fall back). */
async function addByRpc({ day, trigger, classId, initiated, recipient, n, usdEach }) {
  if (typeof supabase.rpc !== 'function') return null;
  const { error } = await supabase.rpc('message_ledger_add', {
    p_day: day, p_trigger: trigger, p_class_id: classId ? String(classId) : null, p_initiated: initiated, p_recipient: recipient, p_n: n, p_usd_each: usdEach,
  });
  if (!error) return true;
  if (error.code === '42883') return null;
  if (missingTable(error)) return false;
  throw new Error(error.message || 'rpc failed');
}

/**
 * Count `count` sends of `trigger` today (PKT). Without `phone` → true when the row was written. With `phone`
 * (raw or normalised) → the send decision: false only when the phone is over today's reply cap.
 * @param {{trigger:string, phone?:string, classId?:string|null, initiated?:'user'|'bot', recipient?:'family'|'teacher', count?:number, usdEach?:number, now?:Date}} p
 */
async function record({ trigger, phone = null, reason = null, classId = null, initiated = 'user', recipient = 'family', count = 1, usdEach = USD_PER_SEND, now = new Date() } = {}) {
  if (!TRIGGERS.includes(trigger) || !INITIATED.includes(initiated) || !RECIPIENTS.includes(recipient)) return false;
  if (initiated === 'bot' && recipient === 'family') return false;
  if (phone) {
    if (!(await underCap(phone, trigger, now))) return false;
    if (!(await write({ trigger, reason, classId, initiated, recipient, count, usdEach, now })) && !writeFailLogged) {
      // the reply still goes out: the ledger is the accounting, the reply is the family's (logged once per process)
      writeFailLogged = true;
      logEvent('web_quiz.ledger_write_failed', { trigger, w: 's' });
    }
    return true;
  }
  return write({ trigger, reason, classId, initiated, recipient, count, usdEach, now });
}

async function write({ trigger, reason = null, classId, initiated, recipient, count, usdEach, now }) {
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const day = pktDay(now);
  const each = Number.isFinite(usdEach) && usdEach >= 0 ? usdEach : USD_PER_SEND;
  try {
    const viaRpc = await addByRpc({ day, trigger, classId, initiated, recipient, n, usdEach: each });
    if (viaRpc === false) return false;
    let written = viaRpc === true;
    for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
      let q = supabase.from(TABLE).select('count').eq('day', day).eq('trigger', trigger)
        .eq('initiated', initiated).eq('recipient', recipient);
      q = classId ? q.eq('class_id', String(classId)) : q.is('class_id', null);
      const { data, error } = await q.limit(1);
      if (missingTable(error)) return false;
      if (error) throw new Error(error.message || 'read failed');
      const row = (data || [])[0];
      if (row) {
        const total = (Number(row.count) || 0) + n;
        let u = supabase.from(TABLE).update({ count: total, usd: usdOf(total, each) }).eq('day', day).eq('trigger', trigger)
          .eq('initiated', initiated).eq('recipient', recipient);
        u = classId ? u.eq('class_id', String(classId)) : u.is('class_id', null);
        const res = await u;
        if (res.error) throw new Error(res.error.message || 'update failed');
        written = true;
      } else {
        const res = await supabase.from(TABLE).insert({
          day, trigger, class_id: classId ? String(classId) : null, initiated, recipient, count: n, usd: usdOf(n, each),
        });
        if (missingTable(res.error)) return false;
        if (res.error && res.error.code === '23505') continue;     // a concurrent first send: add to its row
        if (res.error) throw new Error(res.error.message || 'insert failed');
        written = true;
      }
    }
    if (!written) return false;
    logEvent('web_quiz.msg_sent', { trigger, initiated, recipient, usd: usdOf(n, each), cls: clsFor(classId), ...(reason ? { reason } : {}), w: 's' });
    return true;
  } catch (err) {
    logToFile('⚠️ message ledger: record failed', { error: err.message });
    return false;
  }
}

module.exports = {
  record, pktDay, capPerPhone, TRIGGERS, USD_PER_SEND, TABLE, CAP_KEY, CAP_DEFAULT,
  _resetMissing: () => { missingLogged = false; writeFailLogged = false; },
  _resetCap: () => { capCache = null; unkeyedLogged = false; redisFailLogged = false; },
};
