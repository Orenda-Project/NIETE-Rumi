'use strict';
/**
 * Identity v2 — the reads behind "who is this child?" and "who has not played?".
 *
 * The pure matcher and the quiz → class resolver live in web-quiz-identity.js;
 * this file reads the class roster they work on and builds the teacher's
 * non-attempter list from it:
 *
 *   identityMode()          app_settings `web_quiz_identity` ('v2' | null), 30 s cache, fails closed
 *   loadClassRoster(id)     class_enrollments(active) ⋈ students(active, not merged), deduped, 30 s cache
 *   canonicalStudentIds(ids)  the one id each child is known by (aliases folded), for the hub
 *   loadLegacyList(id)      a legacy student_lists roster (a teacher with lists and no class), deduped
 *   rosterOf(cls)           whichever of the two the resolved class stands on
 *   nonAttempters({shareCodeId})  played / not played / provisional for the teacher's report (M3)
 *
 * The page NEVER receives a roster. `number` is the teacher's list number (the
 * enrolment's roll_number, else the student's): the position in the list she
 * pasted, never a register roll the child is expected to know.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Identity = require('./web-quiz-identity');
const T = require('./web-quiz-token');
const { oneAttemptPerChild } = require('./one-attempt-per-child');
const { excludeSelfTests } = require('./teacher-self-test');

const FLAG_KEY = 'web_quiz_identity';
const TTL_MS = 30 * 1000;
const STUDENT_COLS = 'id, student_name, student_name_urdu, father_name, roll_number, is_active, status, created_at';

let flag = null;
const rosters = new Map();

const firstToken = (s) => String(s || '').trim().split(/\s+/)[0] || '';

/** 'v2' when app_settings.web_quiz_identity says so; null otherwise (absent, other, or a failed read). */
async function identityMode(now = Date.now()) {
  if (flag && now - flag.at < TTL_MS) return flag.mode;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', FLAG_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    let v = (data || [])[0] ? data[0].value : null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
    flag = { at: now, mode: typeof v === 'string' && v.trim().toLowerCase() === 'v2' ? 'v2' : null };
    return flag.mode;
  } catch (err) {
    logToFile('⚠️ web quiz identity: setting lookup failed — today\'s identity path', { error: err.message });
    return null;
  }
}

/** A students row as the matcher and the teacher's lists use it (number = the list number). */
function rosterRow(s, number, enrolled) {
  return {
    id: s.id,
    student_name: s.student_name,
    student_name_urdu: s.student_name_urdu || null,
    father_name: s.father_name || null,
    roll_number: number == null ? null : Number(number),
    created_at: s.created_at,
    enrolled,
  };
}

/** The matcher's canonical children, with the plain fields the brief names. */
function withFields(kids) {
  return kids.map((k) => ({
    ...k,
    first: firstToken(k.student_name),
    full: String(k.student_name || '').trim(),
    fatherFirst: firstToken(k.father_name) || null,
    number: k.roll_number == null ? null : Number(k.roll_number),
    nameUrdu: k.student_name_urdu || null,
    ids: [k.id, ...(k.aliases || [])],
  }));
}

function cached(key, now) {
  const hit = rosters.get(key);
  return hit && now - hit.at < TTL_MS ? hit.kids : null;
}

/**
 * The children of one class: its active enrolments whose student is active and
 * not merged, duplicates collapsed to one (the same child imported twice with
 * the same father; a stray un-enrolled row of the class's mirror list folded
 * into the enrolled child of that name, so a session on the stray row is that
 * child's). A stray row with no enrolled namesake is NOT a child of the class.
 * Null when the read fails (the caller treats the child as new, never as
 * another child).
 */
