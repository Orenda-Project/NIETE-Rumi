'use strict';
/**
 * bd-2308/2309 — VideoQuizService: offer a quiz after a video, then run it.
 *
 * FLOW
 *   teacher picks a video -> video delivered -> 3 s pause -> "want the quiz?"
 *   -> yes -> 15 questions, one at a time, each with per-answer feedback
 *   -> finish -> survey covering the video AND the quiz
 *   -> optionally: share it with their class (see video-quiz-share.service.js)
 *
 * WHY A SEPARATE SERVICE FROM quiz-session.service.js
 * The parent quiz is adaptive: it picks the next question by difficulty from a
 * generated bank of 3-option text MCQs. A video quiz is a FIXED 15-question
 * walk through a curated bank with audio, pictures, grids and Flows. Bolting
 * the media renderer and the fixed walk onto the adaptive loop would have made
 * one service serve two different pedagogies. They share the TABLES — quizzes,
 * quiz_questions, quiz_sessions, quiz_answers — and therefore share the report
 * machinery, which is where the reuse actually pays.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const render = require('./video-quiz-render.service');
const sender = require('./video-quiz-sender.service');
// bd-2681 — sender.sendPhase() already throttles every message it sends, but
// this file makes two DIRECT WhatsAppService calls of its own (the "Here we
// go" opener below and "Question N of M" in sendNextQuestion) that bypassed
// the throttle entirely. Meta's per-recipient rate limit counts every send
// regardless of which code path made it, so those two "side door" sends
// still spent the recipient's real budget while the throttle's own window
// never learned about them — a real production incident (phone ending 6989,
// 2026-08-13, 80 minutes after bd-2666 shipped) hit exactly this gap.
const rateLimiter = require('./video-quiz-rate-limiter.service');
const { resolveUx } = require('../../config/ux-strings');

// Chrome a CHILD reads around the questions, in the quiz language.
const ux = (key, language, params) => resolveUx(key, { language, params });

const QUESTIONS_PER_SESSION = 15;
const OFFER_DELAY_MS = 3000;          // operator spec: 3 s after the video
const STATE_TTL_SECS = 24 * 60 * 60;
const OFFER_TTL_SECS = 60 * 60;

// bd-2477: a WhatsApp per-recipient-pair rate limit (#131056) hit mid-session
// on 2026-08-03 (confirmed via Axiom — 8x whatsapp.message.failed in the same
// session window). The old pickerFailed branch skipped the question and
// recursed into the next one with ZERO delay, so every remaining question in
// the session failed the same way within milliseconds — a 15-question quiz
// silently completed at 10. A short backoff gives a transient rate limit a
// chance to clear; the cap stops the quiz from hammering a limit that isn't
// clearing, and ends gracefully instead of cascading through every slot.
const SEND_FAILURE_BACKOFF_MS = 2500;
const MAX_CONSECUTIVE_SEND_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);
const STATE_KEY = (phone) => `videoquiz:${stripPlus(phone)}:active`;
const OFFER_KEY = (phone) => `videoquiz:${stripPlus(phone)}:offer`;

// A per-recipient send throttle (video-quiz-rate-limiter.
// service.js) can back a single handleAnswer up for minutes, so overlapping
// taps on ONE phone (a concurrent answer to a different question, a Flow
// submission racing a button tap) used to interleave inside that answer-phase
// send, each reading the same stale `state.index` and each writing an
// increment on top of it — a lost update. This lock serialises the whole
// answer path per phone; see acquireAnswerLock/handleAnswer/handleMultiAnswer.
const ANSWER_LOCK_KEY = (phone) => `videoquiz:${stripPlus(phone)}:answerlock`;
// Poll budget while WAITING for someone else's lock, not the lock's own TTL.
const ANSWER_LOCK_WAIT_MS = 30 * 1000;
const ANSWER_LOCK_STEP_MS = 250;
// The lock must outlive the worst realistic single handleAnswer/
// handleMultiAnswer run, so a crashed handler can't wedge a phone forever,
// and comfortably outlive a legitimate slow one so it is never torn down
// mid-send. Worst case inside the critical section: one
// rateLimiter.throttle() wait for the FULL per-recipient window
// (rateLimiter.WINDOW_MS, 5 min) during the answer-phase send, plus that
// phase's own pacing (up to 4 messages — verdict, explanation image,
// explanation audio — each gapped by sender.GAP_MEDIA_MS), plus
// sendNextQuestion's own retry ceiling (MAX_CONSECUTIVE_SEND_FAILURES *
// SEND_FAILURE_BACKOFF_MS, defined above). 300_000 + 4*1_200 + 3*2_500 =
// 312_300 ms; doubled for margin.
const ANSWER_LOCK_TTL_SECS = Math.ceil(
  (2 * (rateLimiter.WINDOW_MS + 4 * sender.GAP_MEDIA_MS
    + MAX_CONSECUTIVE_SEND_FAILURES * SEND_FAILURE_BACKOFF_MS)) / 1000,
);

const OFFER_YES = 'vq_offer_yes';
const OFFER_NO = 'vq_offer_no';
// bd-2336 — the third way out: the teacher wants it for their class, not for themselves.
const OFFER_SHARE = 'vq_offer_share';

// ─── Offer ──────────────────────────────────────────────────────────────────

/** Does this video have an importable quiz? */
async function quizForVideo(videoId) {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, topic, grade, subject')
    .eq('video_id', videoId)
    .eq('quiz_source', 'video')
    .maybeSingle();
  if (error) {
    logToFile('⚠️ video-quiz: quiz lookup failed', { videoId, error: error.message });
    return null;
  }
  return data;
}

/**
 * Offer the quiz `OFFER_DELAY_MS` after the video lands.
 *
 * Returns true if an offer was scheduled — the caller uses that to SUPPRESS the
 * standalone 👍/👎 video survey, because once a quiz is offered the survey has
 * to ask about both (see student-video-feedback.service.js scope handling).
 * Two surveys about the same video, 30 s apart, is the thing to avoid.
 */
async function offerAfterVideo({ userId, phone, video, language = 'en', deliveryId = null }) {
  const quiz = await quizForVideo(video.id);
  if (!quiz) return false;

  setTimeout(() => {
    sendOffer({ userId, phone, video, quiz, language, deliveryId })
      .catch((err) => logToFile('❌ video-quiz: sendOffer threw', { error: err.message }));
  }, OFFER_DELAY_MS).unref?.();
  return true;
}

