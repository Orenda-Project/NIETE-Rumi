'use strict';
/**
 * /quiz lesson provider — the RECORDED lessons (self-coaching sessions whose
 * transcript can carry a quiz), and the tap that makes, resends or reports one.
 *
 * Moved out of transcript-quiz-list.service unchanged so the provider registry
 * (quiz-lesson-providers) can hold it without requiring the list service — a
 * require cycle the circular-deps guard refuses. The list service imports and
 * re-exports every function here under its old name, so no caller changed.
 *
 * Its rows keep their historical ids (`tq_pick_<sessionId>`; the Flow key is the
 * session id): WhatsApp keeps an old list row tappable forever.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { normaliseTopic } = require('./transcript-quiz-rows');
const { teacherLanguageFor, formatLessonDate, quizLanguageFor, needsLanguageAsk } = require('./transcript-quiz-language');
const { MIN_TRANSCRIPT_CHARS, sendLanguageAsk } = require('./transcript-quiz-offer.service');
const { isSelfTest } = require('./teacher-self-test');
const { oneAttemptPerChild } = require('./one-attempt-per-child');
const { TRANSCRIPT } = require('./quiz-sources');
const Funnel = require('./quiz-funnel');

const LINK_PREFIX = 'tq_link_';
const REPORT_PREFIX = 'tq_report_';
const BACK_PREFIX = 'tq_back_';
const CHUNK = 25;                // sessions fetched per DB round-trip
const MAX_FETCHES = 8;           // never scan more than 200 sessions for one /quiz

/**
 * PLAN_R5 §1 D8 — `teacherUserId`, when passed, drops the teacher's own
 * self-test row from both counts. Deliberately filtered in JS, not with a
 * Postgres `.neq('user_id', teacherUserId)`: `user_id != X` evaluates to NULL
 * (not true) for every row where `user_id IS NULL`, so that filter would
 * drop every real child along with it.
 */
async function countsFor(quizIds, teacherUserId = null) {
  const counts = new Map();
  if (!quizIds.length) return counts;
  const { data } = await supabase.from('quiz_sessions')
    .select('quiz_id, status, user_id, student_id, completed_at, created_at')
    .in('quiz_id', quizIds).is('invited_by_student_id', null);
  // One attempt per child, per quiz — the class report's rule: a child who
  // re-opened the link (a retake, or after typing STOP) is one child, counted
  // finished if any attempt finished. The same child on another quiz is a
  // child of that quiz too.
  const byQuiz = new Map();
  (data || [])
    .filter((s) => !isSelfTest(s, teacherUserId))
    .forEach((s) => byQuiz.set(s.quiz_id, [...(byQuiz.get(s.quiz_id) || []), s]));
  byQuiz.forEach((rows, quizId) => {
    const children = oneAttemptPerChild(rows);
    counts.set(quizId, {
      started: children.length,
      finished: children.filter((s) => s.status === 'completed').length,
    });
  });
  return counts;
}

/**
 * Load enough of the teacher's eligible sessions (transcript long enough to
 * quiz) to answer for `needed` of them, fetching in CHUNK-sized round-trips
 * rather than one `.limit(25)` that could never see lesson 26 onward.
 * Returns `{ sessions, exhausted }` — `sessions` holds only the eligible
 * ones found so far; `exhausted` is true once a short batch shows the table
 * has no more rows. Never scans more than `MAX_FETCHES * CHUNK` sessions for
 * one /quiz — a runaway teacher history cannot loop this forever.
 */
async function loadEligibleSessions(userId, needed) {
  let sessions = [];
  let exhausted = false;
  for (let fetch = 0; fetch < MAX_FETCHES; fetch += 1) {
    const offset = fetch * CHUNK;
    const { data } = await supabase.from('coaching_sessions')
      .select('id, created_at, transcript_text, analysis_data')
      .eq('user_id', userId)
      .is('observation_type', null)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .range(offset, offset + CHUNK - 1);
    const batch = data || [];
    const eligible = batch.filter((s) => String(s.transcript_text || '').length >= MIN_TRANSCRIPT_CHARS);
    sessions = sessions.concat(eligible);
    if (batch.length < CHUNK) { exhausted = true; break; }
    if (sessions.length >= needed) break;
  }
  return { sessions, exhausted };
}

async function enqueueGenerate(quizId, phone, lang, source = 'list', quizSource = TRANSCRIPT) {
  const SQSQueueService = require('../queue');
  await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: lang, source }, { delaySeconds: 0 });
  // Every /quiz path that makes a quiz queues it here — the list, the Flow, a retry.
  Funnel.emit('accepted', { quiz_id: quizId, source: quizSource, channel: Funnel.channelOf(source) });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: lang }));
}

