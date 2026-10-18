'use strict';
/**
 * A teacher's report WhatsApp accepted and then could not deliver (app_settings `quiz_report_send_checked`, the
 * class report's send check; off by default, only JSON `true` is on).
 *
 * Keep the id (remember): with the switch on, every teacher report send keeps its WhatsApp message id in Redis
 * `report_msg:<id>` → { kind, share_code_id | quiz_id, at } for 48 h. kind 'quiz' / 'story' is the class report
 * (video-quiz-report buildAndSend, keyed by the share code), 'chat_quiz' the chat quiz's report (quiz-job-handler,
 * keyed by the quiz). The switch is never read for this: the reading this process already holds (report-send-check
 * known(), the report's own settings reads carry it) decides, so off writes nothing and reads nothing.
 *
 * Act on `failed` (onFailedStatus, from the WhatsApp status webhook, failed statuses only): with the switch on (its
 * own 30 s cached reading, asked only for a failed status), one Redis GET of `report_msg:<id>`. Not a report: nothing
 * else. A report: the record is dropped (handled once), the report un-stamped (the share code's report_sent_at back to
 * null while it is still that report's stamp; the chat quiz's `quiz_report_sent:<quiz id>` deleted), the failure
 * counted toward the same three tries as a refused send and logged as `<kind>_report_delivery_failed`
 * { code, code_h, tk, tries } (no phone, no message id). Then by code: 131047 (outside the 24 h window) and 131026
 * (undeliverable) are not tried again: `report_needs_template:<share code id | quiz id>` (Redis, 7 days) waits for
 * the teacher's next /quiz; any other code is queued again in 15 min, as a refusal is, until the third try.
 */
const supabase = require('../../config/supabase');
const RedisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
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
 * Writes only when this process's reading of the switch is on; never reads it. Never throws.
 */
async function remember(ids, record) {
  try {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id);
    if (!list.length || SendCheck.known() !== true) return;
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

/** Un-stamp a chat quiz report; → the quiz as a counting row ({ id: quiz id }), or null. */
async function unstampChat(rec) {
  const { data: quiz, error } = await supabase.from('quizzes').select('id, teacher_id').eq('id', rec.quiz_id).maybeSingle();
  if (error || !quiz) return null;
  await RedisService.delete(`quiz_report_sent:${quiz.id}`);
  return { id: quiz.id, code: null, quiz_id: quiz.id, teacher_user_id: quiz.teacher_id };
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
    const r = await SendCheck.recordFailure({ path: kind, sc: row, what: 'delivery', extra: { code } });
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
