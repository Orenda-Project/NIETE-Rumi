'use strict';
/**
 * The quiz's twin in the other language, for the class table and the league (app_settings `web_quiz_class_doors`):
 * the same teacher's open code of the same lesson (web-quiz-hub's lessonRefs: the lesson plan or the coaching session)
 * in the other language. Play from a table shown in the child's language then opens the quiz in it too.
 *
 *   twinOf(ctx, studentId)   {code[, k]} or null; never throws. k: the twin's hub key for the child, when known.
 *   find(ctx) / shown(twin, studentId)   the same in two steps (start the read beside others, add the key after).
 *
 * Read only with the switch on, and only by the table and the league. No new table: quizzes + quiz_share_codes,
 * the columns the hub already reads. Cached per class code for 5 minutes.
 */
const { logToFile } = require('../../utils/logger');
const { read: dbRead } = require('./web-quiz-db-deadline');
const T = require('./web-quiz-token');

const TTL_MS = 5 * 60 * 1000;
const MAX = 500;
const cache = new Map(); // shareCodeId -> { at, twin: {id, code} | null }

async function lookup(ctx) {
  const { lessonRefs } = require('./web-quiz-hub')._parts;
  const { data: q } = await dbRead('classTwin:quizzes:1', (db) => db.from('quizzes').select('id, language, lesson_plan_id, coaching_session_id').eq('id', ctx.quizId).maybeSingle());
  const ref = lessonRefs(q)[0];
  if (!ref) return null;
  const [col, val] = ref.startsWith('lp:') ? ['lesson_plan_id', ref.slice(3)] : ['coaching_session_id', ref.slice(3)];
  const lang = q.language === 'ur' ? 'ur' : 'en';
  const { data: qs } = await dbRead('classTwin:quizzes:2', (db) => db.from('quizzes').select('id, language, lesson_plan_id, coaching_session_id').eq(col, val));
  const ids = (qs || []).filter((x) => x.id !== q.id && (x.language === 'ur' ? 'ur' : 'en') !== lang).map((x) => x.id);
  if (!ids.length) return null;
  const { data: codes } = await dbRead('classTwin:quiz_share_codes:1', (db) => db.from('quiz_share_codes')
    .select('id, code, quiz_id, active, expires_at, invited_by_student_id, parent_share_code_id, created_at')
    .eq('teacher_user_id', ctx.teacherUserId).in('quiz_id', ids));
  const now = Date.now();
  const open = (codes || []).filter((c) => c.active && !c.invited_by_student_id && !c.parent_share_code_id
    && (!c.expires_at || Date.parse(c.expires_at) > now));
  open.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return open[0] ? { id: open[0].id, code: open[0].code } : null;
}

// The lookup on its own ({id, code} or null; never throws), so a caller can start it beside its other reads.
async function find(ctx, now = Date.now()) {
  try {
    if (!ctx || !ctx.quizId || !ctx.teacherUserId) return null;
    let hit = cache.get(ctx.shareCodeId);
    if (!hit || now - hit.at >= TTL_MS) {
      hit = { at: now, twin: await lookup(ctx) };
      if (cache.size >= MAX) cache.delete(cache.keys().next().value);
      cache.set(ctx.shareCodeId, hit);
    }
    return hit.twin;
  } catch (err) {
    logToFile('⚠️ web quiz class twin: lookup failed — none', { error: err.message });
    return null;
  }
}

// What the page gets: the twin's code, and its hub key for the child when the child is known.
function shown(twin, studentId = null) {
  if (!twin) return null;
  const k = studentId ? T.chipId(twin.id, studentId) : null;
  return k ? { code: twin.code, k } : { code: twin.code };
}

async function twinOf(ctx, studentId = null, now = Date.now()) {
  return shown(await find(ctx, now), studentId);
}

module.exports = { twinOf, find, shown, _resetCache: () => cache.clear() };