/**
 * Claim a lesson for generation — the ONE place a menu turns "make this one"
 * into a `generating` quizzes row, whether the tap came from the list message
 * or from the /quiz Flow. It is called only once the quiz language is settled
 * (by the subject rule, or by the teacher answering the ask); the paths that
 * still have to ASK keep their own `offered` write above.
 *
 * Returns `{ quizId, from }` or `{ error }` — never throws, never sends.
 */
async function claimForGeneration({ userId, sessionId, session, quiz, quizLanguage, source = 'list' }) {
  if (quiz) {
    await supabase.from('quizzes')
      .update({
        status: 'generating', language: quizLanguage,
        meta: {
          ...(quiz.meta || {}), step: quiz.meta?.digest ? 'author' : 'digest',
          awaiting_language: false, source, retried_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
        },
      })
      .eq('id', quiz.id);
    return { quizId: quiz.id, from: quiz.status };
  }
  const { data: created, error } = await supabase.from('quizzes').insert({
    teacher_id: userId, quiz_source: TRANSCRIPT, coaching_session_id: sessionId,
    topic: session?.analysis_data?.topic || 'Lesson', subject: session?.analysis_data?.subject || null,
    language: quizLanguage,
    status: 'generating',
    meta: {
      step: 'digest', awaiting_language: false, source, claimed_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
    },
  }).select('id').single();
  if (error || !created) {
    logToFile('⚠️ transcript quiz: list claim failed', { sessionId, error: error?.message });
    return { error: error?.message || 'claim failed' };
  }
  return { quizId: created.id, from: 'none' };
}

/**
 * A recorded lesson tapped in /quiz (list message) or chosen on the Flow's
 * lesson screen (`quizLanguage` set): make its quiz, resend its link, or say
 * where it stands. The transcript provider's `start`.
 */
async function startTranscriptLesson(user, sessionId, { phone, quizLanguage = null, via = 'list' } = {}) {
  const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  if (quizLanguage) return makeTranscriptQuizIn(user, sessionId, { phone, quizLanguage, via, lang });
  if (!user?.id) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: session } = await supabase.from('coaching_sessions')
    .select('id, user_id, created_at, transcript_text, transcript_language, analysis_data')
    .eq('id', sessionId).eq('user_id', user.id).maybeSingle();
  if (!session) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, status, topic, subject, language, meta, coaching_session_id')
    .eq('coaching_session_id', sessionId).eq('quiz_source', TRANSCRIPT).maybeSingle();

  // The quiz language is the teacher's to choose here too — a lesson picked from /quiz
  // reaches exactly the same decision as a "yes" on the offer. The subject
  // rule seeds the button order; only Urdu and Islamiyat skip the ask.
  const subject = quiz?.subject || session.analysis_data?.subject || null;
  const ruleLanguage = quiz?.language || quizLanguageFor(subject, session.transcript_language);
  const ask = needsLanguageAsk(subject);

  if (!quiz) {
    if (ask) {
      const { data: created, error } = await supabase.from('quizzes').insert({
        teacher_id: user.id, quiz_source: TRANSCRIPT, coaching_session_id: sessionId,
        topic: session.analysis_data?.topic || 'Lesson', subject: session.analysis_data?.subject || null,
        language: null,
        status: 'offered',
        meta: {
          step: 'awaiting_language', awaiting_language: true,
          source: 'list', claimed_at: new Date().toISOString(),
        },
      }).select('id').single();
      if (error || !created) {
        logToFile('⚠️ transcript quiz: list claim failed', { sessionId, error: error?.message });
        await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
        return true;
      }
      // No digest yet on a lesson that never had a quiz: the subject's examples.
      await sendLanguageAsk(created.id, phone, lang, ruleLanguage, { subject });
      logEvent('transcript_quiz.language_asked', { userId: user.id, quizId: created.id, ruleLanguage, from: 'list' });
      return true;
    }
    const claimed = await claimForGeneration({
      userId: user.id, sessionId, session, quiz: null, quizLanguage: ruleLanguage,
    });
    if (claimed.error) {
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    }
    await enqueueGenerate(claimed.quizId, phone, lang);
    logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: claimed.quizId, from: 'none' });
    return true;
  }

  switch (quiz.status) {
    case 'generating':
    case 'ready':
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    case 'sent':
    case 'report_sent': {
      const counts = await countsFor([quiz.id], user.id);
      const c = counts.get(quiz.id) || { started: 0, finished: 0 };
      // Named for what they DO. "Report now" read as "show me the one I have";
      // this button refetches every session and recomputes (operator, item 8).
      // The third button exists because a tap into a lesson was otherwise a
      // dead end — the teacher had to type /quiz again to get back to the menu.
      await WhatsAppService.sendInteractiveButtons(phone, {
        body: resolveUx('tqQuizStatus', {
          language: lang,
          params: {
            topic: normaliseTopic(quiz.topic || session.analysis_data?.topic || ''),
            date: formatLessonDate(session.created_at, lang),
            started: c.started, finished: c.finished,
          },
        }),
        buttons: [
          { id: `${LINK_PREFIX}${quiz.id}`, title: resolveUx('tqLinkButton', { language: lang }) },
          { id: `${REPORT_PREFIX}${quiz.id}`, title: resolveUx('tqReportButton', { language: lang }) },
          { id: `${BACK_PREFIX}${quiz.id}`, title: resolveUx('tqBackButton', { language: lang }) },
        ],
      });
      return true;
    }
    default: {
      // offered / declined / skipped / failed / cancelled → (re)make it, after
      // the language ask where the subject leaves a real choice.
      if (ask) {
        await supabase.from('quizzes')
          .update({
            status: 'offered',
            meta: {
              ...(quiz.meta || {}), step: 'awaiting_language', awaiting_language: true,
              source: 'list', retried_at: new Date().toISOString(),
            },
          })
          .eq('id', quiz.id);
        await sendLanguageAsk(quiz.id, phone, lang, ruleLanguage, { digest: quiz.meta?.digest, subject });
        logEvent('transcript_quiz.language_asked', { userId: user.id, quizId: quiz.id, ruleLanguage, from: 'list' });
        return true;
      }
      const claimed = await claimForGeneration({
        userId: user.id, sessionId, session, quiz, quizLanguage: ruleLanguage,
      });
      await enqueueGenerate(quiz.id, phone, lang);
      logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: quiz.id, from: claimed.from });
      return true;
    }
  }
}

