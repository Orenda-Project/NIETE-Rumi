'use strict';
/**
 * Is the teacher web report on for this teacher, and what are its links?
 *
 * One reader for the switch every teacher-report surface obeys — the /quiz
 * home, the report link, the post-completion PDF's not-played section and its
 * links:
 *   app_settings `teacher_report_teachers` = "all" | [teacherId, …]
 * Same parse, 30 s cache and FAIL-CLOSED rule as web-quiz-link's
 * `web_quiz_teachers`: a missing row, a read error, a teacher not on the list,
 * or no base URL is today's behaviour exactly.
 *
 * The links point at the portal (`WEB_QUIZ_BASE_URL || PORTAL_URL`, the same
 * base the children's /q/<code> page uses): `/t/<token>` is the live report and
 * `/t/<token>/remind` the "Remind the class" share. The token is the report
 * token (kind `tr`, 30 days), signed for this teacher and this quiz.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { webBaseUrl } = require('./web-quiz-link');
const { signTeacherReport } = require('./teacher-report-token');

const KEY = 'teacher_report_teachers';
const TTL_MS = 30 * 1000;
let cache = null; // { at, teachers }

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

async function readTeachers(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.teachers;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const teachers = parse(((data || [])[0] || {}).value);
    cache = { at: now, teachers };
    return teachers;
  } catch (err) {
    logToFile('⚠️ teacher report: settings lookup failed — off for this call', { error: err.message });
    return null;
  }
}

function listed(teachers, teacherId) {
  if (typeof teachers === 'string') return teachers.trim().toLowerCase() === 'all';
  if (Array.isArray(teachers)) return Boolean(teacherId) && teachers.map(String).includes(String(teacherId));
  return false;
}

/** True when this teacher gets the web report. Never throws. */
async function teacherReportOn(teacherId) {
  if (!teacherId || !webBaseUrl()) return false;
  return listed(await readTeachers(), teacherId);
}

/**
 * The live report and its reminder for one quiz (or every class, quizId null).
 * Null when there is no base URL or no signing secret. Never throws.
 * @returns {{live: string, remind: string, token: string}|null}
 */
function reportUrls({ teacherId, quizId = null } = {}) {
  const base = webBaseUrl();
  if (!base || !teacherId) return null;
  try {
    const token = signTeacherReport({ teacherId, quizId });
    if (!token) return null;
    const live = `${base}/t/${encodeURIComponent(token)}`;
    return { live, remind: `${live}/remind`, token };
  } catch (err) {
    logToFile('⚠️ teacher report: could not sign a report link', { error: err.message });
    return null;
  }
}

module.exports = { teacherReportOn, reportUrls, KEY, _resetCache: () => { cache = null; } };
