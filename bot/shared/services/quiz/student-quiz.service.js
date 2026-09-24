'use strict';
/**
 * The CHILD's /quiz (bd-2yyry.13, operator 14 Sep 2026).
 *
 * A child typing /quiz, or tapping Quizzes on the child menu, can re-attempt a
 * quiz they took or see their class card — the way a teacher's /quiz lists
 * lessons and then offers actions. This is a SEPARATE thing from the teacher's
 * /quiz and shares nothing with it: its own Flow asset per WABA
 * (STUDENT_QUIZ_FLOW_ID, list of buttons as the fallback when unset), its own
 * endpoint (student-quiz-flow-endpoint.js) with its own discriminator
 * (sq_action), its own strings (sq*). A child is routed here by
 * student-ingress.js before the text handler's /quiz branch ever runs; a
 * teacher never enters this module.
 *
 * Data: the quizzes on THIS handset — every active quiz-joined students row
 * (a sibling handset has more than one), their quiz_sessions grouped by share
 * code, the latest completed attempt and the best one, the class average from
 * the same one-attempt-per-child rows the report counts.
 */
const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const StudentIdentity = require('./student-identity.service');
const ChildFlowToken = require('./child-flow-token');

const MAX_QUIZZES = 18;
const FALLBACK_TTL_SECS = 60 * 60;
const FALLBACK_KEY = (phone) => `student_quiz:${String(phone || '').replace(/^\+/, '')}:last`;
const RETRY_ID = 'sq_retry';
const CARD_ID = 'sq_card';

function flowId() {
  return process.env.STUDENT_QUIZ_FLOW_ID || '';
}

function pctOf(s) {
  return Number(s.mastery_percentage) || (s.total_questions_answered
    ? Math.round(100 * (s.correct_answers || 0) / s.total_questions_answered) : 0);
}

/**
 * The quizzes taken on this handset, newest first, one entry per share code.
 * @returns {Promise<Array<{shareCodeId, code, active, quizId, topic, subject, language, studentId,
 *   studentName, className, attempts, latest, best, lastAt}>>}
 */
async function quizzesForHandset(phone) {
  const known = await StudentIdentity.findByPhone(phone);
  if (!known.length) return [];
  const byStudent = new Map(known.map((s) => [s.id, s]));

  const { data: sessions, error } = await supabase
    .from('quiz_sessions')
    .select('id, quiz_id, share_code_id, student_id, status, correct_answers, total_questions_answered, '
            + 'mastery_percentage, completed_at, created_at, student_class')
    .in('student_id', known.map((s) => s.id))
    .not('share_code_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) {
    logToFile('⚠️ student-quiz: sessions read failed', { error: error.message });
    return [];
  }
  const groups = new Map();
  (sessions || []).forEach((s) => {
    const g = groups.get(s.share_code_id) || {
      shareCodeId: s.share_code_id, quizId: s.quiz_id, studentId: s.student_id,
      attempts: 0, latest: null, best: null, lastAt: s.created_at, className: s.student_class || null,
    };
    g.attempts += 1;
    if (s.status === 'completed') {
      if (!g.latest || String(s.completed_at || '') > String(g.latest.completed_at || '')) g.latest = s;
      if (!g.best || pctOf(s) > pctOf(g.best)) g.best = s;
    }
    groups.set(s.share_code_id, g);
  });
  const list = [...groups.values()].slice(0, MAX_QUIZZES);
  if (!list.length) return [];

  const [{ data: codes }, { data: quizzes }] = await Promise.all([
    supabase.from('quiz_share_codes').select('id, code, active, expires_at, topic, language')
      .in('id', list.map((g) => g.shareCodeId)),
    supabase.from('quizzes').select('id, topic, subject, language, grade')
      .in('id', list.map((g) => g.quizId)),
  ]);
  const codeById = new Map((codes || []).map((c) => [c.id, c]));
  const quizById = new Map((quizzes || []).map((q) => [q.id, q]));
  return list.map((g) => {
    const c = codeById.get(g.shareCodeId) || {};
    const q = quizById.get(g.quizId) || {};
    const expired = c.expires_at && new Date(c.expires_at).getTime() < Date.now();
    const st = byStudent.get(g.studentId) || {};
    return {
      ...g,
      code: c.code || null,
      active: Boolean(c.code) && c.active !== false && !expired,
      topic: q.topic || c.topic || '',
      subject: q.subject || '',
      language: clampLanguage(q.language || c.language || 'en'),
      studentName: st.student_name || '',
      className: g.className || st.self_reported_class || null,
    };
  });
}

