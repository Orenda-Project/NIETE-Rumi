'use strict';
/**
 * Transcript quiz — /quiz.
 *
 * Lists the teacher's recent self-coaching lessons newest-first with the
 * state of each lesson's quiz (none yet / being made / sent · N started /
 * report sent), and turns a tap into the right action: make it, resend the
 * forwardable link, or fetch the class report now.
 *
 * This REPLACES the parent-quiz /quiz on NIETE when the flag is on (that
 * path needed parents' phone numbers, which 68 of 5,310 students have — it
 * produced zero quizzes). The parent-quiz plumbing that the report and the
 * scorecard still use is untouched.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { truncateCodePoints } = require('./religious-marks');
const { teacherLanguageFor, formatLessonDate } = require('./transcript-quiz-language');
const { MIN_TRANSCRIPT_CHARS } = require('./transcript-quiz-offer.service');

const PICK_PREFIX = 'tq_pick_';
const LINK_PREFIX = 'tq_link_';
const REPORT_PREFIX = 'tq_report_';
const MAX_ROWS = 10;
const TITLE_MAX = 24;
const DESC_MAX = 72;

function isQuizCommand(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\/quiz(\s|$)/i.test(t)) return true;
  const low = t.toLowerCase();
  return low === 'quiz' || t === 'کوئز' || t === 'کوئز؟';
}

function statusLine(quiz, language) {
  if (!quiz) return resolveUx('tqRowNoQuiz', { language });
  const started = quiz.meta?.started ?? quiz._started ?? 0;
  const finished = quiz.meta?.finished ?? quiz._finished ?? 0;
  switch (quiz.status) {
    case 'offered': return resolveUx('tqRowOffered', { language });
    case 'generating':
    case 'ready': return resolveUx('tqRowMaking', { language });
    case 'sent': return resolveUx('tqRowSent', { language, params: { started, finished } });
    case 'report_sent': return resolveUx('tqRowReportSent', { language, params: { finished } });
    case 'failed': return resolveUx('tqRowFailed', { language });
    default: return resolveUx('tqRowNoQuiz', { language });   // declined, skipped, cancelled
  }
}

/** Pure: sessions + quizzes → list rows. */
function buildRows(sessions, quizzes, language) {
  const byId = new Map((quizzes || []).map((q) => [q.coaching_session_id, q]));
  return (sessions || [])
    .filter((s) => String(s.transcript_text || '').length >= MIN_TRANSCRIPT_CHARS || byId.has(s.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_ROWS)
    .map((s) => {
      const quiz = byId.get(s.id) || null;
      const topic = quiz?.topic || s.analysis_data?.topic || resolveUx('tqLessonWord', { language });
      const title = truncateCodePoints(`${formatLessonDate(s.created_at, language)} · ${topic}`, TITLE_MAX);
      return {
        id: `${PICK_PREFIX}${s.id}`,
        title,
        description: truncateCodePoints(statusLine(quiz, language), DESC_MAX),
      };
    });
}

async function countsFor(quizIds) {
  const counts = new Map();
  if (!quizIds.length) return counts;
  const { data } = await supabase.from('quiz_sessions')
    .select('quiz_id, status').in('quiz_id', quizIds).is('invited_by_student_id', null);
  (data || []).forEach((s) => {
    const c = counts.get(s.quiz_id) || { started: 0, finished: 0 };
    c.started += 1;
    if (s.status === 'completed') c.finished += 1;
    counts.set(s.quiz_id, c);
  });
  return counts;
}

async function showList(user, phone, language) {
  const lang = teacherLanguageFor({ preferredLanguage: language || user?.preferred_language });
  const { data: sessions } = await supabase.from('coaching_sessions')
    .select('id, created_at, transcript_text, analysis_data')
    .eq('user_id', user.id)
    .is('observation_type', null)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(25);
  const ids = (sessions || []).map((s) => s.id);
  let quizzes = [];
  if (ids.length) {
    const { data } = await supabase.from('quizzes')
      .select('id, coaching_session_id, status, topic, meta')
      .eq('teacher_id', user.id).eq('quiz_source', 'transcript').in('coaching_session_id', ids);
    quizzes = data || [];
  }
  const counts = await countsFor(quizzes.filter((q) => ['sent', 'report_sent'].includes(q.status)).map((q) => q.id));
  quizzes.forEach((q) => { const c = counts.get(q.id); if (c) { q._started = c.started; q._finished = c.finished; } });

  const rows = buildRows(sessions, quizzes, lang);
  if (!rows.length) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqListEmpty', { language: lang }));
    logEvent('transcript_quiz.list_empty', { userId: user.id });
    return true;
  }
  await WhatsAppService.sendInteractiveMessage(phone, {
    body: { text: resolveUx('tqListBody', { language: lang }) },
    action: {
      button: resolveUx('tqListButton', { language: lang }),
      sections: [{ title: resolveUx('tqListSection', { language: lang }), rows }],
    },
  });
  logEvent('transcript_quiz.list_shown', { userId: user.id, rows: rows.length });
  return true;
}