async function sendOffer({ userId, phone, video, quiz, language, deliveryId }) {
  await redisService.set(OFFER_KEY(phone), {
    quizId: quiz.id, videoId: video.id, userId, deliveryId,
    topic: quiz.topic, language,
  }, OFFER_TTL_SECS);

  const t = offerStrings(language);
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: t.body(video.clean_title || quiz.topic),
    // Exactly three — WhatsApp's hard cap on reply buttons. Order is deliberate:
    // taking it themselves first (the common case), then the class route, then out.
    buttons: [
      { id: OFFER_YES, title: t.yes },
      { id: OFFER_SHARE, title: t.share },
      { id: OFFER_NO, title: t.no },
    ],
  });

  if (deliveryId) {
    await supabase.from('video_quiz_deliveries')
      .update({ quiz_offered_at: new Date().toISOString() })
      .eq('id', deliveryId);
  }
  logEvent('video_quiz.offered', { userId, videoId: video.id, quizId: quiz.id });
  // Sibling of the offer_answered already logged in
  // handleOfferButton, so one query answers the whole quiz-offer funnel.
  // sessionId is null here: no session exists until the offer is accepted.
  logEvent('video_quiz.offer_shown', {
    kind: 'quiz', sessionId: null, quizId: quiz.id, source: 'video_solo', language,
  });
}

/**
 * TODO(bd-2311): same catalog migration as offerStrings(). Kept as an explicit
 * per-language map — not a hardcoded English string — so the shape is already
 * per-language and the sweep is mechanical.
 */
function lessonStrings(language) {
  const map = {
    en: {
      ack: '🎬 First, here is the lesson. Watch it, then I will ask you about it.',
      caption: (grade, subject, title) => `📚 ${grade} · ${subject}\n${title}`,
    },
    ur: {
      ack: '🎬 پہلے یہ سبق دیکھیں۔ پھر میں آپ سے اس کے بارے میں سوال کروں گی۔',
      caption: (grade, subject, title) => `📚 ${grade} · ${subject}\n${title}`,
    },
  };
  return map[language] || map.en;
}

/**
 * Send the lesson a shared link points at, before its quiz (bd-2395).
 *
 * BEST-EFFORT BY DESIGN, and that is the whole contract. 14 of 884 R2 objects
 * 404 and 6 rows are not migrated; a child who came to answer questions must
 * never be dead-ended by a missing file. Every failure path logs and returns
 * false, and the caller starts the quiz regardless.
 *
 * Mirrors what /video already does for teachers, including the pre-send ack —
 * that path learned the hard way that a silent 5-15 s upload reads as a hang.
 */
async function sendLessonFirst(phone, videoId, language) {
  try {
    const { data: row, error } = await supabase
      .from('student_videos')
      .select('id, grade, subject, clean_title, r2_url, migration_status')
      .eq('id', videoId)
      .single();
    if (error || !row || row.migration_status !== 'done' || !row.r2_url) {
      logEvent('video_quiz.lesson_skipped', {
        videoId, why: (!row || error) ? 'not_found' : 'not_migrated',
      });
      return false;
    }
    const s = lessonStrings(language);
    const grade = /^\d+$/.test(String(row.grade)) ? `Grade ${row.grade}` : String(row.grade);
    await WhatsAppService.sendMessage(phone, s.ack);
    const ok = await WhatsAppService.sendVideoFromUrl(
      phone, row.r2_url, s.caption(grade, row.subject, row.clean_title));
    logEvent(ok ? 'video_quiz.lesson_sent' : 'video_quiz.lesson_failed', {
      videoId, grade: row.grade, subject: row.subject,
    });
    return !!ok;
  } catch (err) {
    logToFile('⚠️ video-quiz: lesson send threw, starting the quiz anyway', {
      videoId, error: err.message,
    });
    return false;
  }
}

/**
 * TODO(bd-2311): route this copy through resolveUx once the catalog keys land,
 * so ur/sw/ar come from the same place as the rest of the chrome. Kept as an
 * explicit map (not a hardcoded English string) so the shape is already
 * per-language and the migration is mechanical.
 */
function offerStrings(language) {
  const map = {
    en: {
      body: (title) => `Want to try a short quiz on “${title}”?\n\n`
        + `15 quick questions — I'll tell you how you did after each one. `
        + `Or send it straight to your class.`,
      yes: 'Yes, start', no: 'No thanks',
      // bd-2336. WhatsApp truncates a reply-button title past 20 characters
      // SILENTLY, so these are counted, not eyeballed: 16 and 14.
      share: 'Send to my class',
    },
    ur: {
      body: (title) => `کیا آپ “${title}” پر ایک مختصر کوئز کرنا چاہیں گی؟\n\n`
        + `15 آسان سوالات — ہر جواب کے بعد بتاؤں گی کیسا رہا۔ `
        + `یا اسے سیدھا اپنی کلاس کو بھیجیں۔`,
      yes: 'جی، شروع کریں', no: 'ابھی نہیں',
      share: 'کلاس کو بھیجیں',
    },
  };
  return map[language] || map.en;
}

/** Handle the yes/no on the offer. Returns true if this button was ours. */
async function handleOfferButton(buttonId, phone) {
  if (buttonId !== OFFER_YES && buttonId !== OFFER_NO && buttonId !== OFFER_SHARE) {
    return false;
  }
  const offer = await redisService.get(OFFER_KEY(phone));
  if (!offer) {
    await WhatsAppService.sendMessage(phone,
      "That quiz offer has expired — pick the video again and I'll offer it fresh.");
    return true;
  }
  await redisService.delete(OFFER_KEY(phone));

  const shared = buttonId === OFFER_SHARE;
  const accepted = buttonId === OFFER_YES || shared;
  if (offer.deliveryId) {
    await supabase.from('video_quiz_deliveries').update({
      // 'shared' is its own answer, not a flavour of accepted: a teacher who
      // sends it to their class without taking it is a different behaviour
      // from one who sits the quiz, and collapsing them would hide that.
      quiz_response: shared ? 'shared' : (accepted ? 'accepted' : 'declined'),
      quiz_responded_at: new Date().toISOString(),
    }).eq('id', offer.deliveryId);
  }
  // choice is a stable token, never the button title.
  const choice = shared ? 'share' : (accepted ? 'yes' : 'no');
  logEvent('video_quiz.offer_answered', {
    userId: offer.userId, quizId: offer.quizId, accepted, shared, kind: 'quiz', choice,
  });

  if (shared) {
    // Straight to the class link — no solo session, so the teacher is never
    // sent question 1 while also holding the message they are meant to forward.
    const VideoQuizShare = require('./video-quiz-share.service');
    await VideoQuizShare.deliverClassLink({
      quizId: offer.quizId, videoId: offer.videoId, userId: offer.userId,
      language: offer.language,
    }, phone);
    return true;
  }

  if (!accepted) {
    // Declined: the video-only survey fires, as it always did.
    const StudentVideoFeedback = require('../student-video-feedback.service');
    await WhatsAppService.sendMessage(phone, 'No problem — enjoy the video!');
    StudentVideoFeedback.scheduleFeedbackPrompt({
      videoId: offer.videoId, userId: offer.userId, phone,
      context: { language: offer.language, scope: 'video', deliveryId: offer.deliveryId },
    });
    return true;
  }

  await startSession({
    phone, userId: offer.userId, quizId: offer.quizId, videoId: offer.videoId,
    language: offer.language, deliveryId: offer.deliveryId, source: 'video_solo',
  });
  return true;
}

