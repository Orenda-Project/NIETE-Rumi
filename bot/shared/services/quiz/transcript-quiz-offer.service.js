'use strict';
/**
 * Transcript quiz — THE OFFER.
 *
 * After a self-coaching report lands, the teacher is asked once whether she
 * wants a quiz written from what she just taught. Once per TEACHER, not per
 * report (operator, 2026-09-05): the offer introduces the feature; after
 * that the path is /quiz. TRANSCRIPT_QUIZ_OFFER_MODE=every keeps the
 * alternative one env flip away.
 *
 * TIMING. The survey buttons go out ~90 s after the report. The offer is
 * queued for +240 s so it never competes with them, and the survey answer
 * itself brings it forward (triggerEarly) — whichever job runs first wins the
 * per-session claim, the other is a no-op.
 *
 * STATE lives in `quizzes` (quiz_source='transcript', one row per coaching
 * session, enforced by a unique partial index). The offer job claims the row
 * with status 'generating', digests, flips it to 'offered' and sends the
 * buttons; the buttons flip it to 'generating' (yes) or 'declined' (no)
 * exactly once, however many times they are tapped.
 *
 * FLAG-GATED, read at call time: TRANSCRIPT_QUIZ_ENABLED. With it unset a
 * develop merge changes nothing for teachers.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const FeatureIntro = require('../feature-intro.service');
const Digest = require('./transcript-quiz-digest.service');
const { quizLanguageFor, teacherLanguageFor, canonicalSubject, formatLessonDate, topicFor, lessonLabel,
  needsLanguageAsk, languageAskButtons } = require('./transcript-quiz-language');

const OFFER_YES = 'tq_yes_';
const OFFER_NO = 'tq_no_';
const BUTTON_RX = /^tq_(yes|no)_([0-9a-fA-F-]{36})$/;
const LANGUAGE_RX = /^tq_lang_(ur|en)_([0-9a-fA-F-]{36})$/;
const MIN_TRANSCRIPT_CHARS = 1500;
const OFFER_DELAY_SECONDS = 240;
const MIN_CONFIDENCE = 0.6;
const MIN_SLOS = 2;
/** The user_feature_first_use row that marks "this teacher has had the offer". */
const FEATURE_KEY = 'transcript_quiz';

const SESSION_SELECT = 'id, user_id, status, observation_type, transcript_text, transcript_language, '
  + 'analysis_data, lesson_plan_excerpt, created_at, '
  + 'users!inner(id, phone_number, preferred_language, first_name, last_name, grade, subject, grades_taught, subjects_taught)';

function enabled() {
  return process.env.TRANSCRIPT_QUIZ_ENABLED === 'true';
}

function offerMode() {
  return (process.env.TRANSCRIPT_QUIZ_OFFER_MODE || 'once').trim().toLowerCase() === 'every' ? 'every' : 'once';
}

function subjectAllowed(subject) {
  const raw = (process.env.TRANSCRIPT_QUIZ_SUBJECTS || '').trim();
  if (!raw) return true;
  const allow = new Set(raw.split(',').map((s) => canonicalSubject(s.trim())));
  return allow.has(canonicalSubject(subject));
}

function introVideo() {
  return (process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO || '').trim() || null;
}

async function alreadyOffered(userId) {
  if (!userId) return false;
  return FeatureIntro.hasSeenIntroVideo(userId, FEATURE_KEY);
}

// ─── 1. Schedule (called from the report generator, on the worker) ──────────

async function scheduleOffer({ coachingSessionId, userId, phone, language, transcriptChars = 0,
                               delaySeconds = OFFER_DELAY_SECONDS, source = 'self' }) {
  if (!enabled()) return false;
  if (!coachingSessionId || !userId || !phone) {
    logToFile('transcript quiz: schedule skipped, missing field', { coachingSessionId, userId, hasPhone: Boolean(phone) });
    return false;
  }
  if (transcriptChars < MIN_TRANSCRIPT_CHARS) {
    logEvent('transcript_quiz.skipped', { coachingSessionId, userId, reason: 'transcript_too_short', transcriptChars });
    return false;
  }
  if (offerMode() === 'once' && await alreadyOffered(userId)) {
    logEvent('transcript_quiz.skipped', { coachingSessionId, userId, reason: 'already_offered_once' });
    return false;
  }
  const SQSQueueService = require('../queue/sqs-queue.service');
  await SQSQueueService.queueJob(coachingSessionId, 'quiz_offer', {
    coachingSessionId, userId, phone, language, source,
  }, { delaySeconds });
  logEvent('transcript_quiz.offer_scheduled', { coachingSessionId, userId, delaySeconds, source });
  return true;
}