/** Open the child's /quiz: the Flow when configured, else two buttons for the latest quiz. */
async function open(phone, { language = 'en' } = {}) {
  const quizzes = await quizzesForHandset(phone);
  const lang = clampLanguage(quizzes[0]?.language || language);
  if (!quizzes.length) {
    await WhatsAppService.sendMessage(phone, resolveUx('sqNoQuizzes', { language: lang }));
    logEvent('student_quiz.opened', { how: 'none' });
    return true;
  }
  const latest = quizzes[0];
  if (flowId()) {
    const flowToken = ChildFlowToken.build({
      phone, shareCodeId: latest.shareCodeId, studentId: latest.studentId, language: lang,
    });
    const sent = await WhatsAppService.sendFlow(phone, {
      flowId: flowId(),
      header: resolveUx('sqFlowHeader', { language: lang }),      // ≤ 60 code points
      body: resolveUx('sqFlowBody', { language: lang }),
      buttonText: resolveUx('sqFlowButton', { language: lang }), // ≤ 20 code points
      flowToken,
    });
    if (sent) { logEvent('student_quiz.opened', { how: 'flow', quizzes: quizzes.length }); return true; }
    logToFile('⚠️ student-quiz: flow send failed, falling back to buttons', {});
  }
  await redisService.set(FALLBACK_KEY(phone), {
    shareCodeId: latest.shareCodeId, studentId: latest.studentId, code: latest.code,
    active: latest.active, language: lang, quizId: latest.quizId,
  }, FALLBACK_TTL_SECS);
  const score = latest.latest ? `${latest.latest.correct_answers || 0}/${latest.latest.total_questions_answered || 0}` : '—';
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('sqFallbackBody', { language: lang, params: { topic: latest.topic, score } }),
    buttons: [
      { id: RETRY_ID, title: resolveUx('sqActionRetry', { language: lang }) },   // ≤ 20 code points
      { id: CARD_ID, title: resolveUx('sqActionCard', { language: lang }) },
    ],
  });
  logEvent('student_quiz.opened', { how: 'buttons', quizzes: quizzes.length });
  return true;
}

/** The two fallback buttons. */
async function handleButton(buttonId, phone) {
  if (buttonId !== RETRY_ID && buttonId !== CARD_ID) return false;
  const ctx = await redisService.get(FALLBACK_KEY(phone));
  await redisService.delete(FALLBACK_KEY(phone));
  if (!ctx) return true;
  if (buttonId === RETRY_ID) await retry(phone, ctx);
  else await sendCard(phone, ctx);
  return true;
}

/**
 * Take the quiz again — the same start a tapped link runs, for THIS child
 * (a sibling handset passes the student the Flow was opened for).
 */
async function retry(phone, { shareCodeId, studentId, code, active, language = 'en' }) {
  const lang = clampLanguage(language);
  if (!active || !code) {
    await WhatsAppService.sendMessage(phone, resolveUx('sqCodeExpired', { language: lang }));
    logEvent('student_quiz.retry_refused', { why: 'code_inactive', shareCodeId });
    return false;
  }
  const QuizSessionService = require('./quiz-session.service');
  // A class-link quiz running now lives in the video engine's own state;
  // starting another over it would overwrite that state mid-quiz.
  const VideoQuizService = require('./video-quiz.service');
  if (await QuizSessionService.getActiveState(phone) || await VideoQuizService.getActiveState(phone)) {
    await WhatsAppService.sendMessage(phone, resolveUx('sqInFlight', { language: lang }));
    logEvent('student_quiz.retry_refused', { why: 'in_flight', shareCodeId });
    return false;
  }
  const { data: sc } = await supabase.from('quiz_share_codes')
    .select('id, quiz_id, video_id, language, teacher_user_id').eq('id', shareCodeId).maybeSingle();
  const { data: st } = await supabase.from('students')
    .select('id, student_name, self_reported_class').eq('id', studentId).maybeSingle();
  if (!sc || !st) {
    await WhatsAppService.sendMessage(phone, resolveUx('sqCodeExpired', { language: lang }));
    return false;
  }
  const share = require('./video-quiz-share.service');
  await WhatsAppService.sendMessage(phone, resolveUx('sqRetryStarting', { language: lang }));
  await share.startForStudent(phone, {
    shareCodeId: sc.id, quizId: sc.quiz_id, videoId: sc.video_id, language: sc.language || lang,
  }, st);
  logEvent('student_quiz.retry_started', { shareCodeId, studentId });
  return true;
}

/** The class card for THIS child on THIS quiz, from the rows the report counts. */
async function sendCard(phone, { shareCodeId, studentId, language = 'en' }) {
  const lang = clampLanguage(language);
  const report = require('./video-quiz-report.service');
  const cls = await report.loadClassRows(shareCodeId);
  const mine = cls && cls.rows.find((r) => r.studentId === studentId);
  if (!cls || !mine) {
    await WhatsAppService.sendMessage(phone, resolveUx('sqNoCardYet', { language: lang }));
    logEvent('student_quiz.card_refused', { why: cls ? 'not_finished' : 'no_share_code', shareCodeId });
    return false;
  }
  try {
    const renderHtml = require('../../templates/video-quiz-leaderboard.template');
    const { htmlToImage } = require('../../utils/html-to-pdf');
    const html = renderHtml({
      topic: cls.shareCode.topic || '', subject: cls.subject || '', className: cls.className || '',
      language: cls.language || lang, rows: cls.rows, targetSessionId: mine.sessionId, mode: 'full',
    });
    const png = await htmlToImage(html, { width: 540, deviceScaleFactor: 2, selector: '.card' });
    const caption = resolveUx('vqClassCardCaption', { language: cls.language || lang, params: { topic: cls.shareCode.topic || '' } });
    const ok = await WhatsAppService.sendImageFromBuffer(phone, png, caption);
    logEvent('student_quiz.card_sent', { shareCodeId, studentId, ok: Boolean(ok) });
    return Boolean(ok);
  } catch (err) {
    logToFile('⚠️ student-quiz: card render/send failed', { error: err.message });
    await WhatsAppService.sendMessage(phone, resolveUx('sqNoCardYet', { language: lang }));
    return false;
  }
}

module.exports = {
  quizzesForHandset, open, handleButton, retry, sendCard, flowId,
  RETRY_ID, CARD_ID, FALLBACK_KEY, MAX_QUIZZES,
};