// ─── Session ────────────────────────────────────────────────────────────────

/**
 * The order the questions are ASKED in.
 *
 * A transcript quiz's `external_id` is `tq:<quizId>:<sloId>:<n>` (see
 * transcript-quiz-generate.service.js), so the DB's own `order('external_id')`
 * walks the bank in SLO-id STRING order — which has nothing to do with the
 * order the cards were numbered in. A transcript card's printed number is its
 * `sort_order + 1` (renderCards numbers `i + 1` from `sort_order`), so the
 * chrome counter ("Question N of M") only agrees with the card's own printed
 * number when the session itself asks questions in `sort_order`.
 *
 * The PK video bank has no such mismatch — it is left exactly as before:
 * `leg:`-prefixed rows first, then the rest, each group in the order the DB
 * returned it (operator decision — the legacy bank is the media-rich one, so
 * a child gets the richer items first).
 *
 * `Array.prototype.sort` is stable in Node (V8 has guaranteed this since
 * Node 11), so a tie (missing/equal `sort_order`) keeps the DB's own order,
 * and a null/undefined `sort_order` sorts last rather than first.
 */
function orderForSession(questions) {
  if (!questions.length) return [];
  const isTranscriptBank = questions.every((q) => (q.external_id || '').startsWith('tq:'));
  if (isTranscriptBank) {
    return [...questions].sort((a, b) => {
      const an = a.sort_order == null ? Infinity : a.sort_order;
      const bn = b.sort_order == null ? Infinity : b.sort_order;
      return an - bn;
    });
  }
  const legacy = questions.filter((q) => (q.external_id || '').startsWith('leg:'));
  const generated = questions.filter((q) => !(q.external_id || '').startsWith('leg:'));
  return [...legacy, ...generated];
}

/**
 * Pick the questions and open a session.
 *
 * SELECTION: legacy first, generated as top-up (operator decision) for the PK
 * video bank; a transcript bank is ordered by `sort_order` instead — see
 * `orderForSession` above for why the two banks need different rules.
 */
