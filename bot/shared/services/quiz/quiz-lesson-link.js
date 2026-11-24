'use strict';
/**
 * The lesson plan on every quiz (bd-ptl6x9.13.1) — `quizzes.meta.lesson_links`.
 *
 * `quizzes.lesson_plan_id` points at the legacy `lesson_plans` table, which K-5 (lp_v8) and 6-12
 * (lp612) plans do not use, so every plan quiz leaves it null and plan → quiz could not be read
 * (0 of 1,608 plan quizzes, 28 days to 18 Nov). The plan's identity already rides on the quiz in
 * `meta.lessons` (lp_v8/lp612) or on the recording (`coaching_sessions._fidelity_ref` when the
 * teacher picked her plan); this module puts both in ONE shape, one entry per lesson:
 *
 *   { lesson_id, plan_asset_id, grade, subject, book, chapter, lesson, pages, via }
 *
 * `lesson_id` is the exact plan code (joins niete_lp_downloads / niete_lp_opens .lesson_id);
 * `plan_asset_id` the plan document served (asset_id for K-5, render_id for 6-12);
 * `book` uses the exam-paper maker's key (`assessment_requests.grade_code + '_' + subject_code`),
 * so plan → quiz → paper join on (teacher, book, chapter) with no new column.
 * `via`: 'plan' (made from the plan) | 'teacher_picked' (recording, plan chosen by the teacher).
 * Never guessed: no code → no link. Pure apart from forRecording, which never throws.
 */

const SUBJECT_ALIASES = Object.freeze({ math: 'maths', mathematics: 'maths', general_science: 'science' });
const K5 = /^grade_(\d+)_(.+)_ch(\d+)_seg(\d+)$/;
const G612 = /^grade_(\d+)_([a-z_]+)\.c(\d+)\.p([\d-]+)(?:\..*)?$/;

function subjectKey(subject) {
  if (!subject) return null;
  const s = String(subject).trim().toLowerCase().replace(/\s+/g, '_');
  return SUBJECT_ALIASES[s] || s;
}

/** The book key — `grade_<n>_<subject>`, as the exam-paper row spells it. */
function bookKey(grade, subject) {
  const g = grade == null ? null : String(grade).replace(/^grade_/, '');
  const s = subjectKey(subject);
  if (!g || !s) return null;
  return `grade_${g}_${s}`;
}

/** A plan code read into book / chapter / lesson; an unknown code keeps the code only. */
function parse(code) {
  if (!code) return null;
  const id = String(code);
  const k5 = K5.exec(id);
  const g = k5 || G612.exec(id);
  if (!g) return { lesson_id: id, grade: null, subject: null, book: null, chapter: null, lesson: null, pages: null };
  const grade = Number(g[1]);
  const subject = subjectKey(g[2]);
  return {
    lesson_id: id,
    grade,
    subject,
    book: bookKey(grade, subject),
    chapter: Number(g[3]),
    lesson: k5 ? Number(g[4]) : null,
    pages: k5 ? null : g[4],
  };
}

function linkOf(code, planAssetId, via) {
  const p = parse(code);
  return p ? { ...p, plan_asset_id: planAssetId || null, via } : null;
}

/** `meta.lessons` of an lp_v8 / lp612 quiz → its links. */
function fromPlanLessons(lessons) {
  if (!Array.isArray(lessons)) return [];
  return lessons
    .map((l) => l && linkOf(l.lesson_id || l.segment_id, l.asset_id || l.render_id, 'plan'))
    .filter(Boolean);
}

/** A recording's plan, only when the teacher picked it (`selected_recent`). */
function fromRecording(session) {
  if (!session || session.lesson_plan_link_method !== 'selected_recent') return [];
  const ref = session.ref || (session.lesson_plan_structured && session.lesson_plan_structured._fidelity_ref);
  const link = ref && linkOf(ref.lesson_id, null, 'teacher_picked');
  return link ? [link] : [];
}

/** One PK read of the recording's reference slice. Any failure → [] (a quiz is never held up). */
async function forRecording(sessionId) {
  if (!sessionId) return [];
  try {
    const supabase = require('../../config/supabase');
    const { data, error } = await supabase.from('coaching_sessions')
      .select('lesson_plan_link_method, ref:lesson_plan_structured->_fidelity_ref')
      .eq('id', sessionId).maybeSingle();
    if (error || !data) return [];
    return fromRecording(data);
  } catch (_) {
    return [];
  }
}

module.exports = { parse, bookKey, subjectKey, fromPlanLessons, fromRecording, forRecording };
