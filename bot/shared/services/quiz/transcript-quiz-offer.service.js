'use strict';
/**
 * Transcript quiz — THE OFFER.
 *
 * After a self-coaching report lands, the teacher is asked once whether they
 * want a quiz written from what they just taught. Once per TEACHER, not per
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
const Funnel = require('./quiz-funnel');
const { quizLanguageFor, teacherLanguageFor, canonicalSubject, formatLessonDate, topicFor, lessonLabel,
  needsLanguageAsk, languageAskButtons, languageAskBody } = require('./transcript-quiz-language');
const {
  LP_V8, lpRemakeable, failureReasonOf, digestFailureReason,
} = require('./quiz-sources');

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

// Only columns the users table still has. `grade` was dropped by migration V1.4.5
// (15 Sep 2026) while this join still asked for it: PostgREST refused the whole
// read and every quiz offer failed as "session not found" for seven hours. The
// digest reads grades_taught / subjects_taught; nothing read grade or subject.
const SESSION_SELECT = 'id, user_id, status, observation_type, transcript_text, transcript_language, '
  + 'analysis_data, lesson_plan_excerpt, created_at, '
  + 'users!inner(name, id, phone_number, preferred_language, grades_taught, subjects_taught)';

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

/**
 * Explicit map (not a computed `process.env[...]`) so
 * tests/setup/env-template-completeness.test.js and a plain grep can both see
 * the two per-language names.
 */
const INTRO_VIDEO_BY_LANGUAGE = {
  ur: () => process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_UR,
  en: () => process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_EN,
};

/** Per-language film first, the shared one second, null when neither is set. */
function introVideo(language) {
  const shared = (process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO || '').trim() || null;
  const perLanguage = INTRO_VIDEO_BY_LANGUAGE[language];
  if (!perLanguage) return shared;
  return (perLanguage() || '').trim() || shared;
}

/** How many offers carry the film, per teacher. 0 is legitimate ("never"); anything else unreadable defaults to 2. */
function introVideoShows() {
  const raw = (process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS || '').trim();
  if (raw === '') return 2;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? 2 : n;
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
    // Named for what happened, like the generate step's digest failure: a
    // transcript digest has no source-side throw (the length was checked above),
    // so this is the model or the provider — `digest_failed` said neither. The
    // teacher was never offered this quiz, so nothing is sent to them; /quiz can
    // still make it from the same session.
    const reason = digestFailureReason(err);
    logToFile('❌ transcript quiz: digest failed', { coachingSessionId, quizId, reason, code: err.code || null, error: err.message }, 'error');
    await markSkipped(quizId, reason, { error: err.message });
    logEvent('transcript_quiz.skipped', { coachingSessionId, quizId, reason, step: 'digest' });
    return { skipped: reason, quizId };
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
  const teacherLang = teacherLanguageFor({ preferredLanguage: user.preferred_language });
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

  // The offer itself. Video header while the teacher's showing count is under
  // TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS (default 2), plain buttons after.
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
  const video = introVideo(teacherLang);
  // The gate is the showing COUNT now, not `alreadyOffered` — `seen` is true
  // for any prior offer row, which made a second showing impossible even
  // under TRANSCRIPT_QUIZ_OFFER_MODE=every. This is the D7 fix.
  const shownCount = video ? await FeatureIntro.introShownCount(session.user_id, FEATURE_KEY) : 0;
  const wantVideo = Boolean(video) && shownCount < introVideoShows();
  let videoSent = false;
  let sent = false;
  if (wantVideo) {
    videoSent = await WhatsAppService.sendVideoWithButtons(phone, video, body, buttons);
    if (!videoSent) logToFile('⚠️ transcript quiz: video offer failed, sending plain buttons', { quizId });
    sent = videoSent;
  }
  if (!sent) sent = await WhatsAppService.sendInteractiveButtons(phone, { body, buttons });
  await FeatureIntro.markVideoShown(session.user_id, FEATURE_KEY, { incrementIntroCount: Boolean(videoSent) });

  logEvent('transcript_quiz.offered', {
    coachingSessionId, quizId, userId: session.user_id, subject: digest.subject, language, teacherLang,
    withVideo: Boolean(videoSent), shownCount, sent: Boolean(sent), early: Boolean(payload.early),
  });
  // Counted whether or not WhatsApp took it: an offer that never arrived is a
  // failure to see, not an offer that never happened.
  Funnel.emit('offer_made', {
    quiz_id: quizId, teacher_id: session.user_id, source: 'transcript',
    channel: Funnel.channelOf(payload.source || 'offer'), delivered: Boolean(sent),
  });
  return { ok: true, quizId };
}