async function startSession({ phone, userId, quizId, videoId, language, deliveryId,
                              source = 'video_solo', studentName = null,
                              studentClass = null, shareCodeId = null,
                              studentId = null, invitedByStudentId = null }) {
  const { data: questions, error } = await supabase
    .from('quiz_questions')
    .select('id, external_id, sort_order')
    .eq('quiz_id', quizId)
    .order('external_id', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error || !questions || !questions.length) {
    logToFile('❌ video-quiz: no questions for quiz', { quizId, error: error?.message });
    await WhatsAppService.sendMessage(phone, ux('vqNoQuestions', language));
    return null;
  }

  const chosen = orderForSession(questions).slice(0, QUESTIONS_PER_SESSION);

  // bd-2481: video_solo (a teacher taking the quiz themselves) never collects
  // a name — share_link already has one (the child gave it at join time). For
  // the solo path, look their own name up so the scorecard isn't anonymous.
  let takerName = studentName;
  if (!takerName && source === 'video_solo' && userId) {
    const { data: user } = await supabase
      .from('users').select('first_name, last_name').eq('id', userId).maybeSingle();
    takerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;
  }

  const { data: session, error: sErr } = await supabase
    .from('quiz_sessions')
    .insert({
      quiz_id: quizId,
      user_id: userId,
      // bd-2337: the FK to `students` has existed since the schema landed but
      // was never populated. Filling it is what lets a child be recognised on
      // their next quiz, and what ties a run to a person rather than a string.
      student_id: studentId,
      // bd-2339: set when this child came through a friend's invite. On
      // completion the friend is told how they did.
      invited_by_student_id: invitedByStudentId,
      student_name: takerName,
      student_class: studentClass,
      share_code_id: shareCodeId,
      source,
      parent_phone: phone,
      status: 'in_progress',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (sErr || !session) {
    // Checked, not ignored: the parent quiz silently swallowed exactly this
    // error for months (bd-2305) and nobody noticed the status never moved.
    logToFile('❌ video-quiz: could not create session', { quizId, error: sErr?.message });
    await WhatsAppService.sendMessage(phone,
      "Sorry — I couldn't start that quiz. Please try again in a moment.");
    return null;
  }

  // bd-2396: the delivery row is the offer, the session is the answer — link
  // them, or the funnel can only be reconstructed by a user+quiz join that
  // breaks the moment a teacher gets the same video offered twice.
  if (deliveryId) {
    const { error: dErr } = await supabase.from('video_quiz_deliveries')
      .update({ quiz_session_id: session.id })
      .eq('id', deliveryId);
    if (dErr) {
      logToFile('⚠️ video-quiz: could not link session to delivery',
        { deliveryId, sessionId: session.id, error: dErr.message });
    }
  }

  // bd-2397: count the join here, where every share-code route funnels
  // (Flow join, chat fallback, returning child, invite) — the old call site
  // covered one route and its .catch() fallback was dead code, because
  // supabase .rpc() resolves with {error}, it never rejects.
  if (shareCodeId) {
    try {
      const { error: rpcErr } = await supabase
        .rpc('increment_share_code_uses', { code_id: shareCodeId });
      if (rpcErr) {
        logToFile('⚠️ video-quiz: increment_share_code_uses failed, using fallback',
          { shareCodeId, error: rpcErr.message });
        const { data: sc } = await supabase.from('quiz_share_codes')
          .select('uses_count').eq('id', shareCodeId).maybeSingle();
        await supabase.from('quiz_share_codes')
          .update({ uses_count: (sc?.uses_count || 0) + 1 })
          .eq('id', shareCodeId);
      }
    } catch (e) {
      // Counting must never block a child's quiz from starting.
      logToFile('⚠️ video-quiz: increment_share_code_uses threw',
        { shareCodeId, error: e.message });
    }
  }

  const state = {
    sessionId: session.id, quizId, videoId, userId, language, deliveryId, source,
    shareCodeId,
    // bd-2339: carried so the invite offer at the end knows who to attribute it
    // to — without it we would offer an invite we cannot report back on.
    studentId,
    // bd-2481: carried so finish() can put a name on the scorecard.
    takerName,
    questionIds: chosen.map((q) => q.id),
    index: 0, correct: 0, answered: 0,
    currentQuestionId: null,
  };
  await redisService.set(STATE_KEY(phone), state, STATE_TTL_SECS);
  logEvent('video_quiz.session_started', {
    sessionId: session.id, quizId, source, questions: chosen.length,
  });

  // bd-2395: a child who arrived on a shared class link has NOT seen the
  // lesson — the teacher sent them a link, not a classroom. Send it before the
  // first question. Gated on share_link because a teacher who reached this
  // quiz through /video has just watched the video (their source is video_solo).
  //
  // AWAITED deliberately. WhatsApp does not guarantee ordering for rapid
  // sends, so question 1 firing during a 5-15 s upload is the same class of bug
  // as the R18 out-of-order clip: a race, not a layout problem.
  //
  // A TRANSCRIPT quiz has no lesson video (video_id null): the lesson was
  // the teacher's own class, so there is nothing to send first.
  if (source === 'share_link' && videoId) {
    await sendLessonFirst(phone, videoId, language);
  }

  await rateLimiter.throttle(phone);
  await WhatsAppService.sendMessage(phone, ux('vqHereWeGo', language, { n: chosen.length }));
  await sendNextQuestion(phone, state);
  return state;
}

async function sendNextQuestion(phone, state) {
  if (state.index >= state.questionIds.length) return finish(phone, state);

  const questionId = state.questionIds[state.index];
  const { data: q, error } = await supabase
    .from('quiz_questions')
    // external_id: video-quiz-render.service.js's displayOrder seeds the
    // shuffle on external_id || id — without it this re-select shuffles the
    // options differently from the card the child was actually shown.
    .select('id, external_id, question_text, option_a, option_b, option_c, option_d, correct_option, '
            + 'explanation, option_feedback, media, render_pattern')
    .eq('id', questionId)
    .single();
  if (error || !q) {
    logToFile('⚠️ video-quiz: question missing, skipping', { questionId });
    state.index += 1;
    await saveState(phone, state, 'sendNextQuestion:missingQuestion');
    return sendNextQuestion(phone, state);
  }

  // "Question n of N" used to be a WhatsAppService.sendMessage of its own right
  // here. It cost a full unit of the recipient's 5-minute send window for
  // eleven characters of chrome — an eighth of the whole budget across an
  // 8-question quiz, and the difference between a session that finishes and one
  // that stalls for three minutes a question. It is now data on the question's
  // own message (render.build's `counter`), folded into that message's body or
  // caption by the sender; on a question card it is dropped entirely, because
  // the card paints the number into the picture itself.
  const msgs = render.build(q, {
    questionNumber: state.index + 1, totalQuestions: state.questionIds.length,
  });
  const ctx = { questionId: q.id, sessionId: state.sessionId, language: state.language };

  await sender.sendPhase(phone, msgs, 'question', ctx);
  const res = await sender.sendPhase(phone, msgs, 'interaction', ctx);

  if (res.pickerFailed) {
    // No tap surface reached the child. Most of the time this is transient
    // (a WhatsApp rate-limit window, bd-2477) — retry the SAME question after
    // a backoff rather than skipping it, so a child doesn't lose a real
    // question to a send blip that clears a moment later.
    state.sendFailures = (state.sendFailures || 0) + 1;
    await saveState(phone, state, 'sendNextQuestion:pickerFailed');

    if (state.sendFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
      logToFile('⚠️ video-quiz: giving up after repeated send failures', {
        phone: phone.slice(-4), sessionId: state.sessionId, atIndex: state.index,
      });
      await WhatsAppService.sendMessage(phone, ux('vqTrouble', state.language));
      return finish(phone, state);
    }

    await sleep(SEND_FAILURE_BACKOFF_MS);
    return sendNextQuestion(phone, state);
  }

  state.sendFailures = 0;
  state.currentQuestionId = q.id;
  state.sentAt = Date.now();
  await saveState(phone, state, 'sendNextQuestion:sent');
  return null;
}

/** 'card' | 'image' | 'none' — what the question showed alongside the text. */
function mediaKind(q) {
  const media = (q && q.media) || {};
  if (media.question_card) return 'card';
  if (media.question_image) return 'image';
  return 'none';
}

/**
 * Acquire the per-phone answer lock, waiting in ANSWER_LOCK_STEP_MS steps up
 * to ANSWER_LOCK_WAIT_MS. Fail-open on timeout — a rare duplicate answer is
 * far better than dropping a child's tap entirely, and the truth-derived
 * index (nextIndexFromTruth) makes a duplicate harmless. Redis being down
 * makes `setNX` itself return true unconditionally (railway-redis.service.js)
 * so this resolves immediately in that case too.
 *
 * @returns {Promise<{key: string, waitedMs: number, timedOut: boolean}>}
 */
async function acquireAnswerLock(phone) {
  const key = ANSWER_LOCK_KEY(phone);
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const claimed = await redisService.setNX(key, Date.now(), ANSWER_LOCK_TTL_SECS);
    const waitedMs = Date.now() - start;
    if (claimed) return { key, waitedMs, timedOut: false };
    if (waitedMs >= ANSWER_LOCK_WAIT_MS) return { key, waitedMs, timedOut: true };
    await sleep(ANSWER_LOCK_STEP_MS);
  }
}

/**
 * Grade a tap and move on. Returns true if the input belonged to a video quiz.
 */
async function handleAnswer(phone, inputId) {
  // The child's tap is what needs measuring, so the clock starts on the
  // FIRST line, before the render parse — not on our own bookkeeping.
  const answerStart = Date.now();
  const parsed = render.parseAnswer(inputId);
  if (!parsed) return false;

  // The lock covers the WHOLE answer path, not just the DB write: the read
  // of `state` below must happen INSIDE the critical section, or a second
  // overlapping call can still read the same stale value this one did.
  const { key: lockKey, waitedMs, timedOut } = await acquireAnswerLock(phone);
  try {
    const state = await redisService.get(STATE_KEY(phone));
    const phoneTail = String(phone).slice(-4);
    if (timedOut) {
      logEvent('video_quiz.answer_lock_timeout', {
        sessionId: state ? state.sessionId : null, questionId: parsed.questionId,
        waitedMs, phoneTail,
      });
    } else if (waitedMs > 0) {
      logEvent('video_quiz.answer_lock', {
        sessionId: state ? state.sessionId : null, questionId: parsed.questionId,
        waitedMs, phoneTail,
      });
    }
    logEvent('video_quiz.state_read', {
      where: 'handleAnswer', found: !!state,
      sessionId: state ? state.sessionId : null,
      index: state ? state.index : null,
      answered: state ? state.answered : null,
      questions: state ? (state.questionIds || []).length : 0,
      questionId: parsed.questionId,
    });
    if (!state) {
      await WhatsAppService.sendMessage(phone,
        "That quiz has finished. Pick another video and I'll offer you a fresh one!");
      return true;
    }

    const { data: q } = await supabase
      .from('quiz_questions')
      // external_id: same seed reason as sendNextQuestion's select above — the
      // grading path must reconstruct the SAME shuffle the child was shown.
      .select('id, external_id, question_text, option_a, option_b, option_c, option_d, correct_option, '
              + 'explanation, option_feedback, media, render_pattern')
      .eq('id', parsed.questionId)
      .single();
    if (!q) return true;

    const correctIdx = render.correctIndices(q);
    const isCorrect = correctIdx.includes(parsed.index);
    const letter = 'ABCD'[parsed.index] || 'A';

    const { error: aErr } = await supabase.from('quiz_answers').insert({
      session_id: state.sessionId,
      question_id: q.id,
      selected_option: letter,
      is_correct: isCorrect,
      response_time_seconds: state.sentAt
        ? Math.round((Date.now() - state.sentAt) / 1000) : null,
    });
    if (aErr && aErr.code === '23505') {
      logEvent('video_quiz.answer_duplicate', {
        sessionId: state.sessionId, questionId: q.id,
        index: state.index, answered: state.answered,
      });
      // UNIQUE(session_id, question_id): either a double tap, or the answer was
      // recorded and the process died before the state advanced (a deploy landed
      // mid-quiz on staging: all eight answers stored, the session stuck at 5/8,
      // every later tap swallowed here). Rebuild the state from the answers table
      // and carry on — the next question, or the finish. This tap never
      // delivered a verdict, so it gets no answer_latency — one would
      // misrepresent a re-tap or a resumed process as a normal graded answer.
      return reconcileFromAnswers(phone, state);
    }
    if (aErr) logToFile('⚠️ video-quiz: answer insert failed', { error: aErr.message });

    // No emoji reaction here: sendReaction needs the message id of the child's
    // own reply, which the webhook gives us but this path does not carry. Calling
    // it with null would fail silently on every single answer — dead code that
    // reads like a working feature. The verdict text opens with ✅ / "Not quite"
    // anyway, so the feedback is not lost.
    const msgs = render.build(q);
    await sender.sendPhase(phone, msgs, 'answer', {
      questionId: q.id, sessionId: state.sessionId, language: state.language,
      isCorrect, selectedIndex: parsed.index,
    });
    const msToFeedback = Date.now() - answerStart;

    // The columns come from the table this call has just written to, never from
    // the counters carried in `state` — see writeCountersFromAnswers. `state` then
    // MIRRORS that truth rather than accumulating its own, so a stale blob cannot
    // put a number on a child's scorecard that nothing in the database supports.
    const truth = await writeCountersFromAnswers(state.sessionId, { reason: 'answer', phone });
    state.answered = truth.answered;
    state.correct = truth.correct;
    // Derived, never incremented: an increment on a stale-but-locked read
    // would still be wrong the moment two DIFFERENT questions are answered
    // out of order (a duplicate-tap retry, a resumed process) — the index has
    // to be recomputed from the durable record every time, exactly like
    // reconcileFromAnswers already does.
    state.index = nextIndexFromTruth(state.questionIds, truth);
    state.currentQuestionId = null;
    await saveState(phone, state, 'handleAnswer');

    const finished = truth.answered >= state.questionIds.length;
    const msPause = 1200;
    await new Promise((r) => setTimeout(r, msPause));
    if (finished) {
      await finish(phone, state);
    } else {
      await sendNextQuestion(phone, state);
    }
    logEvent('video_quiz.answer_latency', {
      sessionId: state.sessionId, questionId: q.id, isCorrect,
      msToFeedback, msToNextQuestion: Date.now() - answerStart, msPause,
      media: mediaKind(q), finished,
    });
    return true;
  } finally {
    await redisService.delete(lockKey);
  }
}

/**
 * Rebuild a session's progress from quiz_answers and continue. Idempotent:
 * a second call after the finish finds no state and does nothing.
 */
/**
 * What the answers table says about a session — the truth the card and the
 * report are built from. Round 4 live run 2: the session row had drifted to 5
 * while eight answers were stored, and a reconcile that intersected the
 * state's question list with the table counted six. Count the table itself.
 */
/**
 * Where the session continues, derived from the durable record rather than
 * incremented — the ONE rule reconcileFromAnswers, handleAnswer and
 * handleMultiAnswer all share, so it cannot drift into a second copy.
 *
 * @param {string[]} questionIds state.questionIds, in the order asked
 * @param {{byQ: Map, answered: number}} truth from truthFromAnswers()
 * @returns {number} the index of the first unanswered question, or
 *   questionIds.length when every id has an answer (or answered has already
 *   overtaken the list — a stale/short question list is over, not stuck).
 */
function nextIndexFromTruth(questionIds, truth) {
  const ids = questionIds || [];
  const firstOpen = ids.findIndex((id) => !truth.byQ.has(id));
  return (firstOpen < 0 || truth.answered >= ids.length) ? ids.length : firstOpen;
}

async function truthFromAnswers(sessionId) {
  const { data: rows } = await supabase
    .from('quiz_answers')
    .select('question_id, is_correct')
    .eq('session_id', sessionId);
  const byQ = new Map((rows || []).map((r) => [r.question_id, !!r.is_correct]));
  let correct = 0;
  for (const v of byQ.values()) if (v) correct += 1;
  return { byQ, answered: byQ.size, correct };
}

/**
 * Write the session's counters FROM THE ANSWERS TABLE, and never downwards.
 *
 * THE BUG THIS EXISTS TO END. A live staging run stored eight answers, one per
 * question, no duplicates — and `total_questions_answered` sat at five, with no
 * error and no warning anywhere. The counters were being written from
 * `state.answered`: a Redis blob, which is a CACHE, while `quiz_answers` is the
 * record. That cache can lose an update through two doors, and neither raises
 * anything a caller can see —
 *
 *   1. `redisService.set()` swallows every Redis failure, logs a warning and
 *      returns `false` (railway-redis.service.js). Nothing here checked the
 *      return value, so a dropped write left `state.answered` behind and every
 *      later answer counted up from the stale number.
 *   2. The read-to-write window in `handleAnswer` spans the whole answer-phase
 *      send — verdict, explanation image, explanation audio, each behind a
 *      throttle and a 700-1200 ms gap. Two calls overlapping there both read
 *      `answered = n` and both write `n + 1`.
 *
 * Patching either door leaves the other, and leaves the next one. The counters
 * simply have no business depending on the cache: `truthFromAnswers()` already
 * fed `finish()` and `reconcileFromAnswers()` from the table, and the per-answer
 * write was the one place still trusting the blob.
 *
 * The `.lte()` guard is the second half. Reads of the table are monotonic, but
 * two concurrent WRITES can still land out of order, and an out-of-order write
 * is how a session that has recorded eight answers reports five. The filter
 * makes a lower number a no-op at the database, so the columns can move up and
 * never down.
 *
 * @returns {Promise<{answered:number, correct:number}>} the truth it wrote from
 */
async function writeCountersFromAnswers(sessionId, { reason, phone } = {}) {
  const truth = await truthFromAnswers(sessionId);
  const { data: before } = await supabase
    .from('quiz_sessions')
    .select('total_questions_answered, correct_answers')
    .eq('id', sessionId)
    .maybeSingle();

  // `id=eq.<session> AND (total_questions_answered IS NULL OR <= n)` — verified
  // against the client, not assumed from the docs. A bare `.lte()` would have
  // been a trap: the column is nullable, and `NULL <= n` is UNKNOWN in SQL, so
  // a session whose counter was never set would silently match no rows and
  // never be written again.
  const { error } = await supabase.from('quiz_sessions')
    .update({ total_questions_answered: truth.answered, correct_answers: truth.correct })
    .eq('id', sessionId)
    .or(`total_questions_answered.is.null,total_questions_answered.lte.${truth.answered}`);

  logEvent('video_quiz.counters_written', {
    sessionId, reason,
    phoneTail: phone ? String(phone).slice(-4) : null,
    fromAnswered: before ? before.total_questions_answered : null,
    fromCorrect: before ? before.correct_answers : null,
    toAnswered: truth.answered,
    toCorrect: truth.correct,
    // A guard that fires is not an error: it means a later write already got
    // there. It IS the signal that two writers overlapped, so it is worth
    // counting in the logs rather than inferring from a gap.
    guarded: !!(before && (before.total_questions_answered || 0) > truth.answered),
    error: error ? error.message : null,
  });
  if (error) {
    logToFile('\u26a0\ufe0f video-quiz: counter write failed', { sessionId, error: error.message });
  }
  return truth;
}

/**
 * Put the session state back in Redis, and SAY SO when the write is lost.
 *
 * `redisService.set()` returns false on any failure and logs it as a warning
 * nobody reads. A lost state write is not fatal any more — the counters come
 * from the answers table — but it is exactly the event that has to be visible
 * when a session behaves oddly, so it gets its own name.
 */
async function saveState(phone, state, where) {
  const ok = await redisService.set(STATE_KEY(phone), state, STATE_TTL_SECS);
  logEvent('video_quiz.state_written', {
    sessionId: state.sessionId, where, ok: ok !== false,
    index: state.index, answered: state.answered, correct: state.correct,
    questions: (state.questionIds || []).length, ttlSecs: STATE_TTL_SECS,
  });
  return ok;
}

async function reconcileFromAnswers(phone, state) {
  const truth = await truthFromAnswers(state.sessionId);
  state.answered = truth.answered;
  state.correct = truth.correct;
  // The first unanswered question is where the child continues; a stale
  // question list that is shorter than the answers means the quiz is over.
  state.index = nextIndexFromTruth(state.questionIds, truth);
  state.currentQuestionId = null;
  await saveState(phone, state, 'reconcileFromAnswers');
  await writeCountersFromAnswers(state.sessionId, { reason: 'reconcile', phone });
  logEvent('video_quiz.reconciled', { sessionId: state.sessionId, answered: state.answered, index: state.index });
  // sendNextQuestion's own `state.index >= state.questionIds.length` guard
  // finishes the session when nextIndexFromTruth above has already derived
  // the end — unlike handleAnswer/handleMultiAnswer, there is no separately
  // stale index here to second-guess it against.
  await sendNextQuestion(phone, state);
  return true;
}

async function finish(phone, state) {
  // The answers table is the truth; the in-memory counters are a cache that
  // has been seen to drift (round 4 live run 2: 6/5 in the state, 8/7 stored).
  let total = state.answered || 0;
  let correct = state.correct || 0;
  try {
    const truth = await truthFromAnswers(state.sessionId);
    if (truth.answered > 0) { total = truth.answered; correct = truth.correct; }
  } catch (e) {
    logToFile('⚠️ video-quiz: could not read the answers table at finish (using the state)', { error: e.message });
  }
  state.answered = total;
  state.correct = correct;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const level = pct >= 80 ? 'mastered' : pct >= 60 ? 'developing' : 'needs_practice';

  const { error: fErr } = await supabase.from('quiz_sessions').update({
    status: 'completed',
    total_questions_answered: total,
    correct_answers: state.correct,
    mastery_percentage: pct,
    mastery_level: level,
    completed_at: new Date().toISOString(),
  }).eq('id', state.sessionId);
  // Deliberately NOT guarded by `.lte()`: this write is the session's last word
  // and it carries `status`, `mastery_percentage` and `completed_at` with it, so
  // refusing it over a counter would leave a finished quiz marked in_progress.
  // It is safe unguarded precisely because `total` was read from the answers
  // table two lines up rather than from the cache.
  logEvent('video_quiz.counters_written', {
    sessionId: state.sessionId, reason: 'finish',
    phoneTail: String(phone).slice(-4),
    toAnswered: total, toCorrect: state.correct, guarded: false,
    error: fErr ? fErr.message : null,
  });

  await redisService.delete(STATE_KEY(phone));

  // bd-2474 — the designed scorecard (navy/gold, stars + score) was never
  // wired in; a child got only this plain text. Best-effort: if the render
  // or send fails, fall back to exactly what shipped before this feature so
  // a child is never left with nothing.
  const { data: quizMeta } = await supabase
    .from('quizzes').select('topic, grade, subject').eq('id', state.quizId).maybeSingle();
  const Scorecard = require('./video-quiz-scorecard.service');
  const sentScorecard = await Scorecard.sendScorecard(phone, {
    topic: quizMeta?.topic, grade: quizMeta?.grade, subject: quizMeta?.subject,
    correct: state.correct, total, pct, takerName: state.takerName, language: state.language,
  }).catch((err) => {
    logToFile('⚠️ video-quiz: scorecard send threw', { error: err.message });
    return false;
  });
  if (!sentScorecard) {
    const tierKey = level === 'mastered' ? 'vqTierMastered' : level === 'developing' ? 'vqTierDeveloping' : 'vqTierNeedsPractice';
    await WhatsAppService.sendMessage(phone, ux('vqDoneFallback', state.language, {
      correct: state.correct, total, pct, tier: ux(tierKey, state.language),
    }));
  }
  logEvent('video_quiz.scorecard_sent', {
    sessionId: state.sessionId, quizId: state.quizId,
    ok: !!sentScorecard, fallback: !sentScorecard, pct, language: state.language,
  });

  logEvent('video_quiz.completed', {
    sessionId: state.sessionId, quizId: state.quizId, total,
    correct: state.correct, pct, source: state.source,
  });

  // bd-2317: a child finishing a shared quiz may have been the last one. If
  // every session on that share code is now terminal, the teacher's report goes
  // out immediately instead of waiting for the morning.
  if (state.source === 'share_link' && state.shareCodeId) {
    const report = require('./video-quiz-report.service');
    await report.maybeSendEarly(state.shareCodeId)
      .catch((err) => logToFile('⚠️ early report failed', { error: err.message }));

    // bd-2339 — if a friend sent them here, tell that friend how they did, then
    // offer them the same. Both are best-effort: a child's own quiz must never
    // fail because of something that happens after they finish it.
    const Invite = require('./video-quiz-invite.service');
    const { data: session } = await supabase
      .from('quiz_sessions')
      .select('quiz_id, student_name, correct_answers, total_questions_answered, '
              + 'mastery_percentage, invited_by_student_id')
      .eq('id', state.sessionId)
      .maybeSingle();
    if (session?.invited_by_student_id) {
      await Invite.notifyInviter(session)
        .catch((err) => logToFile('⚠️ inviter notify failed', { error: err.message }));
    }
    await Invite.offerInvite({
      phone, studentId: state.studentId, shareCodeId: state.shareCodeId,
      language: state.language, sessionId: state.sessionId, quizId: state.quizId,
    }).catch((err) => logToFile('⚠️ invite offer failed', { error: err.message }));
  }

  // Only the solo path gets the video survey and the share offer. A child who
  // arrived via a share link is not the person who chose the video.
  if (state.source === 'video_solo') {
    const share = require('./video-quiz-share.service');
    await share.offerShare({
      phone, userId: state.userId, quizId: state.quizId,
      videoId: state.videoId, language: state.language, sessionId: state.sessionId,
    }).catch((err) => logToFile('⚠️ share offer failed', { error: err.message }));

    const StudentVideoFeedback = require('../student-video-feedback.service');
    StudentVideoFeedback.scheduleFeedbackPrompt({
      videoId: state.videoId, userId: state.userId, phone,
      context: {
        language: state.language, scope: 'video_and_quiz',
        quizSessionId: state.sessionId, deliveryId: state.deliveryId,
      },
    });
  }
  return null;
}

/**
 * bd-2398: stamp offers nobody answered as 'ignored' once they are older than
 * the cutoff. The CHECK constraint admitted the value from day one but nothing
 * wrote it, so unanswered offers sat at NULL forever and response-rate queries
 * had to guess what NULL meant. Runs from the worker janitor, daily; the
 * update is idempotent, so concurrent runs from regional workers on the
 * shared DB are safe. Filters on quiz_offered_at (not created_at): a delivery
 * whose offer was never sent stays NULL, which is the truth.
 */
async function sweepIgnoredOffers({ maxAgeHours = 24 } = {}) {
  try {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('video_quiz_deliveries')
      .update({ quiz_response: 'ignored' })
      .is('quiz_response', null)
      .lt('quiz_offered_at', cutoff)
      .select('id');
    if (error) {
      logToFile('⚠️ video-quiz: ignored-offer sweep failed', { error: error.message });
      return { swept: 0 };
    }
    const swept = data?.length || 0;
    if (swept) logEvent('video_quiz.offers_swept_ignored', { count: swept });
    return { swept };
  } catch (e) {
    logToFile('⚠️ video-quiz: ignored-offer sweep threw', { error: e.message });
    return { swept: 0 };
  }
}

// ─── "select all that apply" (PLAN_R5 D4) ───────────────────────────────────
//
// A question whose answer is a SET arrives from its own Flow, not from a tap.
// These two are the siblings of handleAnswer above and live here for the same
// reason it does: the session state, the duplicate reconcile and the
// next-question walk are all in this file. The policy — what a set IS, how it
// scores, what the verdict says, what the Flow is sent — is in
// transcript-quiz-multi, which is a LEAF module (video-quiz-render and
// video-quiz-sender both require it, so it may not require back).

const MULTI_QUESTION_COLUMNS = 'id, external_id, question_text, option_a, option_b, option_c, '
  + 'option_d, correct_option, explanation, option_feedback, media, render_pattern';

/**
 * Grade one submitted set and move the session on.
 *
 * Deliberately a sibling of handleAnswer rather than a branch inside it: the
 * two differ in what they store ("A,C" not "A"), how they score (set equality,
 * not membership) and what they say (a composed verdict, not one of N pre-built
 * branches the sender filters). Everything they share is called, not copied.
 *
 * @returns {Promise<boolean>} true when the reply belonged to a video quiz
 */
async function handleMultiAnswer(phone, parsed) {
  const Multi = require('./transcript-quiz-multi');
  if (!parsed || !parsed.questionId) return false;

  // Same lock, same key as handleAnswer: a Flow submission and a button tap
  // on one phone must not overlap either.
  const { key: lockKey, waitedMs, timedOut } = await acquireAnswerLock(phone);
  try {
    const state = await redisService.get(STATE_KEY(phone));
    const phoneTail = String(phone).slice(-4);
    if (timedOut) {
      logEvent('video_quiz.answer_lock_timeout', {
        sessionId: state ? state.sessionId : null, questionId: parsed.questionId,
        waitedMs, phoneTail,
      });
    } else if (waitedMs > 0) {
      logEvent('video_quiz.answer_lock', {
        sessionId: state ? state.sessionId : null, questionId: parsed.questionId,
        waitedMs, phoneTail,
      });
    }
    if (!state) {
      await WhatsAppService.sendMessage(phone, ux('vqExpired', undefined));
      return true;
    }
    const language = state.language;

    const { data: q } = await supabase
      .from('quiz_questions')
      .select(MULTI_QUESTION_COLUMNS)
      .eq('id', parsed.questionId)
      .single();
    if (!q) return true;

    const labels = render.optionLabels(q);
    const correct = Multi.indicesFor(q.correct_option);
    const { isCorrect } = Multi.scoreSet(parsed.indices, correct);

    const { error: aErr } = await supabase.from('quiz_answers').insert({
      session_id: state.sessionId,
      question_id: q.id,
      // The whole set, in the same comma-joined letter shape correct_option uses,
      // so the report can compare a child's answer to the key without a second
      // encoding to get wrong.
      selected_option: Multi.lettersFor(parsed.indices),
      is_correct: isCorrect,
      response_time_seconds: state.sentAt ? Math.round((Date.now() - state.sentAt) / 1000) : null,
    });
    if (aErr && aErr.code === '23505') {
      // A Flow message can be submitted twice exactly as a button can be tapped
      // twice, and a deploy can still land between the insert and the state write.
      return reconcileFromAnswers(phone, state);
    }
    if (aErr) logToFile('⚠️ video-quiz: multi answer insert failed', { error: aErr.message });

    const verdict = Multi.verdictText(q, { selectedIndices: parsed.indices, labels, language });
    await rateLimiter.throttle(phone);
    await WhatsAppService.sendMessage(phone, render.withVerdictMark(
      verdict.text, verdict.isCorrect ? render.VERDICT_CORRECT : render.VERDICT_WRONG,
    ));

    logEvent('video_quiz.multi_answered', {
      sessionId: state.sessionId,
      questionId: q.id,
      selected: parsed.indices.length,
      correctCount: correct.length,
      isCorrect,
    });

    // Same rule as handleAnswer: the columns come from the answers table, never
    // from the counters carried in `state`, and `state` mirrors what was written.
    const truth = await writeCountersFromAnswers(state.sessionId, { reason: 'multi_answer', phone });
    state.answered = truth.answered;
    state.correct = truth.correct;
    // Derived, never incremented — same rule as handleAnswer.
    state.index = nextIndexFromTruth(state.questionIds, truth);
    state.currentQuestionId = null;
    await saveState(phone, state, 'handleMultiAnswer');

    await new Promise((r) => setTimeout(r, 1200));
    if (truth.answered >= (state.questionIds || []).length) {
      await finish(phone, state);
    } else {
      await sendNextQuestion(phone, state);
    }
    return true;
  } finally {
    await redisService.delete(lockKey);
  }
}

/**
 * The whole nfm_reply path in one call, so the branch in whatsapp-bot.js is
 * four lines and everything it does is testable without loading the bot.
 *
 * ALWAYS returns true for a token that is ours, including when the payload is
 * unusable. Falling through would hand a `vqm:...` token to detectFlowType,
 * whose attendance_marking rule matches ANY flow_token containing a colon —
 * the misroute class that has already eaten the exam-generator, observe and
 * training-msq flows.
 *
 * @returns {Promise<boolean>} true when this reply was ours (handled or refused)
 */
async function handleMultiFlowReply(phone, rawToken, responseJson = {}) {
  const Multi = require('./transcript-quiz-multi');
  const mine = Multi.ownsToken(rawToken) || Multi.ownsToken(responseJson.answer_token)
    || String(responseJson.quiz_multi_action || '') === Multi.FLOW_ACTION;
  if (!mine) return false;
  const parsed = Multi.parseFlowReply(rawToken, responseJson);
  if (!parsed) {
    logEvent('video_quiz.multi_reply_unreadable', {
      hasToken: Boolean(rawToken), keys: Object.keys(responseJson || {}).join(','),
    });
    logToFile('⚠️ video-quiz: multi-select Flow reply had no readable selection', {
      phone: String(phone).slice(-4),
    });
    return true;
  }
  try {
    await handleMultiAnswer(phone, parsed);
  } catch (err) {
    logToFile('❌ video-quiz: multi-select grading threw', { error: err.message }, 'error');
  }
  return true;
}

async function getActiveState(phone) {
  return redisService.get(STATE_KEY(phone));
}

module.exports = {
  offerAfterVideo,
  handleOfferButton,
  handleAnswer,
  handleMultiAnswer,
  handleMultiFlowReply,
  // Shared with the multi-select path (transcript-quiz-multi): a Flow can be
  // submitted twice exactly as a button can be tapped twice, and there must be
  // ONE implementation of what a duplicate means.
  reconcileFromAnswers,
  startSession,
  orderForSession,
  finish,
  sweepIgnoredOffers,
  sendNextQuestion,
  writeCountersFromAnswers,
  getActiveState,
  quizForVideo,
  QUESTIONS_PER_SESSION,
  OFFER_YES,
  OFFER_NO,
  OFFER_SHARE,
  offerStrings,
  STATE_KEY,
  OFFER_KEY,
};
