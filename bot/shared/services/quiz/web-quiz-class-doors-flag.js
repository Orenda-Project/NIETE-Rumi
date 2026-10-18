'use strict';
/**
 * The class table and the school league with the child home on (app_settings `web_quiz_class_doors`, default OFF).
 * With the home on (web_quiz_home_v3) the folded card and the home had no way to either; this switch brings them back:
 * finish's fold gets `class_doors: true` (the card's "See my class" + "School league", the results' "See my class"), and
 * the hub's home gets `class_doors: {class, schools}` (the quiz page's own /q/<code>/class and /q/<code>/schools views).
 *
 *   on()                       30 s cache, JSON `true` only, fails closed (a read error is off)
 *   root()                     the watch root's id (watch-root.js, cached there), or null; never throws
 *   linksOf(history, kidId, root, lang) (pure) the child's newest class quiz (teacher-sent: never a friend's challenge code, a
 *                              library lesson code or the watch root itself) as {class, schools} hrefs with its hub key, or null
 *   ownClass(history, codeId, root) (pure) the run's code is one of the child's class quizzes (as linksOf's rule)
 * Read on its own, beside the home's switches, so the home's read stays as it is. No new table, no new query: the
 * class and league are the existing /api/wq/board/:code and /api/wq/schools/:code.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const WatchRoot = require('./watch-root');

const KEY = 'web_quiz_class_doors';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz class doors: settings lookup failed — off', { error: err.message });
    return false;
  }
}

function root() {
  return WatchRoot.watchRootId().catch(() => null);
}

// The watch root has no parent, so the hub calls it teacher-sent; its table is every school's strangers, never a class.
const classQuiz = (x, rootId) => Boolean(x && x.teacherSent && x.code && /^[A-Za-z0-9]{4,16}$/.test(x.code) && x.shareCodeId && x.shareCodeId !== rootId);

// history: student-quiz.service quizzesForStudents (newest first)
function linksOf(history, kidId, rootId = null, lang = null) {
  const e = (history || []).find((x) => classQuiz(x, rootId));
  if (!e || !kidId) return null;
  const k = T.chipId(e.shareCodeId, kidId);
  // lang (en|ur): the hub's own language, so the table and the league open in it (the edge's ui_lang)
  const q = [k ? `k=${encodeURIComponent(k)}` : '', lang === 'en' || lang === 'ur' ? `lang=${lang}` : ''].filter(Boolean).join('&');
  const qs = q ? `?${q}` : '';
  return { class: `/q/${e.code}/class${qs}`, schools: `/q/${e.code}/schools${qs}` };
}

function ownClass(history, codeId, rootId = null) {
  return Boolean(codeId) && (history || []).some((x) => classQuiz(x, rootId) && x.shareCodeId === codeId);
}

module.exports = { on, root, linksOf, ownClass, KEY, _resetCache: () => { cache = null; } };
