'use strict';
/**
 * The web quiz's send ledger: every WhatsApp message the web quiz's flows send is counted on message_ledger
 * (migration web_quiz_message_ledger.sql), one row per Pakistan day × trigger × class × initiator × recipient,
 * and logged as web_quiz.msg_sent in the same call, so the ledger's count equals the msg_sent count per trigger
 * (any difference is a gap to look at). Each send is US$0.015 (a service reply in Pakistan; the free tier is gone
 * on day one).
 *
 * A bot-initiated send to a family is refused here (and by the table's CHECK): there are none.
 * Behind app_settings `web_quiz_events_v2` (parent `web_quiz_hub`); off ⇒ nothing written, nothing logged.
 * The senders call recordSend() after a send; this module never sends anything. Never throws.
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
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIES = 4;

const to4dp = (x) => Math.round(x * 10000) / 10000;

// The day's row for this key: read, then +1 written only if the count is still what was read (a concurrent send on
// another replica re-reads); a first send inserts, and a lost insert race (unique index) re-reads.
async function bump(key) {
  for (let i = 0; i < TRIES; i += 1) {
    let q = supabase.from(TABLE).select('count, usd').eq('day', key.day).eq('trigger', key.trigger)
      .eq('initiated', key.initiated).eq('recipient', key.recipient);
    q = key.class_id ? q.eq('class_id', key.class_id) : q.is('class_id', null);
    const { data: cur, error } = await q.limit(1).maybeSingle();
    if (error) return { error };
    if (!cur) {
      const ins = await supabase.from(TABLE).insert({ ...key, count: 1, usd: USD_PER_SEND, updated_at: new Date().toISOString() });
      if (!ins.error) return { ok: true };
      if (ins.error.code !== '23505') return { error: ins.error };
      continue;
    }
    let u = supabase.from(TABLE).update({ count: cur.count + 1, usd: to4dp(Number(cur.usd || 0) + USD_PER_SEND), updated_at: new Date().toISOString() })
      .eq('day', key.day).eq('trigger', key.trigger).eq('initiated', key.initiated).eq('recipient', key.recipient).eq('count', cur.count);
    u = key.class_id ? u.eq('class_id', key.class_id) : u.is('class_id', null);
    const { data: hit, error: upErr } = await u.select('count');
    if (upErr) return { error: upErr };
    if (hit && hit.length) return { ok: true };
  }
  return { error: { message: 'contended' } };
}

/**
 * Count one send: {trigger, classId?, initiated: 'user'|'bot', recipient: 'family'|'teacher'}.
 * Returns {recorded: true} or {recorded: false, reason: 'off'|'bad_send'|'bot_to_family'|'store_failed'}.
 */
async function recordSend({ trigger, classId = null, initiated, recipient } = {}, { now = Date.now() } = {}) {
  try {
    if (!(await Flags.eventsV2On())) return { recorded: false, reason: 'off' };
    if (!TRIGGERS.has(trigger) || !INITIATED.has(initiated) || !RECIPIENTS.has(recipient)) return { recorded: false, reason: 'bad_send' };
    if (initiated === 'bot' && recipient === 'family') {
      logToFile('⚠️ web quiz ledger: a bot-initiated send to a family was refused', { trigger });
      return { recorded: false, reason: 'bot_to_family' };
    }
    const classIdOk = typeof classId === 'string' && UUID_RX.test(classId) ? classId.toLowerCase() : null;
    const key = { day: K.pktDay(now), trigger, class_id: classIdOk, initiated, recipient };
    const res = await bump(key);
    const c = classIdOk ? K.cls(classIdOk, { now }) : null;
    logEvent('web_quiz.msg_sent', K.envelope({ trigger, ...(c ? { cls: c } : {}), initiated, recipient, usd: USD_PER_SEND }));
    if (res.error) {
      logToFile('⚠️ web quiz ledger: write failed', { trigger, error: String(res.error.message || '').slice(0, 160) });
      return { recorded: false, reason: 'store_failed' };
    }
    return { recorded: true };
  } catch (e) {
    logToFile('⚠️ web quiz ledger: write failed', { error: String((e && e.message) || e).slice(0, 160) });
    return { recorded: false, reason: 'store_failed' };
  }
}

module.exports = { recordSend, TRIGGERS, USD_PER_SEND };