// ─── 3. The buttons (on the web service) ─────────────────────────────────────

/**
 * The teacher's language when the quiz row is gone: there is nothing to join
 * on, so the teacher is looked up by the number they just tapped from.
 * Without this the one surface a teacher meets when an offer has expired
 * answers in the floor language rather than theirs.
 */
async function languageByPhone(phone) {
  const { data } = await supabase.from('users')
    .select('preferred_language').eq('phone_number', phone).maybeSingle();
  return teacherLanguageFor({ preferredLanguage: data?.preferred_language });
}

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
    .select('id, teacher_id, status, language, subject, topic, meta, coaching_session_id')
    .eq('id', quizId).maybeSingle();
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqOfferExpired', { language: await api.languageByPhone(phone) }));
    return true;
  }
  const teacher = await teacherFor(quiz);
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language });
  // These buttons only ever ride the coaching offer, so the stream is transcript.
  Funnel.emit('offer_answered', {
    quiz_id: quizId, teacher_id: quiz.teacher_id, source: 'transcript',
    channel: Funnel.channelOf(quiz.meta && quiz.meta.source), choice: yes ? 'yes' : 'no',
  });

  if (!yes) {
    const { data: flipped } = await supabase.from('quizzes')
      .update({ status: 'declined', meta: { ...(quiz.meta || {}), step: 'declined', declined_at: new Date().toISOString() } })
      .eq('id', quizId).eq('status', 'offered').select('id');
    logEvent('transcript_quiz.declined', { quizId, userId: quiz.teacher_id, flipped: Boolean(flipped && flipped.length) });
    await WhatsAppService.sendMessage(phone, resolveUx('tqDeclined', { language: lang }));
    return true;
  }

  // The rule language is what the teacher would have been handed silently in
  // round 1. It is now the first button, not the decision.
  const ruleLanguage = quiz.language || quizLanguageFor(quiz.subject, null);

  if (needsLanguageAsk(quiz.subject)) {
    // The row stays 'offered' until they answer, so an unanswered ask expires
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
    await api.sendLanguageAsk(quizId, phone, lang, ruleLanguage, {
      digest: quiz.meta && quiz.meta.digest, subject: quiz.subject,
    });
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

/**
 * The ask itself — shared with /quiz and the lesson-plan offer, which reach the
 * same decision. `lesson` ({digest, subject}) is what its examples of English
 * terms are taken from; a caller that knows neither gets an ask naming none,
 * never another subject's.
 */
async function sendLanguageAsk(quizId, phone, teacherLang, ruleLanguage, lesson = {}) {
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: languageAskBody(lesson, teacherLang),
    buttons: languageAskButtons(quizId, ruleLanguage),
  });
}

/**
 * offered → generating, once, with the language that will be written. The
 * atomic status filter is what makes a double tap a no-op.
 */
