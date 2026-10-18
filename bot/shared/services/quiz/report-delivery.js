'use strict';
/**
 * A teacher's report WhatsApp accepted and then could not deliver (app_settings `quiz_report_send_checked`, the
 * class report's send check; off by default, only JSON `true` is on).
 *
 * Keep the id (remember): with the switch on, every teacher report send keeps its WhatsApp message id in Redis
 * `report_msg:<id>` → { kind, share_code_id | quiz_id, at } for 48 h. kind 'quiz' / 'story' is the class report
 * (video-quiz-report buildAndSend, keyed by the share code), 'chat_quiz' the chat quiz's report (quiz-job-handler,
 * keyed by the quiz). Both ask the switch's 30 s cached reading after an accepted send (remember with ask: true;
 * the class report's fold read carries it where the report makes one; off: at most one settings read per 30 s, no
 * write).
 *
 * Act on `failed` (onFailedStatus, from the WhatsApp status webhook, failed statuses only): with the switch on (its
 * own 30 s cached reading, asked only for a failed status), one Redis GET of `report_msg:<id>`. Not a report: nothing
 * else. A report: the record is dropped (handled once), the report un-stamped (the share code's report_sent_at back to
 * null while it is still that report's stamp; the chat quiz's `quiz_report_sent:<quiz id>` deleted while it is '1',
 * never a 'gave_up'), the failure counted toward the same three tries as a refused send (the class report's
 * quizzes.meta.report_send_failures, the chat quiz's quiz_report_send_tries) and logged as
 * `<kind>_report_delivery_failed` { code, code_h | quiz_h, tk, tries } (no phone, no message id). Then by code: 131047 (outside the 24 h window) and 131026
 * (undeliverable) are not tried again: `report_needs_template:<share code id | quiz id>` (Redis, 7 days) waits for
 * the teacher's next /quiz; any other code is queued again in 15 min, as a refusal is, until the third try.
 */
const supabase = require('../../config/supabase');
const RedisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const SendCheck = require('./report-send-check');

const PREFIX = 'report_msg:';
const RECORD_TTL_S = 48 * 60 * 60;
const NEEDS_TEMPLATE_PREFIX = 'report_needs_template:';
const NEEDS_TEMPLATE_TTL_S = 7 * 24 * 60 * 60;
/** Codes a retry inside the window cannot fix: the teacher's next /quiz (or a template) is the way back. */
const NO_RETRY_CODES = new Set([131047, 131026]);
const RETRY_DELAY_S = 15 * 60;
/** The class report's job (video-quiz-report JOB_TYPE) and the chat quiz's. */
const CLASS_JOB = 'quiz_video_report';
const CHAT_JOB = 'quiz_report';

/**
 * Keep the accepted report sends' ids. `record` = { kind, share_code_id } or { kind: 'chat_quiz', quiz_id }.
 * Writes only when the switch is on. By default the reading this process already holds decides (no read: the class
 * report's own settings reads carry the switch). `{ ask: true }` (the chat quiz, which has no settings read to ride)
 * asks the switch's 30 s cached reading instead, and only once a send was accepted (an id to keep). Never throws.
 */
async function remember(ids, record, { ask = false } = {}) {
  try {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id);
    if (!list.length) return;
    if ((ask ? await SendCheck.on() : SendCheck.known()) !== true) return;
    const value = { ...record, at: new Date().toISOString() };
    for (const id of list) await RedisService.set(`${PREFIX}${id}`, value, RECORD_TTL_S);
  } catch (err) {
    logToFile('⚠️ report delivery: message id not kept', { kind: record && record.kind, error: err && err.message });
  }
}

function codeOf(status) {
  const c = status && Array.isArray(status.errors) && status.errors[0] ? status.errors[0].code : null;
  const n = Number(c);
  return Number.isFinite(n) && c !== null && c !== '' ? n : null;
}

async function queueAgain(kind, id, tries) {
  const job = kind === 'chat_quiz' ? CHAT_JOB : CLASS_JOB;
  const payload = kind === 'chat_quiz' ? {} : { shareCodeId: id };
  try {
    const SQSQueueService = require('../queue');
    await SQSQueueService.queueJob(id, job, payload, {
      delaySeconds: RETRY_DELAY_S,
      deduplicationId: `${id}-${job}-retry-${tries}`,
    });
  } catch (err) {
    logToFile('❌ report delivery: failed report not queued again', { kind, error: err.message }, 'error');
  }
}