/** The survey answer brings the offer forward. Idempotent with the delayed job. */
async function triggerEarly(coachingSessionId) {
  if (!enabled() || !coachingSessionId) return false;
  try {
    const SQSQueueService = require('../queue/sqs-queue.service');
    await SQSQueueService.queueJob(coachingSessionId, 'quiz_offer', { coachingSessionId, early: true }, { delaySeconds: 0 });
    logEvent('transcript_quiz.offer_triggered_early', { coachingSessionId });
    return true;
  } catch (err) {
    logToFile('⚠️ transcript quiz: early trigger failed (non-fatal)', { coachingSessionId, error: err.message });
    return false;
  }
}

// ─── 2. Process (the worker) ─────────────────────────────────────────────────

/** INSERT is the claim. 23505 means another job got here first. */
async function claimRow({ session, source }) {
  const { data, error } = await supabase
    .from('quizzes')
    .insert({
      teacher_id: session.user_id,
      quiz_source: 'transcript',
      coaching_session_id: session.id,
      topic: session.analysis_data?.topic || 'Lesson',
      subject: session.analysis_data?.subject || null,
      status: 'generating',
      meta: { step: 'digest', source: source || 'offer', claimed_at: new Date().toISOString() },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { claimed: false };
    throw new Error(`transcript quiz: claim failed: ${error.message}`);
  }
  return { claimed: true, quizId: data.id };
}

async function markSkipped(quizId, reason, extra = {}) {
  await supabase.from('quizzes')
    .update({ status: 'skipped', meta: { step: 'skipped', skip_reason: reason, ...extra } })
    .eq('id', quizId);
}

async function processOffer(coachingSessionId, payload = {}) {
  if (!enabled()) return { skipped: 'disabled' };

  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select(SESSION_SELECT)
    .eq('id', coachingSessionId)
    .maybeSingle();
  if (error || !session) {
    logToFile('⚠️ transcript quiz: session not found for offer', { coachingSessionId, error: error?.message });
    return { skipped: 'session_not_found' };
  }
  if (session.observation_type) return { skipped: 'not_self_coaching' };
  if (session.status && session.status !== 'completed') return { skipped: `status_${session.status}` };
  const transcript = String(session.transcript_text || '');
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    logEvent('transcript_quiz.skipped', { coachingSessionId, reason: 'transcript_too_short' });
    return { skipped: 'transcript_too_short' };
  }
  const user = session.users || {};
  if (!payload.force && offerMode() === 'once' && await alreadyOffered(session.user_id)) {
    return { skipped: 'already_offered_once' };
  }

  const claim = await claimRow({ session, source: payload.source || 'offer' });
  if (!claim.claimed) {
    logEvent('transcript_quiz.offer_skipped', { coachingSessionId, reason: 'already_claimed' });
    return { skipped: 'already_claimed' };
  }
  const quizId = claim.quizId;

  let result;
  try {
    result = await Digest.run({ session, user });
  } catch (err) {
    logToFile('❌ transcript quiz: digest failed', { coachingSessionId, quizId, error: err.message }, 'error');
    await markSkipped(quizId, 'digest_failed', { error: err.message });
    return { skipped: 'digest_failed', quizId };
  }
  const { digest, grade, gradeSource, lpHint, model, costUsd } = result;

  if (digest.confidence < MIN_CONFIDENCE || digest.slos.length < MIN_SLOS || digest.language_of_instruction === 'unknown') {
    const reason = digest.confidence < MIN_CONFIDENCE ? 'low_confidence'
      : digest.slos.length < MIN_SLOS ? 'too_few_slos' : 'language_unknown';
    await markSkipped(quizId, reason, { digest, model, cost_usd: costUsd });
    logEvent('transcript_quiz.skipped', { coachingSessionId, quizId, reason, confidence: digest.confidence, slos: digest.slos.length });
    return { skipped: reason, quizId };
  }
  if (!subjectAllowed(digest.subject)) {
    await markSkipped(quizId, 'subject_not_allowed', { digest, subject: digest.subject });
    logEvent('transcript_quiz.skipped', { coachingSessionId, quizId, reason: 'subject_not_allowed', subject: digest.subject });
    return { skipped: 'subject_not_allowed', quizId };
  }

  const language = quizLanguageFor(digest.subject, session.transcript_language);
  const teacherLang = teacherLanguageFor({ preferredLanguage: user.preferred_language, transcriptLanguage: session.transcript_language });
  const topic = topicFor(digest, language);

  await supabase.from('quizzes').update({
    status: 'offered',
    topic: topic || 'Lesson',
    subject: digest.subject,
    language,
    grade: grade || null,
    meta: {
      step: 'offered', source: payload.source || 'offer',
      digest, grade, grade_source: gradeSource, lp_hint: lpHint,
      digest_model: model, cost_usd: costUsd || 0,
      teacher_language: teacherLang, offered_at: new Date().toISOString(),
    },
  }).eq('id', quizId);

  // The offer itself. Video header the first time (when a video is
  // configured), plain buttons after.
  const phone = payload.phone || user.phone_number;
  const params = {
    lesson: lessonLabel({ digest, quizLanguage: language, teacherLanguage: teacherLang }),
    date: formatLessonDate(session.created_at, teacherLang),
  };
  const body = resolveUx('tqOffer', { language: teacherLang, params });
  const buttons = [
    { id: `${OFFER_YES}${quizId}`, title: resolveUx('tqOfferYes', { language: teacherLang }) },
    { id: `${OFFER_NO}${quizId}`, title: resolveUx('tqOfferNo', { language: teacherLang }) },
  ];
  let sent = false;
  const video = introVideo();
  const seen = await alreadyOffered(session.user_id);
  if (video && !seen) {
    sent = await WhatsAppService.sendVideoWithButtons(phone, video, body, buttons);
    if (!sent) logToFile('⚠️ transcript quiz: video offer failed, sending plain buttons', { quizId });
  }
  if (!sent) sent = await WhatsAppService.sendInteractiveButtons(phone, { body, buttons });
  await FeatureIntro.markVideoShown(session.user_id, FEATURE_KEY);

  logEvent('transcript_quiz.offered', {
    coachingSessionId, quizId, userId: session.user_id, subject: digest.subject, language, teacherLang,
    withVideo: Boolean(video && !seen), sent: Boolean(sent), early: Boolean(payload.early),
  });
  return { ok: true, quizId };
}

