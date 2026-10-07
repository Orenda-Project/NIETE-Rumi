'use strict';
/**
 * Who is offered the kid's Challenge: app_settings `web_quiz_challenge`, read in the same shapes as
 * `web_quiz_teachers` (web-quiz-link.js) so production can run a canary before "all":
 *
 *   true | "true" | "all"        every child
 *   ["<teacher user id>", …]     a child one of whose TEACHERS is listed: the teacher of the quiz the child came
 *                                from, the class list's teacher, the class's teachers (class_teachers), and the
 *                                teachers of the codes the child played
 *   false | missing | other      nobody
 *
 * Fails closed: a read error is "nobody" and is not cached. 30 s cache, like its neighbours. One reader for the
 * Challenge's own routes (web-quiz-challenge.js) and the hub's Challenge card (web-quiz-hub.js).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_challenge';
const TTL_MS = 30 * 1000;
const RECENT_SESSIONS = 20;
let cache = null; // { at, scope }

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

/** The flag's value as a scope: {mode:'all'} | {mode:'list', ids:[…]} | {mode:'off'}. Pure. */
function scopeOf(value) {
  const v = parse(value);
  if (v === true) return { mode: 'all' };
  if (typeof v === 'string' && ['true', 'all'].includes(v.trim().toLowerCase())) return { mode: 'all' };
  if (Array.isArray(v)) {
    const ids = v.filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim()).filter(Boolean);
    return ids.length ? { mode: 'list', ids } : { mode: 'off' };
  }
  return { mode: 'off' };
}

async function scope(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.scope;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, scope: scopeOf(data && data[0] ? data[0].value : undefined) };
    return cache.scope;
  } catch (e) {
    logToFile('⚠️ web quiz challenge: flag lookup failed — off', { error: e.message });
    return { mode: 'off' };
  }
}

/** Anyone at all (the flag is not off) — the cheap check before any child is looked up. */
async function on() {
  return (await scope()).mode !== 'off';
}

/** The child's teachers' user ids (see the header). Throws on a read error; offeredTo() turns that into "no". */
async function teachersOf(studentId, { shareCodeId } = {}) {
  const ids = new Set();
  const add = (v) => { if (v) ids.add(String(v)); };
  const must = (r) => { if (r && r.error) throw new Error(r.error.message || 'read failed'); return (r && r.data) || null; };

  const kid = must(await supabase.from('students').select('id, list_id').eq('id', studentId).maybeSingle());
  if (kid && kid.list_id) {
    const list = must(await supabase.from('student_lists').select('id, user_id').eq('id', kid.list_id).maybeSingle());
    add(list && list.user_id);
  }
  const enr = must(await supabase.from('class_enrollments').select('id, class_id, is_active').eq('student_id', studentId).eq('is_active', true)) || [];
  const classIds = [...new Set(enr.map((e) => e.class_id).filter(Boolean))];
  if (classIds.length) {
    const ct = must(await supabase.from('class_teachers').select('class_id, teacher_user_id, is_active').in('class_id', classIds).eq('is_active', true)) || [];
    ct.forEach((r) => add(r.teacher_user_id));
  }
  const sessions = must(await supabase.from('quiz_sessions').select('id, share_code_id, created_at')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(RECENT_SESSIONS)) || [];
  const codes = new Set(sessions.map((s) => s.share_code_id).filter(Boolean));
  if (shareCodeId) codes.add(shareCodeId);
  if (codes.size) {
    const sc = must(await supabase.from('quiz_share_codes').select('id, teacher_user_id').in('id', [...codes])) || [];
    sc.forEach((c) => add(c.teacher_user_id));
  }
  return [...ids];
}

/** Is the Challenge offered to this child? Never throws; fails closed. */
async function offeredTo(studentId, { shareCodeId } = {}) {
  const s = await scope();
  if (s.mode === 'all') return true;
  if (s.mode !== 'list' || !studentId) return false;
  try {
    const teachers = await teachersOf(studentId, { shareCodeId });
    return teachers.some((t) => s.ids.includes(t));
  } catch (e) {
    logToFile('⚠️ web quiz challenge: teacher lookup failed — not offered', { error: e.message });
    return false;
  }
}

module.exports = { scopeOf, scope, on, teachersOf, offeredTo, KEY, _resetCache: () => { cache = null; } };
