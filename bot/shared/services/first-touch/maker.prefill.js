'use strict';
/**
 * The maker page's pre-fill — "Last time: Grade 4, Maths" offered as a one-tap confirm.
 *
 * ONE normaliser over four sources for a teacher (users.id):
 *   1. their own quizzes                 quizzes.teacher_id = uid                 → grade, subject
 *   2. the bank quizzes they shared      quiz_share_codes.teacher_user_id = uid   → quizzes.grade, subject
 *   3. their lesson plans                lesson_plans.user_id = uid               → grade, subject
 *   4. their classes                     class_teachers (teacher_user_id = uid, active)
 *                                          → classes.grade_code (active class)
 *                                          → class_teacher_subjects.subject_code (that assignment)
 *
 * The raw values are mapped to the page's chip codes (grade_1..grade_5; maths, english, urdu, science,
 * general_knowledge, islamic_studies). A cell is offered only when the union of every source yields exactly ONE
 * grade code and ONE subject code, no source carries a band grade ('3-5', '1-2', …), and the bank has a quiz for
 * that cell (the caller's hasCell). Values outside the chips (Nursery, KG, grade 6+, social studies, anything
 * unknown) are ignored: they neither offer nor veto. Only a band vetoes.
 *
 * Reads only. prefillFor never throws: any read error, or a failing hasCell, is "no pre-fill" (null).
 */

const BAND = Object.freeze({ band: true });

const GRADE_CODES = new Set(['grade_1', 'grade_2', 'grade_3', 'grade_4', 'grade_5']);

const SUBJECTS = new Map(Object.entries({
  maths: 'maths', math: 'maths', mathematics: 'maths',
  english: 'english',
  urdu: 'urdu',
  science: 'science', general_science: 'science',
  general_knowledge: 'general_knowledge', genk: 'general_knowledge', 'general knowledge': 'general_knowledge',
  islamiyat: 'islamic_studies', 'islamic studies': 'islamic_studies',
}));

const ROW_LIMIT = 1000; // PostgREST's default max rows; the newest are read first
const IN_CHUNK = 300;   // ids per .in() list (the response-header cap is ~390 UUIDs)

/** A raw grade → 'grade_1'..'grade_5', BAND (a band-graded value: vetoes any pre-fill), or null (not a chip). Pure. */
function normaliseGrade(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+\s*-\s*\d+$/.test(s)) return BAND;
  const m = /^(?:grade_)?(\d+)$/.exec(s);
  if (!m) return null;
  const code = `grade_${Number(m[1])}`;
  return GRADE_CODES.has(code) ? code : null;
}

/** A raw subject → its chip code, or null (social studies, or anything not in the table). Pure. */
function normaliseSubject(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  return SUBJECTS.get(s) || null;
}

/** The one grade and one subject the raw values agree on, or null. Pure. */
function candidate({ grades = [], subjects = [] } = {}) {
  const g = new Set();
  for (const raw of grades || []) {
    const code = normaliseGrade(raw);
    if (code === BAND) return null;
    if (code) g.add(code);
  }
  const s = new Set();
  for (const raw of subjects || []) {
    const code = normaliseSubject(raw);
    if (code) s.add(code);
  }
  if (g.size !== 1 || s.size !== 1) return null;
  return { grade: [...g][0], subject: [...s][0] };
}

/**
 * "<grade_code>|<subject_code>" or null. Pure, given hasCell. When hasCell answers with a promise, so does decide.
 * @param {{ grades: Array, subjects: Array, hasCell: (grade: string, subject: string) => boolean|Promise<boolean> }} input
 */
function decide({ grades, subjects, hasCell } = {}) {
  const c = candidate({ grades, subjects });
  if (!c || typeof hasCell !== 'function') return null;
  const key = `${c.grade}|${c.subject}`;
  let ok;
  try { ok = hasCell(c.grade, c.subject); } catch (_) { return null; }
  if (ok && typeof ok.then === 'function') return Promise.resolve(ok).then((v) => (v === true ? key : null), () => null);
  return ok === true ? key : null;
}

function rows(res, what) {
  if (!res || res.error) throw new Error(`${what} read failed`);
  return res.data || [];
}

function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Every raw grade and subject the four sources hold for uid. Throws on a read error. */
async function sources(db, uid) {
  const [own, shared, plans, assignments] = await Promise.all([
    db.from('quizzes').select('grade, subject').eq('teacher_id', uid)
      .order('created_at', { ascending: false }).limit(ROW_LIMIT),
    db.from('quiz_share_codes').select('quiz_id').eq('teacher_user_id', uid)
      .order('created_at', { ascending: false }).limit(ROW_LIMIT),
    db.from('lesson_plans').select('grade, subject').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(ROW_LIMIT),
    db.from('class_teachers').select('id, class_id').eq('teacher_user_id', uid).eq('is_active', true).limit(ROW_LIMIT),
  ]);
  const grades = [];
  const subjects = [];
  const take = (list) => { for (const r of list) { grades.push(r.grade); subjects.push(r.subject); } };

  take(rows(own, 'quizzes'));
  take(rows(plans, 'lesson_plans'));

  const sharedIds = [...new Set(rows(shared, 'quiz_share_codes').map((r) => r.quiz_id).filter(Boolean))];
  for (const ids of chunks(sharedIds, IN_CHUNK)) {
    take(rows(await db.from('quizzes').select('grade, subject').in('id', ids), 'quizzes'));
  }

  const mine = rows(assignments, 'class_teachers');
  const classIds = [...new Set(mine.map((a) => a.class_id).filter(Boolean))];
  for (const ids of chunks(classIds, IN_CHUNK)) {
    for (const c of rows(await db.from('classes').select('grade_code').in('id', ids).eq('is_active', true), 'classes')) {
      grades.push(c.grade_code);
    }
  }
  for (const ids of chunks(mine.map((a) => a.id), IN_CHUNK)) {
    for (const s of rows(await db.from('class_teacher_subjects').select('subject_code').in('class_teacher_id', ids), 'class_teacher_subjects')) {
      subjects.push(s.subject_code);
    }
  }
  return { grades, subjects };
}

/**
 * The pre-fill for a teacher: "<grade_code>|<subject_code>" or null. Never throws.
 * @param {string} uid users.id
 * @param {{ supabase?, hasCell: (grade, subject) => boolean|Promise<boolean> }} deps
 */
async function prefillFor(uid, { supabase, hasCell } = {}) {
  if (!uid || typeof hasCell !== 'function') return null;
  try {
    const db = supabase || require('../../config/supabase');
    const { grades, subjects } = await sources(db, uid);
    return (await decide({ grades, subjects, hasCell })) || null;
  } catch (_) {
    return null;
  }
}

module.exports = { normaliseGrade, normaliseSubject, candidate, decide, prefillFor, BAND, GRADE_CODES };