async function enqueueGenerate(quizId, phone, lang) {
  const SQSQueueService = require('../queue/sqs-queue.service');
  await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: lang, source: 'list' }, { delaySeconds: 0 });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: lang }));
}

async function handleListPick(listId, phone, user) {
  if (!listId || !listId.startsWith(PICK_PREFIX)) return false;
  const sessionId = listId.slice(PICK_PREFIX.length);
  const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  if (!user?.id) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: session } = await supabase.from('coaching_sessions')
    .select('id, user_id, created_at, transcript_text, analysis_data')
    .eq('id', sessionId).eq('user_id', user.id).maybeSingle();
  if (!session) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, status, topic, language, meta, coaching_session_id')
    .eq('coaching_session_id', sessionId).eq('quiz_source', 'transcript').maybeSingle();

  if (!quiz) {
    const { data: created, error } = await supabase.from('quizzes').insert({
      teacher_id: user.id, quiz_source: 'transcript', coaching_session_id: sessionId,
      topic: session.analysis_data?.topic || 'Lesson', subject: session.analysis_data?.subject || null,
      status: 'generating', meta: { step: 'digest', source: 'list', claimed_at: new Date().toISOString() },
    }).select('id').single();
    if (error || !created) {
      logToFile('⚠️ transcript quiz: list claim failed', { sessionId, error: error?.message });
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    }
    await enqueueGenerate(created.id, phone, lang);
    logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: created.id, from: 'none' });
    return true;
  }

  switch (quiz.status) {
    case 'generating':
    case 'ready':
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    case 'sent':
    case 'report_sent': {
      const counts = await countsFor([quiz.id]);
      const c = counts.get(quiz.id) || { started: 0, finished: 0 };
      await WhatsAppService.sendInteractiveButtons(phone, {
        body: resolveUx('tqQuizStatus', { language: lang, params: { topic: quiz.topic || '', started: c.started, finished: c.finished } }),
        buttons: [
          { id: `${LINK_PREFIX}${quiz.id}`, title: resolveUx('tqLinkButton', { language: lang }) },
          { id: `${REPORT_PREFIX}${quiz.id}`, title: resolveUx('tqReportButton', { language: lang }) },
        ],
      });
      return true;
    }
    default: {
      // offered / declined / skipped / failed / cancelled → (re)make it.
      await supabase.from('quizzes')
        .update({ status: 'generating', meta: { ...(quiz.meta || {}), step: quiz.meta?.digest ? 'author' : 'digest', source: 'list', retried_at: new Date().toISOString() } })
        .eq('id', quiz.id);
      await enqueueGenerate(quiz.id, phone, lang);
      logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: quiz.id, from: quiz.status });
      return true;
    }
  }
}

async function handleActionButton(buttonId, phone) {
  const isLink = buttonId && buttonId.startsWith(LINK_PREFIX);
  const isReport = buttonId && buttonId.startsWith(REPORT_PREFIX);
  if (!isLink && !isReport) return false;
  const quizId = buttonId.slice((isLink ? LINK_PREFIX : REPORT_PREFIX).length);
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, status, language, topic, meta').eq('id', quizId).maybeSingle();
  if (!quiz) return true;
  const { data: teacher } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', quiz.teacher_id).maybeSingle();
  const lang = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language || quiz.meta?.teacher_language, transcriptLanguage: quiz.language });

  if (isLink) {
    const msg = quiz.meta?.student_message;
    if (!msg) {
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    }
    await WhatsAppService.sendMessage(phone, resolveUx('tqForwardThis', { language: lang }));
    await WhatsAppService.sendMessage(phone, msg);
    logEvent('transcript_quiz.link_resent', { quizId });
    return true;
  }

  const shareCodeId = quiz.meta?.share_code_id;
  if (!shareCodeId) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNoReportYet', { language: lang }));
    return true;
  }
  await WhatsAppService.sendMessage(phone, resolveUx('tqReportComing', { language: lang }));
  const Report = require('./video-quiz-report.service');
  const sent = await Report.generate(shareCodeId, { reason: 'requested', force: true });
  if (!sent) await WhatsAppService.sendMessage(phone, resolveUx('tqNoReportYet', { language: lang }));
  logEvent('transcript_quiz.report_requested', { quizId, sent: Boolean(sent) });
  return true;
}

module.exports = {
  isQuizCommand, buildRows, showList, handleListPick, handleActionButton, statusLine,
  PICK_PREFIX, LINK_PREFIX, REPORT_PREFIX, MAX_ROWS,
};
