'use strict';
/**
 * The teacher's own quizzes in their «experience as a child» preview (bd-5gyspy.5). A preview link that names its teacher
 * (`tu`, web-quiz-practice-play.js) shows on the Games door what a child of that teacher's class gets from them: the
 * teacher's quiz links still open from the last 7 days, newest first (the same codes the child hub's teacher card picks
 * its one from: teacher-sent, active, not expired, not a reply or an invite, and never a storybook the teacher only
 * previewed). Each row opens as the TEACHER'S OWN PREVIEW of that quiz (`p`, a signed preview token: the attempt is
 * stored under the teacher, the existing self-test marker, so it never reaches the roster, the average or the league),
 * never as a child: no child row, no binding, nothing under any child.
 *
 *   rowsFor(teacherId, { previews })  [{kind:'quiz', code, k:'', p, topic, subject, done:false, from:'teacher'}] (≤ MAX)
 *                                  [] with no teacher, no open code, no signing secret, or any failure. Never throws.
 *                                  previews(quizzes) -> Set of ids: the home's own "only previewed" rule
 *                                  (web-quiz-hub-home.js storyPreviews), handed in so this leaf requires no hub module.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');

const DAYS = 7;
const MAX = 5;
const TU_RX = /^[A-Za-z0-9-]{1,64}$/;
const isOpen = (c) => c && c.active !== false && (!c.expires_at || new Date(c.expires_at).getTime() > Date.now());

async function rowsFor(teacherId, { previews: previewsOf = () => new Set(), now = Date.now() } = {}) {
  if (typeof teacherId !== 'string' || !TU_RX.test(teacherId)) return [];
  try {
    const { data: codes, error } = await supabase.from('quiz_share_codes').select('id, code, quiz_id, topic, active, expires_at, created_at, teacher_user_id')
      .eq('teacher_user_id', teacherId).eq('active', true).is('parent_share_code_id', null).is('invited_by_student_id', null)
      .gte('created_at', new Date(now - DAYS * 86400000).toISOString()).order('created_at', { ascending: false }).limit(30);
    if (error) throw new Error(error.message || 'quiz_share_codes read failed');
    const open = (codes || []).filter(isOpen);
    if (!open.length) return [];
    const { data: quizzes, error: qErr } = await supabase.from('quizzes').select('id, topic, subject, quiz_source, status, meta')
      .in('id', [...new Set(open.map((c) => c.quiz_id))]);
    if (qErr) throw new Error(qErr.message || 'quizzes read failed');
    const byId = new Map((quizzes || []).map((q) => [q.id, q]));
    const previews = previewsOf(quizzes || []);
    const rows = [];
    for (const c of open) {
      const q = byId.get(c.quiz_id);
      if (!q || previews.has(q.id)) continue;
      const p = T.signPreview({ shareCodeId: c.id, teacherUserId: teacherId });
      if (!p) return [];
      rows.push({ kind: 'quiz', code: c.code, k: '', p, topic: q.topic || c.topic || '', subject: q.subject || '', done: false, from: 'teacher' });
      if (rows.length >= MAX) break;
    }
    return rows;
  } catch (err) {
    logToFile('⚠️ web quiz practice: the teacher\'s quizzes unavailable', { error: err.message });
    return [];
  }
}

module.exports = { rowsFor, MAX, DAYS };