// ─── 3. The buttons (on the web service) ─────────────────────────────────────

async function teacherFor(quiz) {
  const { data } = await supabase.from('users')
    .select('id, phone_number, preferred_language')
    .eq('id', quiz.teacher_id).maybeSingle();
  return data || {};
}

async function handleOfferButton(buttonId, phone) {
  const api = module.exports;
  const m = BUTTON_RX.exec(buttonId || '');
  if (!m) return false;
  const yes = m[1] === 'yes';
  const quizId = m[2];

  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, status, language, topic, meta, coaching_session_id')
    .eq('id', quizId).maybeSingle();
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqOfferExpired', { language: teacherLanguageFor({}) }));
    return true;
  }
  const teacher = await teacherFor(quiz);
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language || quiz.meta?.teacher_language, transcriptLanguage: quiz.language });

  if (!yes) {
    const { data: flipped } = await supabase.from('quizzes')
      .update({ status: 'declined', meta: { ...(quiz.meta || {}), step: 'declined', declined_at: new Date().toISOString() } })
      .eq('id', quizId).eq('status', 'offered').select('id');
    logEvent('transcript_quiz.declined', { quizId, userId: quiz.teacher_id, flipped: Boolean(flipped && flipped.length) });
    await WhatsAppService.sendMessage(phone, resolveUx('tqDeclined', { language: lang }));
    return true;
  }

  // The rule language is what she would have been handed silently in round 1.
  // It is now the first button, not the decision.
  const ruleLanguage = quiz.language || quizLanguageFor(quiz.subject, null);

  if (needsLanguageAsk(quiz.subject)) {
    // The row stays 'offered' until she answers, so an unanswered ask expires
    // exactly as an unanswered offer does.
    const { data: marked } = await supabase.from('quizzes')
      .update({
        meta: {
          ...(quiz.meta || {}), step: 'awaiting_language', awaiting_language: true,
          accepted_at: new Date().toISOString(), asked_language_at: new Date().toISOString(),
        },
      })
      .eq('id', quizId).eq('status', 'offered').select('id');
    if (!marked || !marked.length) return api.tellAlready(phone, quiz, lang);
    await api.sendLanguageAsk(quizId, phone, lang, ruleLanguage);
    logEvent('transcript_quiz.language_asked', { quizId, userId: quiz.teacher_id, ruleLanguage, from: 'offer' });
    return true;
  }

  return api.startGenerating({ quizId, quiz, phone, teacherLang: lang, language: ruleLanguage, source: 'offer' });
}