/** Un-stamp a class report; → the share code row the failure is counted on, or null. */
async function unstampClass(rec) {
  const { data: sc, error } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, teacher_user_id').eq('id', rec.share_code_id).maybeSingle();
  if (error || !sc) return null;
  // only while the stamp is this report's (a later report stamped after the record was written stays)
  let q = supabase.from('quiz_share_codes').update({ report_sent_at: null }).eq('id', sc.id);
  if (rec.at) q = q.lte('report_sent_at', rec.at);
  const { error: upErr } = await q;
  if (upErr) logToFile('❌ report delivery: report not un-stamped', { error: upErr.message }, 'error');
  return sc;
}

/** The chat quiz's fired flag value for a report given up on (workers/quiz-job-handler GAVE_UP). */
const CHAT_GAVE_UP = 'gave_up';
/** The chat quiz's refusal count (workers/quiz-job-handler chatReportRefused) and its TTL. */
const CHAT_TRIES_TTL_S = 86400;

/** Un-stamp a chat quiz report: its fired flag goes only while it is '1' (a 'gave_up' stays); → the quiz, or null. */
async function unstampChat(rec) {
  const { data: quiz, error } = await supabase.from('quizzes').select('id, teacher_id').eq('id', rec.quiz_id).maybeSingle();
  if (error || !quiz) return null;
  const flagKey = `quiz_report_sent:${quiz.id}`;
  const flag = await RedisService.get(flagKey);
  if (flag !== null && flag !== undefined && String(flag) === '1') await RedisService.delete(flagKey);
  return { id: quiz.id, code: null, quiz_id: quiz.id, teacher_user_id: quiz.teacher_id };
}

/**
 * A chat quiz's failed report counted with its refusals: the same Redis count (`quiz_report_send_tries:<quiz id>`, 24 h)
 * and the same give-up (the third try records 'gave_up' in the fired flag, so no later cascade message tries again).
 * Logged as chat_quiz_report_delivery_failed { code, quiz_h, tk, tries }.
 */
async function recordChatFailure(row, code) {
  const fields = { quiz_h: SendCheck.quizH(row.id), tk: SendCheck.tkOf(row.teacher_user_id) };
  let tries = null;
  try {
    const n = await RedisService.incr(`quiz_report_send_tries:${row.id}`);
    if (Number.isFinite(n) && n > 0) {
      tries = n;
      await RedisService.expire(`quiz_report_send_tries:${row.id}`, CHAT_TRIES_TTL_S);
    }
  } catch (err) {
    logToFile('❌ report delivery: failed chat quiz report not counted — no retry', { ...fields, error: err.message }, 'error');
  }
  logEvent('chat_quiz_report_delivery_failed', { code, ...fields, tries });
  const gaveUp = tries !== null && tries >= SendCheck.MAX_TRIES;
  if (gaveUp) {
    if (tries === SendCheck.MAX_TRIES) logEvent('report_gave_up', { ...fields, path: 'chat', tries });
    await RedisService.set(`quiz_report_sent:${row.id}`, CHAT_GAVE_UP, CHAT_TRIES_TTL_S);
  }
  return { tries, gaveUp };
}

/**
 * The status webhook's failed branch. Off: no Redis call (the switch's cached reading only). Never throws.
 * @returns {Promise<boolean>} true when the status was a report's and was handled
 */
async function onFailedStatus(status) {
  try {
    if (!status || status.status !== 'failed' || !status.id) return false;
    if (!(await SendCheck.on())) return false;
    const key = `${PREFIX}${status.id}`;
    const rec = await RedisService.get(key);
    if (!rec || typeof rec !== 'object' || !rec.kind) return false;
    await RedisService.delete(key);   // handled once: a repeated webhook finds nothing
    const kind = rec.kind;
    const row = kind === 'chat_quiz' ? await unstampChat(rec) : await unstampClass(rec);
    if (!row) return false;
    const code = codeOf(status);
    const r = kind === 'chat_quiz'
      ? await recordChatFailure(row, code)
      : await SendCheck.recordFailure({ path: kind, sc: row, what: 'delivery', extra: { code } });
    if (NO_RETRY_CODES.has(code)) {
      await RedisService.set(`${NEEDS_TEMPLATE_PREFIX}${row.id}`, { code, kind, at: new Date().toISOString() }, NEEDS_TEMPLATE_TTL_S);
    } else if (r.tries !== null && !r.gaveUp) {
      await queueAgain(kind, row.id, r.tries);
    }
    return true;
  } catch (err) {
    logToFile('❌ report delivery: failed status not handled', { error: err && err.message }, 'error');
    return false;
  }
}

module.exports = {
  remember, onFailedStatus, PREFIX, RECORD_TTL_S, NEEDS_TEMPLATE_PREFIX, NEEDS_TEMPLATE_TTL_S, NO_RETRY_CODES, RETRY_DELAY_S,
};