/**
 * The Flow's "Make it in <language>" on a recorded lesson: the language is
 * chosen, so no ask — claim the row and queue it (claimForGeneration +
 * enqueueGenerate, exactly as the Flow did inline).
 */
async function makeTranscriptQuizIn(user, sessionId, { phone, quizLanguage, via, lang }) {
  if (!user?.id) return { outcome: 'not_found' };
  const { data: session } = await supabase.from('coaching_sessions')
    .select('id, user_id, created_at, transcript_text, transcript_language, analysis_data')
    .eq('id', sessionId).eq('user_id', user.id).maybeSingle();
  if (!session) return { outcome: 'not_found' };
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, status, topic, subject, language, meta, coaching_session_id')
    .eq('coaching_session_id', sessionId).eq('quiz_source', TRANSCRIPT).maybeSingle();
  const claimed = await claimForGeneration({
    userId: user.id, sessionId, session, quiz: quiz || null, quizLanguage, source: via,
  });
  if (claimed.error) return { outcome: 'claim_failed' };
  await enqueueGenerate(claimed.quizId, phone, lang, via);
  logEvent('transcript_quiz.list_generate', {
    userId: user.id, quizId: claimed.quizId, from: claimed.from, source: via, language: quizLanguage,
  });
  return { outcome: 'queued', quizId: claimed.quizId };
}

/** The registry entry (quiz-lesson-providers): source, label, list, start. */
const TranscriptProvider = {
  source: TRANSCRIPT,
  labelKey: 'tqRowFromTranscript',
  async list(teacherId, { limit = 20 } = {}) {
    const { sessions } = await loadEligibleSessions(teacherId, limit);
    return sessions.map((s) => ({
      source: TRANSCRIPT,
      lessonRef: s.id,
      date: s.created_at,
      grade: null,
      subject: (s.analysis_data && s.analysis_data.subject) || null,
      topic: (s.analysis_data && s.analysis_data.topic) || null,
      session: s,
    }));
  },
  start(teacher, lessonRef, ctx = {}) {
    return startTranscriptLesson(teacher, lessonRef, ctx);
  },
};

module.exports = {
  ...TranscriptProvider,
  TranscriptProvider,
  countsFor, loadEligibleSessions, enqueueGenerate, claimForGeneration, startTranscriptLesson,
  LINK_PREFIX, REPORT_PREFIX, BACK_PREFIX,
};