async function loadClassRoster(classId, now = Date.now()) {
  if (!classId) return null;
  const key = `class:${classId}`;
  const hit = cached(key, now);
  if (hit) return hit;
  try {
    const [{ data: enr, error }, { data: lists, error: lErr }] = await Promise.all([
      supabase.from('class_enrollments').select('student_id, roll_number').eq('class_id', classId).eq('is_active', true),
      supabase.from('student_lists').select('id').eq('class_id', classId).eq('is_active', true),
    ]);
    if (error || lErr) throw new Error((error || lErr).message);
    const ids = [...new Set((enr || []).map((e) => e.student_id).filter(Boolean))];
    const listIds = (lists || []).map((l) => l.id);
    let kids = [];
    if (ids.length) {
      const [{ data: st, error: sErr }, { data: strays, error: xErr }] = await Promise.all([
        supabase.from('students').select(STUDENT_COLS).in('id', ids).eq('is_active', true),
        listIds.length ? supabase.from('students').select(STUDENT_COLS).in('list_id', listIds).eq('is_active', true) : { data: [] },
      ]);
      if (sErr || xErr) throw new Error((sErr || xErr).message);
      const rollOf = new Map((enr || []).map((e) => [e.student_id, e.roll_number]));
      const live = (r) => r.status !== 'merged';
      kids = (st || []).filter(live).map((s) => rosterRow(s, rollOf.get(s.id) != null ? rollOf.get(s.id) : s.roll_number, true));
      const enrolled = new Set(ids);
      (strays || []).filter((s) => live(s) && !enrolled.has(s.id)).forEach((s) => kids.push(rosterRow(s, s.roll_number, false)));
    }
    const out = withFields(Identity.dedupe(kids).filter((k) => k.enrolled !== false));
    rosters.set(key, { at: now, kids: out });
    return out;
  } catch (err) {
    logToFile('⚠️ web quiz identity: class roster read failed', { classId, error: err.message });
    return null;
  }
}

/**
 * The one id each child is known by (the canonical roster child), for callers
 * that hold student ids from sessions — the hub's "from your teacher" links,
 * chips. A child of no class, or an id we cannot place, maps to itself.
 * → Map(id → canonical id)
 */
async function canonicalStudentIds(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean).map(String))];
  const out = new Map(ids.map((id) => [id, id]));
  if (!ids.length) return out;
  try {
    const [{ data: enr }, { data: st }] = await Promise.all([
      supabase.from('class_enrollments').select('student_id, class_id').in('student_id', ids).eq('is_active', true),
      supabase.from('students').select('id, list_id').in('id', ids),
    ]);
    const listIds = [...new Set((st || []).map((s) => s.list_id).filter(Boolean))];
    const { data: lists } = listIds.length
      ? await supabase.from('student_lists').select('id, class_id').in('id', listIds)
      : { data: [] };
    const classIds = new Set((enr || []).map((e) => e.class_id).filter(Boolean));
    (lists || []).forEach((l) => { if (l.class_id) classIds.add(l.class_id); });
    for (const classId of classIds) {
      const kids = (await loadClassRoster(classId)) || [];
      kids.forEach((k) => k.ids.forEach((id) => { if (out.has(id)) out.set(id, k.id); }));
    }
  } catch (err) {
    logToFile('⚠️ web quiz identity: canonical id lookup failed — ids kept as given', { error: err.message });
  }
  return out;
}

/** canonicalStudentIds for one id. */
async function canonicalStudentId(studentId) {
  return (await canonicalStudentIds([studentId])).get(String(studentId)) || studentId;
}

/** A legacy class list's children (a teacher who keeps lists without a class), deduped. */
async function loadLegacyList(listId, now = Date.now()) {
  if (!listId) return null;
  const key = `list:${listId}`;
  const hit = cached(key, now);
  if (hit) return hit;
  try {
    const { data, error } = await supabase.from('students').select(STUDENT_COLS)
      .eq('list_id', listId).eq('is_active', true);
    if (error) throw new Error(error.message);
    const kids = (data || []).filter((s) => s.status !== 'merged').map((s) => rosterRow(s, s.roll_number, false));
    const out = withFields(Identity.dedupe(kids));
    rosters.set(key, { at: now, kids: out });
    return out;
  } catch (err) {
    logToFile('⚠️ web quiz identity: legacy list read failed', { listId, error: err.message });
    return null;
  }
}

/** The roster a resolved class stands on: the class's enrolments, else its legacy list. */
async function rosterOf(cls) {
  if (!cls) return null;
  if (cls.id) return loadClassRoster(cls.id);
  if (cls.listId) return loadLegacyList(cls.listId);
  return null;
}

/** The roster child (canonical) this student id is, by its own id or an alias. */
function findKid(kids, studentId) {
  if (!kids || !studentId) return null;
  return kids.find((k) => k.ids.includes(studentId)) || null;
}