async function startGenerating({ quizId, quiz, phone, teacherLang, language, source }) {
  const api = module.exports;
  // The label follows the language the teacher CHOSE, not the rule language the
  // offer was written under: an Urdu-taught maths lesson quizzed in English is
  // labelled "Least Common Multiple (LCM)", not "ایل سی ایم", on the row, in the
  // student message and in every later /quiz listing. A row without a digest
  // (legacy) keeps the label it has.
  const topic = topicFor(quiz.meta && quiz.meta.digest, language) || quiz.topic || 'Lesson';
  // An LP-born quiz reaches here with no digest yet (the author digests the
  // planned lesson first), so its next step is the digest, not the author.
  const next = quiz.meta && quiz.meta.digest ? 'author' : 'digest';
  const { data: flipped } = await supabase.from('quizzes')
    .update({
      status: 'generating', language, topic,
      meta: { ...(quiz.meta || {}), step: next, awaiting_language: false, language_choice: language, accepted_at: new Date().toISOString() },
    })
    .eq('id', quizId).eq('status', 'offered').select('id');
  if (!flipped || !flipped.length) return api.tellAlready(phone, quiz, teacherLang);

  // Committed: the ONE accepted for a quiz whose yes had to wait for its
  // language (the coaching offer, /quiz, the lesson-plan offer all land here).
  Funnel.emit('accepted', {
    quiz_id: quizId, teacher_id: quiz.teacher_id, nudge_id: quiz.meta && quiz.meta.nudge_id,
    source: quiz.quiz_source || 'transcript', channel: Funnel.channelOf(quiz.meta && quiz.meta.source),
  });

  if (quiz.quiz_source === LP_V8) {
    // The ask on the 15:00 LP offer (lp-quiz-offer): queued and announced by
    // the same step a yes with no ask goes through.
    await api.queueLpQuiz({ quizId, nudgeId: quiz.meta && quiz.meta.nudge_id, phone, language: teacherLang });
    logEvent('transcript_quiz.accepted', { quizId, userId: quiz.teacher_id, language, source, quiz_source: LP_V8 });
    return true;
  }

  const SQSQueueService = require('../queue/sqs-queue.service');
  await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: teacherLang }, { delaySeconds: 0 });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: teacherLang }));
  logEvent('transcript_quiz.accepted', { quizId, userId: quiz.teacher_id, language, source });
  return true;
}

/**
 * Queue the author for an LP-born (lp_v8) quiz and tell the teacher it is
 * coming — or, when the queue refuses, fail the quiz and say so. The ONE place
 * an lp_v8 quiz is queued: lp-quiz-offer's yes on an Urdu or Islamiyat lesson
 * calls it, and so does startGenerating when the teacher answers the language
 * ask on any other lesson, so the two can never queue a different job.
 *
 * @returns {Promise<boolean>} true when the job was queued
 */
async function queueLpQuiz({ quizId, nudgeId, phone, language }) {
  const say = async (key) => {
    const ok = await WhatsAppService.sendMessage(phone, resolveUx(key, { language }));
    if (!ok) logToFile('❌ lp quiz offer: reply not delivered', { key }, 'error');
  };
  try {
    const SQSQueueService = require('../queue/sqs-queue.service');
    await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, source: 'lp_offer' }, { delaySeconds: 0 });
  } catch (err) {
    logToFile('❌ lp quiz offer: quiz_generate could not be queued', { quizId, nudgeId, error: err.message }, 'error');
    // MERGED into the row's meta, never a fresh object: the lessons, the class
    // and the lesson date are what the quiz is written from and dated by. A
    // failure that replaced them left a row /quiz could not date and nobody
    // could ever make again.
    const { data: current, error: readErr } = await supabase.from('quizzes')
      .select('meta').eq('id', quizId).maybeSingle();
    if (readErr) {
      logToFile('❌ lp quiz offer: could not read the quiz before marking it failed', { quizId, error: readErr.message }, 'error');
    }
    const meta = (current && current.meta) || {};
    const { error } = await supabase.from('quizzes')
      .update({
        status: 'failed',
        meta: {
          ...meta,
          step: 'failed',
          error: 'queue_failed',
          error_detail: `queue: ${err.message}`,
          source: meta.source || 'lp_offer',
          nudge_id: meta.nudge_id || nudgeId || null,
          failed_at: new Date().toISOString(),
        },
      })
      .eq('id', quizId);
    if (error) logToFile('❌ lp quiz offer: could not mark the quiz failed', { quizId, error: error.message }, 'error');
    Funnel.emit('generation_failed', {
      quiz_id: quizId, nudge_id: meta.nudge_id || nudgeId, source: LP_V8,
      channel: Funnel.channelOf(meta.source || 'lp_offer'), reason: 'queue_failed',
    });
    await say('lpQuizCouldNotStart');
    return false;
  }
  await say('lpQuizMaking');
  return true;
}

