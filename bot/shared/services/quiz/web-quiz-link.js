/**
 * The link a child taps to play a shared quiz — one helper for every place
 * that hands one out (the teacher's class message, the transcript quiz
 * hand-off, a child's invite to a friend).
 *
 * The web quiz page (`<base>/q/<code>`) is offered only when BOTH:
 *   - app_settings `web_quiz_enabled` is true, and
 *   - app_settings `web_quiz_teachers` is "all", or a list holding the
 *     teacher's user id (the pilot allow-list).
 * Everything else — the flag off, a missing row, a read error, a teacher not
 * on the list, no base URL — is today's wa.me link. FAIL CLOSED: the WhatsApp
 * quiz is the kill switch, and the code is the same in both channels, so a
 * child holding either link reaches the same quiz.
 *
 * Base URL: WEB_QUIZ_BASE_URL if set, else PORTAL_URL (the web page is served
 * by the portal).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const ENABLED_KEY = 'web_quiz_enabled';
const TEACHERS_KEY = 'web_quiz_teachers';
const TTL_MS = 30 * 1000;
let cache = null; // { at, enabled, teachers }

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function isTrue(value) {
  const v = parse(value);
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

async function readSettings(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key, value').in('key', [ENABLED_KEY, TEACHERS_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, enabled: isTrue(byKey[ENABLED_KEY]), teachers: parse(byKey[TEACHERS_KEY]) };
    return cache;
  } catch (err) {
    // Fail closed, and do not cache the failure.
    logToFile('⚠️ web quiz link: settings lookup failed — using the WhatsApp link', { error: err.message });
    return { enabled: false, teachers: null };
  }
}

function teacherAllowed(teachers, teacherUserId) {
  if (typeof teachers === 'string') return teachers.trim().toLowerCase() === 'all';
  if (Array.isArray(teachers)) return Boolean(teacherUserId) && teachers.map(String).includes(String(teacherUserId));
  return false;
}

function webBaseUrl() {
  const base = process.env.WEB_QUIZ_BASE_URL || process.env.PORTAL_URL || '';
  return base.trim().replace(/\/+$/, '');
}

/** True when this teacher's children should get the web page. Never throws. */
async function webQuizOn(teacherUserId) {
  const s = await readSettings();
  return s.enabled && teacherAllowed(s.teachers, teacherUserId) && Boolean(webBaseUrl());
}

/**
 * The teacher's own signed preview of the web page (`?p=<token>`), for the
 * teacher-only caption — never the forwarded text. Null when the web quiz is
 * off for this teacher, or the token module or its secret is missing.
 * Never throws.
 */
async function previewLink(code, { shareCodeId, teacherUserId } = {}) {
  if (!code || !shareCodeId || !(await webQuizOn(teacherUserId))) return null;
  try {
    const Token = require('./web-quiz-token');
    const token = Token.signPreview && Token.signPreview({ shareCodeId, teacherUserId });
    return token ? `${webBaseUrl()}/q/${code}?p=${encodeURIComponent(token)}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz link: no preview link', { error: err.message });
    return null;
  }
}

/**
 * The link for a share code: the web page, or `whatsapp` — today's wa.me link,
 * which the caller builds exactly as before (so this module needs nothing from
 * the share service). Never throws.
 */
async function quizLink(code, { teacherUserId, whatsapp } = {}) {
  if (await webQuizOn(teacherUserId)) return `${webBaseUrl()}/q/${code}`;
  return whatsapp;
}

module.exports = {
  quizLink, previewLink, webQuizOn, webBaseUrl, ENABLED_KEY, TEACHERS_KEY,
  _resetCache: () => { cache = null; },
};