/**
 * An opaque per-code key for one of the teacher's classes (the page and the
 * teacher's report send it back; neither ever sees a class id).
 */
const classKeyV2 = (shareCodeId, c) => T.chipId(shareCodeId, c.id ? `class:${c.id}` : `list:${c.listId}`);

const byNumberThenFirst = (a, b) => ((a.number == null ? 1e9 : a.number) - (b.number == null ? 1e9 : b.number))
  || String(a.first).localeCompare(String(b.first));

/**
 * Who of the hand-out's class has played, who has not, and who played under a
 * name the class list does not have (a provisional child the teacher can add or
 * reattach). Counted finishes only: each child's FIRST finish, the teacher's own
 * runs and invited friends out — the rule the report and the league use.
 * One read of the code, one of its sessions, one of the roster.
 */
async function nonAttempters({ shareCodeId } = {}) {
  const { data: sc, error } = await supabase.from('quiz_share_codes')
    .select('id, quiz_id, teacher_user_id').eq('id', shareCodeId).maybeSingle();
  if (error) throw new Error(error.message || 'share code read failed');
  if (!sc) return null;
  const [resolved, { data: sessions }] = await Promise.all([
    Identity.resolveQuizClass({ teacherUserId: sc.teacher_user_id, quizId: sc.quiz_id, shareCodeId: sc.id }),
    supabase.from('quiz_sessions')
      .select('id, student_id, student_name, user_id, status, correct_answers, total_questions_answered, completed_at, created_at')
      .eq('share_code_id', sc.id).is('invited_by_student_id', null).eq('status', 'completed'),
  ]);
  const counted = oneAttemptPerChild(excludeSelfTests(sessions || [], sc.teacher_user_id), { rule: 'first_completed' })
    .filter((s) => s.student_id);
  const finish = (s) => ({ correct: s.correct_answers || 0, total: s.total_questions_answered || 0, finishedAt: s.completed_at || null });
  const state = resolved ? resolved.state : 'none';
  const classes = ((resolved && resolved.classes) || []).map((c) => ({ key: classKeyV2(sc.id, c), label: c.label || '' }));
  const kids = state === 'known' ? await rosterOf(resolved.class) : null;
  const cls = {
    state,
    id: state === 'known' && resolved.class ? resolved.class.id || null : null,
    label: state === 'known' && resolved.class ? resolved.class.label || null : null,
    of: kids ? kids.length : null,
    classes,
  };
  if (!kids) {
    return {
      class: cls,
      played: counted.map((s) => ({ sessionId: s.id, studentId: s.student_id, first: firstToken(s.student_name), number: null, onList: false, ...finish(s) }))
        .sort(byNumberThenFirst),
      notPlayed: null,
      provisional: [],
    };
  }
  // Two counted finishes on two rows of one pasted-twice child are one child: the first finish counts.
  const onList = [];
  const provisional = [];
  for (const s of counted) {
    const k = findKid(kids, s.student_id);
    if (k) onList.push({ s: { ...s, student_id: k.id }, k });
    else provisional.push({ sessionId: s.id, studentId: s.student_id, typed: String(s.student_name || ''), ...finish(s) });
  }
  const firsts = oneAttemptPerChild(onList.map((x) => x.s), { rule: 'first_completed' });
  const played = firsts.map((s) => {
    const k = kids.find((x) => x.id === s.student_id);
    return { sessionId: s.id, studentId: k.id, first: k.first, number: k.number, onList: true, ...finish(s) };
  }).sort(byNumberThenFirst);
  const done = new Set(played.map((p) => p.studentId));
  const notPlayed = kids.filter((k) => !done.has(k.id)).map((k) => ({ studentId: k.id, first: k.first, number: k.number }))
    .sort(byNumberThenFirst);
  return { class: cls, played, notPlayed, provisional: provisional.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt))) };
}

module.exports = {
  FLAG_KEY,
  identityMode, loadClassRoster, loadLegacyList, rosterOf, findKid, classKeyV2, nonAttempters,
  canonicalStudentIds, canonicalStudentId,
  /** A class whose roster just changed (a teacher enrolled a child) is read fresh next time. */
  _forgetClass: (classId) => { rosters.delete(`class:${classId}`); },
  _resetCache: () => { flag = null; rosters.clear(); },
};
