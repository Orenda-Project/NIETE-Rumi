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
 *
 * Its settings read: this key rides the fold switch's read (report-fold-flag, settings-group): every fold read in a
 * process that loaded this module (video-quiz-report does) fetches this key in the same query. The switch is asked
 * only when WhatsApp did not take a report (`send`), or when a share code already holds three refused sends
 * (`triesIn`, from the quiz row the report reads anyway), and on the story report and the report with finishers that
 * is after the report's own fold read: no read of its own. When the fold switch has not been read within 30 s (a
 * report nobody finished makes no fold read), the question costs ONE read of this key alone; it never answers from a
 * read older than 30 s. A failed shared read leaves this switch off for 30 s (the fold switch reads its own key); a
 * failed read of its own is off. It never rides the teacher home switch's read.
 *
 * The chat quiz's report (workers/quiz-job-handler, QuizReportService.generateReport) rides the same switch: its
 * "already fired" flag is set only when WhatsApp took the report; a refusal logs `quiz_report_send_failed` with
 * `quiz_h` (quizH), `tk` and `tries` and is queued again by the job's own re-queue, at most MAX_TRIES tries.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { settingsGroup } = require('../settings-group');
const FoldFlag = require('./report-fold-flag');

const KEY = 'quiz_report_send_checked';
const TTL_MS = 30 * 1000;
/** Tries per share code, the first send included. */
const MAX_TRIES = 3;
// rides the fold switch's read
const group = settingsGroup(FoldFlag.KEY, [KEY], TTL_MS);

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  try {
    const { data, error } = await group.rider(KEY, now);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return Boolean(data) && isTrue(data.value);
  } catch (err) {
    logToFile('⚠️ class report: send-check setting unreadable — reports are stamped as before', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { group.forget(KEY); }

/** How old a reading known() still answers from. */
const KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The switch as this process last read it, with NO read: true / false from a reading at most `maxAgeMs` old (its own
 * read, or the fold switch's read that carried it), null when there is none. For a decision that must cost nothing
 * when off (report-delivery remember).
 */
function known(now = Date.now(), maxAgeMs = KNOWN_MAX_AGE_MS) {
  const seen = group.seen(KEY);
  return seen && now - seen.at < maxAgeMs ? Boolean(seen.data) && isTrue(seen.data.value) : null;
}

/**
 * A report send. → false only when the switch is on and WhatsApp did not take it (false, anything but a real true, or
 * a throw); then nothing may be stamped. Otherwise true, and a throw still throws when the switch is off: today's
 * `await send()`. An accepted send never asks the switch, so it reads nothing new.
 */
async function send(fn) {
  let answer;
  try {
    answer = await fn();
  } catch (err) {
    if (await on()) return false;
    throw err;
  }
  if (answer === true) return true;
  return !(await on());
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

/**
 * A chat quiz's id as the logs may hold it (the chat quiz report, workers/quiz-job-handler): the first 12 hex of
 * HMAC-SHA256 under the same secret as codeH, over `quiz|<id>`. Null without a secret.
 */
function quizH(quizId) {
  const key = require('./web-quiz-token').secret();
  if (!key || typeof quizId !== 'string' || !quizId) return null;
  return crypto.createHmac('sha256', key).update(`quiz|${quizId}`).digest('hex').slice(0, 12);
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

/** This share code's refused sends so far, from the quiz row's meta the report already read (0 when absent). */
function triesIn(meta, shareCodeId) {
  return Number(((meta && meta.report_send_failures) || {})[shareCodeId]) || 0;
}

/**
 * One refused send, counted and logged. `path` is 'story' or 'quiz'. `tries` is null when the count could not be
 * kept: then nothing is retried (a retry with no durable count could go on for ever).
 * `what` names the event (`<path>_report_<what>_failed`): 'send' for a refusal, 'delivery' for a report WhatsApp took
 * and then could not deliver (report-delivery); `extra` rides on it (never a phone or a message id). Both count the
 * same tries.
 * @returns {Promise<{tries: number|null, gaveUp: boolean}>}
 */
async function recordFailure({ path, sc, what = 'send', extra = null }) {
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
  logEvent(`${path}_report_${what}_failed`, { ...(extra || {}), ...fields, tries });
  const done = tries !== null && tries >= MAX_TRIES;
  if (done) logEvent('report_gave_up', { ...fields, path, tries });
  return { tries, gaveUp: done };
}

module.exports = { on, reset, known, isTrue, send, codeH, quizH, tkOf, triesIn, recordFailure, KEY, TTL_MS, MAX_TRIES, KNOWN_MAX_AGE_MS };
