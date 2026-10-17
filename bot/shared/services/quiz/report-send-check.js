'use strict';
/**
 * The class report's send check: app_settings `quiz_report_send_checked`. On, a teacher's class report (the quiz
 * report and the storybook report, video-quiz-report.buildAndSend) is stamped "sent" (report_sent_at, report_sent)
 * only when WhatsApp accepted it: send() answered a real `true`. A refusal or a throw is counted on the quiz row
 * (`quizzes.meta.report_send_failures[<share code id>]`, the same per-code map as `meta.report_followups`), logged as
 * `story_report_send_failed` / `quiz_report_send_failed`, and the report is tried again; the third refusal logs
 * `report_gave_up` and nothing tries again (the teacher's web report stays where it is).
 * Only JSON `true` is on; an absent row, `false`, any other value (the string "true", {enabled: true}, 1, "on") and a
 * failed read are all OFF, and OFF is today's send, stamp and order exactly. 30 s cache.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const KEY = 'quiz_report_send_checked';
const TTL_MS = 30 * 1000;
/** Tries per share code, the first send included. */
const MAX_TRIES = 3;
let cache = null; // { at, on }

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && isTrue(data.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ class report: send-check setting unreadable — reports are stamped as before', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

/** Did WhatsApp accept it? Only a real `true` from send(); false, anything else or a throw is no. Never throws. */
async function accepted(send) {
  try {
    return (await send()) === true;
  } catch (_) {
    return false;
  }
}

/**
 * A share code as the logs may hold it: web-quiz.service codeHash's rule (the first 12 hex of HMAC-SHA256 under the
 * web quiz token secret, over `wqcode|CODE`), so a line here joins the web quiz's own. Null without a secret.
 */
function codeH(code) {
  const key = require('./web-quiz-token').secret();
  if (!key || typeof code !== 'string' || !code) return null;
  return crypto.createHmac('sha256', key).update(`wqcode|${code.toUpperCase()}`).digest('hex').slice(0, 12);
}

/** The teacher's keyed id (web-quiz-kid tk), never the phone or the raw id. Null without a key. */
function tkOf(teacherUserId) {
  try { return require('./web-quiz-kid').tk(teacherUserId); } catch (_) { return null; }
}

async function readMeta(quizId) {
  const { data, error } = await supabase.from('quizzes').select('meta').eq('id', quizId).maybeSingle();
  if (error) throw new Error(error.message || 'quizzes read failed');
  return data ? (data.meta || {}) : null;
}

/** This share code's refused sends so far (0 when unread). */
async function triesOf(sc) {
  try {
    const meta = await readMeta(sc.quiz_id);
    return Number(((meta && meta.report_send_failures) || {})[sc.id]) || 0;
  } catch (err) {
    logToFile('⚠️ class report: refused-send count unreadable — trying', { code_h: codeH(sc.code), error: err.message });
    return 0;
  }
}

/** Has this share code's report been given up on (three refused sends)? */
async function gaveUp(sc) {
  return (await triesOf(sc)) >= MAX_TRIES;
}

/**
 * One refused send, counted and logged. `path` is 'story' or 'quiz'. `tries` is null when the count could not be
 * kept: then nothing is retried (a retry with no durable count could go on for ever).
 * @returns {Promise<{tries: number|null, gaveUp: boolean}>}
 */
async function recordFailure({ path, sc }) {
  const fields = { code_h: codeH(sc.code), tk: tkOf(sc.teacher_user_id) };
  let tries = null;
  try {
    const meta = await readMeta(sc.quiz_id);
    if (!meta) throw new Error('quiz row not found');
    const failures = meta.report_send_failures || {};
    const next = (Number(failures[sc.id]) || 0) + 1;
    const { error } = await supabase.from('quizzes')
      .update({ meta: { ...meta, report_send_failures: { ...failures, [sc.id]: next } } })
      .eq('id', sc.quiz_id);
    if (error) throw new Error(error.message || 'quizzes update failed');
    tries = next;
  } catch (err) {
    logToFile('❌ class report: refused send not counted — no retry', { ...fields, error: err.message }, 'error');
  }
  logEvent(`${path}_report_send_failed`, { ...fields, tries });
  const done = tries !== null && tries >= MAX_TRIES;
  if (done) logEvent('report_gave_up', { ...fields, path, tries });
  return { tries, gaveUp: done };
}

module.exports = { on, reset, isTrue, accepted, codeH, triesOf, gaveUp, recordFailure, KEY, TTL_MS, MAX_TRIES };
