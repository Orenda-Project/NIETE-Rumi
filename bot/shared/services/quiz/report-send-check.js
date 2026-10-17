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
 * Off reads no more app_settings than before. The switch is asked only when WhatsApp did not take a report (`send`),
 * and it rides the report's own settings reads: the fold switch (report-fold-flag, every story report and every
 * report with a finisher) and the teacher home switch (the stamp's quiz row, primeAlong) read it in the same query.
 * A quiz that has given up is known from the quiz row the report already reads (`triesIn`).
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

/**
 * One app_settings read of `otherKey` together with this switch (`.in`), so a read the report makes anyway carries
 * the switch: this switch's cache is primed from it. → `{ found, value }` for `otherKey`, or null when the combined
 * read failed: the caller then reads its own key alone, as before (per-key fallback), and this switch stays unread,
 * so its own read decides (a failure there is OFF). Never throws.
 */
async function readAlong(otherKey, now = Date.now()) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [otherKey, KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const rows = Array.isArray(data) ? data : [];
    const mine = rows.find((r) => r && r.key === KEY);
    cache = { at: now, on: Boolean(mine) && isTrue(mine.value) };
    const other = rows.find((r) => r && r.key === otherKey);
    return other ? { found: true, value: other.value } : { found: false, value: undefined };
  } catch (err) {
    logToFile('⚠️ class report: combined settings read failed — each key read alone', { key: otherKey, error: err && err.message });
    return null;
  }
}

/**
 * A cached switch module (`{ KEY, fresh(), prime(row) }`, e.g. first-touch/teacher-home.flags) about to read its key:
 * read it together with this switch instead. A fresh module, or one without fresh/prime, is left alone (no read is
 * added); a failed combined read leaves the module to read its key itself. Never throws.
 */
async function primeAlong(flag, now = Date.now()) {
  try {
    if (!flag || typeof flag.fresh !== 'function' || typeof flag.prime !== 'function' || flag.fresh(now)) return;
    const row = await readAlong(flag.KEY, now);
    if (row) flag.prime(row, now);
  } catch (_) { /* the module reads its own key */ }
}

/**
 * A report send. → false only when the switch is on and WhatsApp did not take it (false, anything but a real true, or
 * a throw); then nothing may be stamped. Otherwise true, and a throw still throws when the switch is off: today's
 * `await send()`. An accepted send never asks the switch, so off reads nothing new; a refused one asks it after
 * `before()` (the path's own settings read, which carries the switch, run early).
 */
async function send(fn, { before = null } = {}) {
  const onNow = async () => {
    if (before) await before();
    return on();
  };
  let answer;
  try {
    answer = await fn();
  } catch (err) {
    if (await onNow()) return false;
    throw err;
  }
  if (answer === true) return true;
  return !(await onNow());
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

/** This share code's refused sends so far, from the quiz row's meta the report already read (0 when absent). */
function triesIn(meta, shareCodeId) {
  return Number(((meta && meta.report_send_failures) || {})[shareCodeId]) || 0;
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

module.exports = { on, reset, isTrue, readAlong, primeAlong, send, codeH, triesIn, recordFailure, KEY, TTL_MS, MAX_TRIES };
