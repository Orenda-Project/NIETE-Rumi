'use strict';
/**
 * The web quiz's send ledger: every WhatsApp message the web quiz's flows send is counted on message_ledger
 * (migration web_quiz_message_ledger.sql), one row per Pakistan day × trigger × class × initiator × recipient,
 * and logged as web_quiz.msg_sent in the same call, so the ledger's count equals the msg_sent count per trigger
 * (any difference is a gap to look at). Each send is US$0.015 (a service reply in Pakistan; the free tier is gone
 * on day one).
 *
 * A bot-initiated send to a family is refused here (and by the table's CHECK): there are none.
 * The ledger is written whenever a sender calls record(): the sender's own switch decides whether it sends. Only
 * msg_sent's v2 envelope (ev_v, kid_v, kid) depends on app_settings `web_quiz_events_v2`.
 * This module never sends anything and never throws.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./web-quiz-hub-flags');
const K = require('./web-quiz-kid');

const TABLE = 'message_ledger';
const USD_PER_SEND = 0.015;
const TRIGGERS = new Set(['home_reply', 'bind_reply', 'guest_reply', 'class_link', 'class_round', 'teacher_queue', 'teacher_refusal']);
const INITIATED = new Set(['user', 'bot']);
const RECIPIENTS = new Set(['family', 'teacher']);
const REASON_RX = /^[a-z0-9_]{1,24}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIES = 4;

let missingLogged = false;

const to4dp = (x) => Math.round(x * 10000) / 10000;
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));

// The day's row for this key: read, then the new count written only if the count is still what was read (a
// concurrent send on another replica re-reads); a first send inserts, and a lost insert race (unique index) re-reads.
async function bump(key, count) {
  const usd = to4dp(USD_PER_SEND * count);
  for (let i = 0; i < TRIES; i += 1) {
    let q = supabase.from(TABLE).select('count, usd').eq('day', key.day).eq('trigger', key.trigger)
      .eq('initiated', key.initiated).eq('recipient', key.recipient);
    q = key.class_id ? q.eq('class_id', key.class_id) : q.is('class_id', null);
    const { data: cur, error } = await q.limit(1).maybeSingle();
    if (error) return { error };
    if (!cur) {
      const ins = await supabase.from(TABLE).insert({ ...key, count, usd, updated_at: new Date().toISOString() });
      if (!ins.error) return { ok: true };
      if (ins.error.code !== '23505') return { error: ins.error };
      continue;
    }
    let u = supabase.from(TABLE).update({ count: cur.count + count, usd: to4dp(Number(cur.usd || 0) + usd), updated_at: new Date().toISOString() })
      .eq('day', key.day).eq('trigger', key.trigger).eq('initiated', key.initiated).eq('recipient', key.recipient).eq('count', cur.count);
    u = key.class_id ? u.eq('class_id', key.class_id) : u.is('class_id', null);
    const { data: hit, error: upErr } = await u.select('count');
    if (upErr) return { error: upErr };
    if (hit && hit.length) return { ok: true };
  }
  return { error: { message: 'contended' } };
}

function storeFailed(trigger, error) {
  if (isMissingTable(error)) {
    if (missingLogged) return;
    missingLogged = true;
  }
  logToFile('⚠️ web quiz ledger: write failed', { trigger, missingTable: isMissingTable(error), error: String((error && error.message) || '').slice(0, 160) });
}

/**
 * Count `count` sends: {trigger, classId?, initiated: 'user'|'bot', recipient: 'family'|'teacher', count?, reason?}.
 * Writes the ledger row and logs web_quiz.msg_sent; true when the row was written, false otherwise (a refused or
 * malformed send logs nothing; a failed write still logs the send, so the gap shows).
 */
async function record({ trigger, classId = null, initiated = 'user', recipient = 'family', count = 1, reason = null } = {}, { now = Date.now() } = {}) {
  try {
    if (!TRIGGERS.has(trigger) || !INITIATED.has(initiated) || !RECIPIENTS.has(recipient) || !Number.isInteger(count) || count < 1) {
      logToFile('⚠️ web quiz ledger: a malformed send was not counted', { trigger: String(trigger).slice(0, 24) });
      return false;
    }
    if (initiated === 'bot' && recipient === 'family') {
      logToFile('⚠️ web quiz ledger: a bot-initiated send to a family was refused', { trigger });
      return false;
    }
    const classIdOk = typeof classId === 'string' && UUID_RX.test(classId) ? classId.toLowerCase() : null;
    const key = { day: K.pktDay(now), trigger, class_id: classIdOk, initiated, recipient };
    const res = await bump(key, count);
    const c = classIdOk ? K.cls(classIdOk, { now }) : null;
    const usd = to4dp(USD_PER_SEND * count);
    const base = { trigger, ...(c ? { cls: c } : {}), initiated, recipient, usd, ...(typeof reason === 'string' && REASON_RX.test(reason) ? { reason } : {}) };
    logEvent('web_quiz.msg_sent', (await Flags.eventsV2On()) ? K.envelope(base) : { ...base, w: 's' });
    if (res.error) {
      storeFailed(trigger, res.error);
      return false;
    }
    return true;
  } catch (e) {
    logToFile('⚠️ web quiz ledger: write failed', { error: String((e && e.message) || e).slice(0, 160) });
    return false;
  }
}

module.exports = { record, recordSend: record, TRIGGERS, USD_PER_SEND, _reset: () => { missingLogged = false; } };
