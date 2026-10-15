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

let missingLogged = false;

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
 * Count `count` sends of `trigger` today (PKT) → true when the row was written.
 * @param {{trigger:string, classId?:string|null, initiated?:'user'|'bot', recipient?:'family'|'teacher', count?:number, usdEach?:number, now?:Date}} p
 */
async function record({ trigger, classId = null, initiated = 'user', recipient = 'family', count = 1, usdEach = USD_PER_SEND, now = new Date() } = {}) {
  if (!TRIGGERS.includes(trigger) || !INITIATED.includes(initiated) || !RECIPIENTS.includes(recipient)) return false;
  if (initiated === 'bot' && recipient === 'family') return false;
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
    logEvent('web_quiz.msg_sent', { trigger, initiated, recipient, usd: usdOf(n, each), cls: clsFor(classId), w: 's' });
    return true;
  } catch (err) {
    logToFile('⚠️ message ledger: record failed', { error: err.message });
    return false;
  }
}

module.exports = { record, pktDay, TRIGGERS, USD_PER_SEND, TABLE, _resetMissing: () => { missingLogged = false; } };
