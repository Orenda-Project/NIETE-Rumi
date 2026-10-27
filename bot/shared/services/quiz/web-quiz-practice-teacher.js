'use strict';
/**
 * The teacher's own quizzes in their «experience as a child» preview (bd-5gyspy.5). A preview link that names its teacher
 * (`tu`, web-quiz-practice-play.js) shows on the Games door what a child of that teacher's class gets from them: the
 * teacher's quiz links still open from the last 7 days, newest first (the same codes the child hub's teacher card picks
 * its one from: teacher-sent, active, not expired, not a reply or an invite, and never a storybook the teacher only
 * previewed). Each row is LOOK-ONLY (`look: 1`): its name and subject, and nothing that opens anything. No code, no
 * token of any kind: the preview's hub link is a bearer URL a child can hold, and on NIETE a teacher's preview token
 * (`p`) is the teacher's key to «Who played?» (names and scores) and the who-fix writes, while NIETE has no quiz run that
 * writes nothing (redteam HIGH-1, #3843). The class plays the quiz from the teacher's own link.
 *
 *   rowsFor(teacherId, { previews })  [{kind:'quiz', look: 1, topic, subject, done:false, from:'teacher'}] (≤ MAX)
 *                                  [] with no teacher, no open code, or any failure. Never throws.
 *                                  previews(quizzes) -> Set of ids: the home's own "only previewed" rule
 *                                  (web-quiz-hub-home.js storyPreviews), handed in so this leaf requires no hub module.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

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
      rows.push({ kind: 'quiz', look: 1, topic: q.topic || c.topic || '', subject: q.subject || '', done: false, from: 'teacher' });
      if (rows.length >= MAX) break;
    }
    return rows;
  } catch (err) {
    logToFile('⚠️ web quiz practice: the teacher\'s quizzes unavailable', { error: err.message });
    return [];
  }
}

module.exports = { rowsFor, MAX, DAYS };