/**
 * "Make it again" on a FAILED lp_v8 quiz (the /quiz Flow). failed → generating,
 * once, then the same queue step every lp_v8 quiz goes through.
 *
 * Safe to re-queue: the generate step only runs a row in generating / ready /
 * offered, and every failure write it makes keeps `meta` (the lessons, the
 * class, the lesson date), so the remake reads what the first attempt read.
 * The atomic `status = failed` filter is what makes a double submit a no-op —
 * nothing below de-duplicates a quiz_generate job (its FIFO id is per call).
 * A digest the first attempt already wrote is kept, so a quiz that failed at
 * authoring goes straight back to authoring. The failure it replaces is kept as
 * `previous_error`; `error` is cleared so no surface reads a stale reason off a
 * row that is being made.
 *
 * @returns {Promise<boolean>} true when the remake was queued
 */
async function remakeLpQuiz({ quiz, phone, teacherLang, source = 'flow' }) {
  const api = module.exports;
  const meta = quiz.meta || {};
  if (quiz.quiz_source !== LP_V8 || !lpRemakeable(meta)) {
    logEvent('transcript_quiz.remake_refused', { quizId: quiz.id, reason: failureReasonOf(meta), remakes: meta.remakes || 0 });
    return false;
  }
  const { error: _error, error_detail: _detail, ...kept } = meta;
  const { data: flipped, error } = await supabase.from('quizzes')
    .update({
      status: 'generating',
      meta: {
        ...kept,
        step: kept.digest ? 'author' : 'digest',
        remakes: (Number(meta.remakes) || 0) + 1,
        previous_error: meta.error || null,
        remade_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
        remake_source: source,
      },
    })
    .eq('id', quiz.id).eq('status', 'failed').select('id');
  if (error) {
    logToFile('❌ lp quiz remake: the failed row could not be claimed', { quizId: quiz.id, error: error.message }, 'error');
    return false;
  }
  if (!flipped || !flipped.length) {
    await api.tellAlready(phone, quiz, teacherLang);
    return false;
  }
  logEvent('transcript_quiz.remade', {
    quizId: quiz.id, userId: quiz.teacher_id, previousError: meta.error || null,
    remakes: (Number(meta.remakes) || 0) + 1, source, quiz_source: LP_V8,
  });
  Funnel.emit('accepted', {
    quiz_id: quiz.id, teacher_id: quiz.teacher_id, nudge_id: meta.nudge_id, source: LP_V8, channel: 'remake',
  });
  return api.queueLpQuiz({ quizId: quiz.id, nudgeId: meta.nudge_id, phone, language: teacherLang });
}

/**
 * The teacher's answer to the ask. The language they chose is written to
 * `quizzes.language` — the generate step reads that ahead of the subject
 * rule — and the same atomic flip guards a double tap.
 */
async function handleLanguageButton(buttonId, phone, user) {
  const api = module.exports;
  const m = LANGUAGE_RX.exec(buttonId || '');
  if (!m) return false;
  const language = m[1];
  const quizId = m[2];

  // quiz_source: the same ask answers an LP-born quiz, which startGenerating
  // hands back to the LP offer to queue.
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, status, language, subject, topic, meta, coaching_session_id, quiz_source')
    .eq('id', quizId).maybeSingle();
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqOfferExpired', {
      language: user?.preferred_language ? teacherLanguageFor({ preferredLanguage: user.preferred_language }) : await api.languageByPhone(phone),
    }));
    return true;
  }
  const teacher = await teacherFor(quiz);
  const lang = teacherLanguageFor({ preferredLanguage: teacher.preferred_language || user?.preferred_language });
  logEvent('transcript_quiz.language_chosen', { quizId, userId: quiz.teacher_id, language });
  return api.startGenerating({ quizId, quiz, phone, teacherLang: lang, language, source: 'ask' });
}

module.exports = {
  enabled, offerMode, subjectAllowed, alreadyOffered, introVideo, introVideoShows,
  scheduleOffer, triggerEarly, processOffer, handleOfferButton, handleLanguageButton, claimRow, languageByPhone,
  sendLanguageAsk, startGenerating, tellAlready, queueLpQuiz, remakeLpQuiz,
  OFFER_YES, OFFER_NO, MIN_TRANSCRIPT_CHARS, OFFER_DELAY_SECONDS, MIN_CONFIDENCE, MIN_SLOS, FEATURE_KEY, SESSION_SELECT,
};