/** Tapped twice, or already sent. Never a second generation. */
async function tellAlready(phone, quiz, lang) {
  const done = ['sent', 'report_sent', 'ready'].includes(quiz.status);
  await WhatsAppService.sendMessage(phone, resolveUx(done ? 'tqAlreadySent' : 'tqAlreadyMaking', { language: lang }));
  return true;
}

/** The ask itself — shared with /quiz, which reaches the same decision. */
async function sendLanguageAsk(quizId, phone, teacherLang, ruleLanguage) {
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('tqAskLanguage', { language: teacherLang }),
    buttons: languageAskButtons(quizId, ruleLanguage),
  });
}

/**
 * offered → generating, once, with the language that will be written. The
 * atomic status filter is what makes a double tap a no-op.
 */
async function startGenerating({ quizId, quiz, phone, teacherLang, language, source }) {
  const api = module.exports;
  const { data: flipped } = await supabase.from('quizzes')
    .update({
      status: 'generating', language,
      meta: { ...(quiz.meta || {}), step: 'author', awaiting_language: false, language_choice: language, accepted_at: new Date().toISOString() },
    })
    .eq('id', quizId).eq('status', 'offered').select('id');
  if (!flipped || !flipped.length) return api.tellAlready(phone, quiz, teacherLang);

  const SQSQueueService = require('../queue/sqs-queue.service');
  await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: teacherLang }, { delaySeconds: 0 });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: teacherLang }));
  logEvent('transcript_quiz.accepted', { quizId, userId: quiz.teacher_id, language, source });
  return true;
}

/**
 * Her answer to the ask. The language she chose is written to `quizzes.language`
 * — the generate step reads that ahead of the subject rule — and the same
 * atomic flip guards a double tap.
 */
async function handleLanguageButton(buttonId, phone, user) {
  const api = module.exports;
  const m = LANGUAGE_RX.exec(buttonId || '');
  if (!m) return false;
  const language = m[1];
  const quizId = m[2];

  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, status, language, subject, topic, meta, coaching_session_id')
    .eq('id', quizId).maybeSingle();
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqOfferExpired', { language: teacherLanguageFor({ preferredLanguage: user?.preferred_language }) }));
    return true;
  }
  const teacher = await teacherFor(quiz);
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language || user?.preferred_language });
  logEvent('transcript_quiz.language_chosen', { quizId, userId: quiz.teacher_id, language });
  return api.startGenerating({ quizId, quiz, phone, teacherLang: lang, language, source: 'ask' });
}

module.exports = {
  enabled, offerMode, subjectAllowed, alreadyOffered, introVideo,
  scheduleOffer, triggerEarly, processOffer, handleOfferButton, handleLanguageButton, claimRow,
  sendLanguageAsk, startGenerating, tellAlready,
  OFFER_YES, OFFER_NO, MIN_TRANSCRIPT_CHARS, OFFER_DELAY_SECONDS, MIN_CONFIDENCE, MIN_SLOS, FEATURE_KEY, SESSION_SELECT,
};
