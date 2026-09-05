'use strict';
/**
 * Transcript quiz — the one nudge. Three hours after the link went out, if
 * fewer than five children have started, the teacher is told how many have
 * and asked whether the link is worth forwarding again. Once, never twice.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { teacherLanguageFor } = require('./transcript-quiz-language');

const NUDGE_BELOW = 5;

async function process(quizId) {
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, topic, status, language, meta').eq('id', quizId).maybeSingle();
  if (!quiz) return { skipped: 'quiz_not_found' };
  if (quiz.status !== 'sent') return { skipped: `status_${quiz.status}` };
  if (quiz.meta?.nudged_at) return { skipped: 'already_nudged' };

  const { data: sessions } = await supabase.from('quiz_sessions')
    .select('id').eq('quiz_id', quizId).is('invited_by_student_id', null);
  const started = (sessions || []).length;
  if (started >= NUDGE_BELOW) return { skipped: 'enough_started', started };

  const { data: teacher } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', quiz.teacher_id).maybeSingle();
  if (!teacher?.phone_number) return { skipped: 'no_phone' };
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language || quiz.meta?.teacher_language, transcriptLanguage: quiz.language });

  const ok = await WhatsAppService.sendMessage(teacher.phone_number,
    resolveUx('tqNudge', { language: lang, params: { started, topic: quiz.topic || '' } }));
  await supabase.from('quizzes')
    .update({ meta: { ...(quiz.meta || {}), nudged_at: new Date().toISOString(), nudge_started: started } })
    .eq('id', quizId);
  logEvent('transcript_quiz.nudged', { quizId, started, sent: Boolean(ok) });
  if (!ok) logToFile('⚠️ transcript quiz: nudge not delivered', { quizId });
  return { ok: true, started };
}

module.exports = { process, NUDGE_BELOW };
