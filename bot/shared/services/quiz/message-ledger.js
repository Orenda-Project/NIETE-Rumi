'use strict';
/**
 * The send ledger (table message_ledger): one row per (PKT day, trigger, class_id, initiated, recipient),
 * `count` sends and `usd` = 0.015 × count. Every counted send writes its row AND the `web_quiz.msg_sent`
 * event in the same call, so the table's count equals the event count per trigger per PKT day.
 *
 * The write is ONE call to the database function message_ledger_add (INSERT … ON CONFLICT DO UPDATE
 * count = count + n). Only when that function is missing (42883) or the client has no rpc does it fall back to
 * select-then-write. A bot-initiated send to a family is never recorded (it must not exist), with ONE exception: the
 * direct ping (trigger 'sample_ping') is accepted ONLY as initiated 'bot' → recipient 'family' and ONLY without
 * `phone`, so its return value is the write result (false → the caller sends nothing; while the table's CHECKs still
 * refuse the row, every ping is refused here). A missing table (42P01) is logged once and the call returns false.
 * Never throws.
 *
 * A counted reply is one the bot DECIDED to send (an attempt), not a delivery: callers record first and send
 * only when record() returned true, so a send that fails afterwards is still counted.
 *
 * SCOPE: the ledger counts the switched replies only (the family phone binding's four, the guest door's, and the
 * known child's Home reply while web_quiz_phone_bind is on). The pre-existing /quiz replies (the child menu, the
 * teacher menu, an unknown phone's menu) are NOT recorded while their path is untouched by any switch, so this table is
 * NOT the bill: Meta's billable count is the cost total; the ledger is the per-trigger view of the new replies.
 *
 * The per-phone daily reply cap (app_settings web_quiz_reply_cap_per_phone, default 8, never below 1): when the
 * caller passes `phone`, the cap runs before anything else. The count lives in Redis under
 * wq:reply_cap:<PKT day>:<keyed hash of the phone> (48-hour TTL so the strip's daily snapshot always sees it; the key never holds the phone). Over the cap →
 * web_quiz.reply_capped{trigger} and false, with no ledger row and no msg_sent. With a phone, the return value is
 * the send decision: false ONLY when capped (a ledger write that fails is logged, web_quiz.ledger_write_failed{trigger}
 * once per process, and the reply still goes out). `reason` (bind, renew, stop, stop_nothing, max_kids, teacher_phone,
 * guest, home) rides on msg_sent; the ledger row stays keyed by trigger.
 * capAllows(phone, trigger, now) is that cap on its own (the direct ping runs it before it reserves, then records
 * without a phone).
 * The cap never fails open: with neither secret set the counter is keyed on a per-boot salt (per process), and with
 * Redis down a process-local counter takes over; both are logged once and visible as
 * web_quiz.reply_cap_unavailable{why: 'boot_salt'|'redis_local'} so a go package can see the cap ran degraded.
 *
 * Teacher minutes (column `minutes`): a send that costs the teacher's time passes `minutesEach` (the class round:
 * MINUTES_PER_ROUND_CHILD per child asked); the row gains round(minutesEach × count, 2) minutes and msg_sent gains
 * `min`. Without minutes (every other caller) the rpc arguments, the table writes and the event are exactly as before.
 * A database whose message_ledger_add predates the minutes (PGRST202 on the eighth argument) still counts the send,
 * without its minutes, logged once.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const TABLE = 'message_ledger';
const USD_PER_SEND = 0.015;
const MINUTES_PER_ROUND_CHILD = 1;   // a class round: about a minute of the teacher's time per child asked, one at a time
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const TRIGGERS = Object.freeze(['home_reply', 'bind_reply', 'guest_reply', 'teacher_refusal', 'class_link', 'class_round', 'teacher_queue']);
// The direct ping: bot → family only, never with a phone (the strict path). Kept beside TRIGGERS, not in it, so every
// caller of TRIGGERS (the counted replies) is unchanged.
const SAMPLE_PING = 'sample_ping';
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
let oldFunctionLogged = false;

/** The PKT calendar day of `now` as 'YYYY-MM-DD'. */
const pktDay = (now = new Date()) => new Date(new Date(now).getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
const usdOf = (count, each = USD_PER_SEND) => Math.round(each * count * 1e6) / 1e6;
const minutesOf = (count, each) => Math.round(each * count * 100) / 100;   // numeric(10,2), as the function rounds

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
// A salt made at boot, never logged or persisted: when neither secret is set the counter is keyed on it, so a loop is
// still capped per process (the counter dies with the process; that is the price of a misconfigured deploy, not a bill).
const BOOT_SALT = require('crypto').randomBytes(32);
function phoneHash(phone) {
  try {
    const Repo = require('./child-phone-bindings.repo');   // never the binder: the binder requires this ledger
    const keyed = Repo.ukeyOf(phone) || Repo.tombOf(phone);
    if (keyed) return { hash: keyed, boot: false };
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    return { hash: require('crypto').createHmac('sha256', BOOT_SALT).update(`cap|${digits}`).digest('hex').slice(0, 16), boot: true };
  } catch (_) {
    return null;
  }
}

// When Redis cannot count, a process-local counter does (same key, same 48-hour window), so the cap never fails open.
const localCounts = new Map();
function localIncr(key, now = Date.now()) {
  if (localCounts.size > 5000) for (const [k, v] of localCounts) if (v.exp <= now) localCounts.delete(k);
  const cur = localCounts.get(key);
  const next = cur && cur.exp > now ? { n: cur.n + 1, exp: cur.exp } : { n: 1, exp: now + CAP_WINDOW_SECS * 1000 };
  localCounts.set(key, next);
  return next.n;
}

/** → true when this reply may go out (counted under the cap, or no cap could run); false when over the cap. */
async function underCap(phone, trigger, now) {
  const h = phoneHash(phone);
  if (!h) return true;                                   // no phone at all: nothing to key on (callers always pass one)
  if (h.boot && !unkeyedLogged) {
    unkeyedLogged = true;
    logToFile('⚠️ message ledger: reply cap unkeyed — no phone hash secret; counting on a per-boot salt');
    logEvent('web_quiz.reply_cap_unavailable', { why: 'boot_salt', w: 's' });
  }
  const redisService = require('../cache/railway-redis.service');
  const key = `wq:reply_cap:${pktDay(now)}:${h.hash}`;
  let count = null;
  try { count = await redisService.incr(key); } catch (_) { count = null; }
  if (count === null || count === undefined || !Number.isFinite(Number(count))) {
    if (!redisFailLogged) {
      redisFailLogged = true;
      logToFile('⚠️ message ledger: reply cap: redis unavailable — counting in this process');
      logEvent('web_quiz.reply_cap_unavailable', { why: 'redis_local', w: 's' });
    }
    count = localIncr(key);
  } else if (Number(count) === 1) {
    try { await redisService.expire(key, CAP_WINDOW_SECS); } catch (_) { /* the count still holds */ }
  }
  if (Number(count) > await capPerPhone()) {
    logEvent('web_quiz.reply_capped', { trigger, w: 's' });
    return false;
  }
  return true;
}

/** ONE atomic add through message_ledger_add → true (written) | false (failed) | null (no function: fall back). */
async function addByRpc({ day, trigger, classId, initiated, recipient, n, usdEach, minutesEach = 0 }) {
  if (typeof supabase.rpc !== 'function') return null;
  const args = {
    p_day: day, p_trigger: trigger, p_class_id: classId ? String(classId) : null, p_initiated: initiated, p_recipient: recipient, p_n: n, p_usd_each: usdEach,
  };
  // p_minutes_each only when there are minutes: a send without them calls the function exactly as before
  let { error } = await supabase.rpc('message_ledger_add', minutesEach > 0 ? { ...args, p_minutes_each: minutesEach } : args);
  if (error && error.code === 'PGRST202' && minutesEach > 0) {
    // the database's function predates the minutes: count the send without them
    if (!oldFunctionLogged) { oldFunctionLogged = true; logToFile('⚠️ message ledger: message_ledger_add has no minutes argument — teacher minutes not counted'); }
    ({ error } = await supabase.rpc('message_ledger_add', args));
    if (!error) return 'no_minutes';
  }
  if (!error) return true;
  if (error.code === '42883') return null;
  if (missingTable(error)) return false;
  throw new Error(error.message || 'rpc failed');
}

/**
 * Count `count` sends of `trigger` today (PKT). Without `phone` → true when the row was written. With `phone`
 * (raw or normalised) → the send decision: false only when the phone is over today's reply cap.
 * @param {{trigger:string, phone?:string, classId?:string|null, initiated?:'user'|'bot', recipient?:'family'|'teacher', count?:number, usdEach?:number, minutesEach?:number, now?:Date}} p
 */
/**
 * A reply the cap refused is counted on the day's row as `capped` (never on count/usd, never through
 * message_ledger_add): one read of the ledger then says "sent / capped" for the day. Never throws; a failed write is
 * logged once per process and the refusal stands.
 */
let cappedWriteLogged = false;
async function countCapped({ trigger, classId, initiated, recipient, now }) {
  const day = pktDay(now);
  try {
    let q = supabase.from(TABLE).select('capped').eq('day', day).eq('trigger', trigger).eq('initiated', initiated).eq('recipient', recipient);
    q = classId ? q.eq('class_id', String(classId)) : q.is('class_id', null);
    const { data, error } = await q.limit(1);
    if (missingTable(error)) return;
    if (error) throw new Error(error.message || 'read failed');
    const row = (data || [])[0];
    if (row) {
      let u = supabase.from(TABLE).update({ capped: (Number(row.capped) || 0) + 1 }).eq('day', day).eq('trigger', trigger).eq('initiated', initiated).eq('recipient', recipient);
      u = classId ? u.eq('class_id', String(classId)) : u.is('class_id', null);
      const res = await u;
      if (res.error) throw new Error(res.error.message || 'update failed');
      return;
    }
    const res = await supabase.from(TABLE).insert({ day, trigger, class_id: classId ? String(classId) : null, initiated, recipient, count: 0, usd: 0, capped: 1 });
    if (res.error && res.error.code !== '23505' && !missingTable(res.error)) throw new Error(res.error.message || 'insert failed');
  } catch (err) {
    if (!cappedWriteLogged) { cappedWriteLogged = true; logToFile('⚠️ message ledger: capped count not written', { error: err.message }); }
  }
}

/**
 * `uncapped: true` (the binder's STOP that erased a binding — a privacy action is never silent): the reply is counted
 * on the ledger as a send but neither checked against nor added to the phone's day counter, so a phone-day's bound is
 * the cap plus that one reply.
 */
async function record({ trigger, phone = null, reason = null, classId = null, initiated = 'user', recipient = 'family', count = 1, usdEach = USD_PER_SEND, minutesEach = 0, uncapped = false, now = new Date() } = {}) {
  if (!(TRIGGERS.includes(trigger) || trigger === SAMPLE_PING) || !INITIATED.includes(initiated) || !RECIPIENTS.includes(recipient)) return false;
  if (trigger === SAMPLE_PING) {
    if (initiated !== 'bot' || recipient !== 'family' || phone) return false;
    return write({ trigger, reason, classId, initiated, recipient, count, usdEach, minutesEach, now });
  }
  if (initiated === 'bot' && recipient === 'family') return false;
  if (phone) {
    if (!uncapped && !(await underCap(phone, trigger, now))) {
      await countCapped({ trigger, classId, initiated, recipient, now });
      return false;
    }
    if (!(await write({ trigger, reason, classId, initiated, recipient, count, usdEach, minutesEach, now })) && !writeFailLogged) {
      // the reply still goes out: the ledger is the accounting, the reply is the family's (logged once per process)
      writeFailLogged = true;
      logEvent('web_quiz.ledger_write_failed', { trigger, w: 's' });
    }
    return true;
  }
  return write({ trigger, reason, classId, initiated, recipient, count, usdEach, minutesEach, now });
}

async function write({ trigger, reason = null, classId, initiated, recipient, count, usdEach, minutesEach = 0, now }) {
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const day = pktDay(now);
  const each = Number.isFinite(usdEach) && usdEach >= 0 ? usdEach : USD_PER_SEND;
  const minEach = typeof minutesEach === 'number' && Number.isFinite(minutesEach) && minutesEach > 0 ? minutesEach : 0;   // anything else → no minutes
  try {
    const viaRpc = await addByRpc({ day, trigger, classId, initiated, recipient, n, usdEach: each, minutesEach: minEach });
    if (viaRpc === false) return false;
    const minutesWritten = viaRpc === 'no_minutes' ? 0 : minEach;
    let written = viaRpc === true || viaRpc === 'no_minutes';
    for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
      let q = supabase.from(TABLE).select(minEach > 0 ? 'count, minutes' : 'count').eq('day', day).eq('trigger', trigger)
        .eq('initiated', initiated).eq('recipient', recipient);
      q = classId ? q.eq('class_id', String(classId)) : q.is('class_id', null);
      const { data, error } = await q.limit(1);
      if (missingTable(error)) return false;
      if (error) throw new Error(error.message || 'read failed');
      const row = (data || [])[0];
      if (row) {
        const total = (Number(row.count) || 0) + n;
        const patch = { count: total, usd: usdOf(total, each) };
        if (minEach > 0) patch.minutes = Math.round(((Number(row.minutes) || 0) + minutesOf(n, minEach)) * 100) / 100;
        let u = supabase.from(TABLE).update(patch).eq('day', day).eq('trigger', trigger)
          .eq('initiated', initiated).eq('recipient', recipient);
        u = classId ? u.eq('class_id', String(classId)) : u.is('class_id', null);
        const res = await u;
        if (res.error) throw new Error(res.error.message || 'update failed');
        written = true;
      } else {
        const res = await supabase.from(TABLE).insert({
          day, trigger, class_id: classId ? String(classId) : null, initiated, recipient, count: n, usd: usdOf(n, each),
          ...(minEach > 0 ? { minutes: minutesOf(n, minEach) } : {}),
        });
        if (missingTable(res.error)) return false;
        if (res.error && res.error.code === '23505') continue;     // a concurrent first send: add to its row
        if (res.error) throw new Error(res.error.message || 'insert failed');
        written = true;
      }
    }
    if (!written) return false;
    const min = minutesWritten > 0 ? minutesOf(n, minutesWritten) : 0;
    logEvent('web_quiz.msg_sent', { trigger, initiated, recipient, usd: usdOf(n, each), ...(min > 0 ? { min } : {}), cls: clsFor(classId), ...(reason ? { reason } : {}), w: 's' });
    return true;
  } catch (err) {
    logToFile('⚠️ message ledger: record failed', { error: err.message });
    return false;
  }
}

module.exports = {
  countCapped,
  record, capAllows: underCap, pktDay, capPerPhone, TRIGGERS, SAMPLE_PING, USD_PER_SEND, MINUTES_PER_ROUND_CHILD, TABLE, CAP_KEY, CAP_DEFAULT,
  _resetMissing: () => { missingLogged = false; writeFailLogged = false; oldFunctionLogged = false; },
  _resetCap: () => { capCache = null; unkeyedLogged = false; redisFailLogged = false; localCounts.clear(); },
};
