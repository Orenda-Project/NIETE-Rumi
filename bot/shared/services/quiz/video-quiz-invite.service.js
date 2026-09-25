'use strict';
/**
 * bd-2339 — a child passes the quiz to a friend, and hears how they did.
 *
 * THE BOUNDARY
 * This is the only place in the feature where two CHILDREN exchange
 * information, so what crosses is deliberately small: a first name and a score.
 * Not a family name, not a class, not a phone number, not which questions the
 * friend got wrong. Operator decision, 2026-07-28. If that ever widens it
 * should widen on purpose, not by someone adding a field to a query.
 *
 * THE STRUCTURAL CHOICE
 * A child arriving through an invite gets their session recorded against the
 * TEACHER's share code, not the invite. The teacher's class report therefore
 * needs no knowledge that invites exist — the teacher queries one share code
 * and sees every child who took their quiz, however they reached it. The
 * invite row only decides who ALSO gets told when they finish.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const INVITE_YES = 'vq_invite_yes';
const INVITE_NO = 'vq_invite_no';
const INVITE_TTL_SECS = 60 * 60;
/**
 * bd-2yyry.8 — how long an unanswered invite waits before the videos offer
 * arrives anyway. Prod, 6–14 Sep 2026: 3,013 of 6,674 invites were never
 * answered, and the videos offer only ever followed a NO — so those children,
 * and the 1,521 who said YES, never saw it (4,534 of 6,674, 68%).
 */
const VIDEOS_AFTER_SILENCE_SECS = 600;
const VIDEOS_JOB = 'quiz_child_videos_offer';
const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);
const INVITE_KEY = (phone) => `videoquiz:${stripPlus(phone)}:invite`;

/** A child's first name. Nothing after the first space leaves their chat. */
function firstName(full, fallback = 'Your friend') {
  return String(full || '').trim().split(/\s+/)[0] || fallback;
}

/**
 * Offer the invite after a child finishes.
 *
 * Skipped when we could not identify them: with no student id there is nobody
 * to send the comparison back to, so offering it would be a promise we cannot
 * keep.
 */
async function offerInvite({ phone, studentId, shareCodeId, language = 'en',
                             sessionId = null, quizId = null }) {
  if (!studentId || !shareCodeId) return false;
  await redisService.set(INVITE_KEY(phone), { studentId, shareCodeId, language, sessionId, quizId },
    INVITE_TTL_SECS);
  // In the quiz language — a child who just took an Urdu quiz reads Urdu here.
  const { resolveUx } = require('../../config/ux-strings');
  // Same window as the quiz that just finished on this phone: an untracked
  // send here is a send the limiter cannot see, and the whole point of the
  // window is that every send against a pair is counted.
  const rateLimiter = require('./video-quiz-rate-limiter.service');
  await rateLimiter.throttle(phone);
  await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('vqInviteAsk', { language }),
    buttons: [
      { id: INVITE_YES, title: resolveUx('vqInviteYes', { language }) },   // ≤ 20 code points, asserted in tests
      { id: INVITE_NO, title: resolveUx('vqInviteNo', { language }) },
    ],
  });
  // The invite is only ever offered on a share_link session.
  logEvent('video_quiz.offer_shown', { kind: 'invite', sessionId, quizId, source: 'share_link', language });

  // The videos offer must reach this child whether they answer or not. A tap
  // offers it at once (handleInviteButton); silence offers it after
  // VIDEOS_AFTER_SILENCE_SECS through a delayed quiz-queue job that checks the
  // invite is STILL unanswered before it sends. Non-fatal: a queue hiccup
  // costs one offer, never the quiz.
  try {
    const SQSQueueService = require('../queue');
    await SQSQueueService.queueJob(shareCodeId, VIDEOS_JOB, { phone, shareCodeId }, {
      delaySeconds: VIDEOS_AFTER_SILENCE_SECS,
      deduplicationId: `${shareCodeId}-${VIDEOS_JOB}-${stripPlus(phone)}-${Date.now()}`,
    });
  } catch (err) {
    logToFile('⚠️ video-quiz-invite: could not queue the delayed videos offer', { error: err.message });
  }
  return true;
}

/**
 * The videos offer for THIS child, from the invite's own context. Every exit
 * of the invite — yes, no, could-not-mint, and the silence job — ends here.
 */
async function offerVideosFor(phone, ctx) {
  const Binge = require('./video-quiz-binge.service');
  return Binge.offerMore({
    phone, studentId: ctx.studentId, shareCodeId: ctx.shareCodeId, language: ctx.language,
    sessionId: ctx.sessionId ?? null, quizId: ctx.quizId ?? null,
  }).catch((err) => {
    logToFile('⚠️ video-quiz-invite: offerMore threw', { error: err.message });
    return false;
  });
}

/**
 * The delayed job's handler. If the invite is still sitting unanswered, it is
 * consumed here — so a late tap on the invite buttons is a quiet no-op rather
 * than a second videos offer — and the child is offered videos.
 */
async function offerVideosIfUnanswered(phone) {
  const ctx = await redisService.get(INVITE_KEY(phone));
  if (!ctx) return false;
  await redisService.delete(INVITE_KEY(phone));
  logEvent('video_quiz.offer_answered', {
    kind: 'invite', choice: 'ignored', studentId: ctx.studentId, shareCodeId: ctx.shareCodeId,
    sessionId: ctx.sessionId ?? null, quizId: ctx.quizId ?? null,
  });
  await offerVideosFor(phone, ctx);
  return true;
}

/** Mint the invite and hand the child something to forward. */
async function handleInviteButton(buttonId, phone) {
  if (buttonId !== INVITE_YES && buttonId !== INVITE_NO) return false;
  const ctx = await redisService.get(INVITE_KEY(phone));
  await redisService.delete(INVITE_KEY(phone));
  if (!ctx) return true;

  // An old in-flight ctx minted before this deploy has no
  // sessionId/quizId; they simply come out undefined/null here, and the
  // answer still logs cleanly.
  const choice = buttonId === INVITE_YES ? 'yes' : 'no';
  logEvent('video_quiz.offer_answered', {
    kind: 'invite', choice, studentId: ctx.studentId, shareCodeId: ctx.shareCodeId,
    sessionId: ctx.sessionId ?? null, quizId: ctx.quizId ?? null,
  });

  if (buttonId === INVITE_NO) {
    // bd-2475 — a decline chains into "want to watch more?" rather than
    // dead-ending the conversation. Same student/share-code so the next
    // round still attributes to this teacher's report.
    await offerVideosFor(phone, ctx);
    return true;
  }

  const share = require('./video-quiz-share.service');
  const { resolveUx, clampLanguage } = require('../../config/ux-strings');
  const { data: parent } = await supabase
    .from('quiz_share_codes')
    .select('id, quiz_id, video_id, teacher_user_id, teacher_name, topic, language')
    .eq('id', ctx.shareCodeId)
    .maybeSingle();
  if (!parent) { await offerVideosFor(phone, ctx); return true; }
  // Everything below is read by children taking THIS quiz — the inviter, then
  // the friend they forward it to — so it is in the quiz language. The invite
  // context carries it; one minted before it did falls back to the share code.
  const language = clampLanguage(ctx.language || parent.language);
  const ux = (key, params) => resolveUx(key, { language, params });

  const { data: me } = await supabase
    .from('students').select('student_name').eq('id', ctx.studentId).maybeSingle();

  let minted = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = share.randomCode();
    const { data, error } = await supabase.from('quiz_share_codes').insert({
      code,
      quiz_id: parent.quiz_id,
      teacher_user_id: parent.teacher_user_id,
      video_id: parent.video_id,
      teacher_name: parent.teacher_name,
      topic: parent.topic,
      language: parent.language,
      invited_by_student_id: ctx.studentId,
      parent_share_code_id: parent.id,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id, code').single();
    if (!error && data) { minted = data; break; }
    if (error && error.code !== '23505') {
      logToFile('❌ invite: could not mint code', { error: error.message });
      break;
    }
  }
  if (!minted) {
    await WhatsAppService.sendMessage(phone, ux('vqInviteLinkFailed'));
    await offerVideosFor(phone, ctx);
    return true;
  }

  const link = `https://wa.me/${share.botNumber()}?text=QUIZ-${minted.code}`;
  await WhatsAppService.sendMessage(phone, ux('vqInviteForwardThis'));
  await WhatsAppService.sendMessage(phone, ux('vqInviteMessage', {
    name: firstName(me?.student_name, ux('vqInviteFriend')),
    topic: parent.topic || ux('tqTodaysLesson'),
    link,
  }));

  logEvent('video_quiz.friend_invited', {
    inviterStudentId: ctx.studentId, shareCodeId: parent.id, code: minted.code,
  });
  // bd-2yyry.8 — a YES used to end here; the child who invited a friend never
  // heard about the videos. The offer follows the forwardable message.
  await offerVideosFor(phone, ctx);
  return true;
}

/**
 * Turn a scanned code into "which teacher's quiz is this, and who sent me?".
 *
 * A teacher code resolves to itself with no inviter. An invite resolves to its
 * PARENT, which is what keeps the class report whole.
 */
async function resolveInvite(code) {
  const { data: sc } = await supabase
    .from('quiz_share_codes')
    .select('id, code, quiz_id, video_id, teacher_user_id, teacher_name, topic, '
            + 'language, active, expires_at, invited_by_student_id, parent_share_code_id')
    .eq('code', code)
    .maybeSingle();
  if (!sc) return null;
  return {
    ...sc,
    shareCodeId: sc.parent_share_code_id || sc.id,
    invitedByStudentId: sc.invited_by_student_id || null,
  };
}

/**
 * The message an inviter gets once their friend finishes.
 *
 * Never framed as a defeat. Children show these to each other, and a line that
 * reads as "you lost" turns a quiz into something to avoid.
 */
function buildComparison({ inviter, friend, topic, language = 'en' }) {
  // In the quiz's language: the inviter took the same quiz, in that language.
  const { resolveUx } = require('../../config/ux-strings');
  const ux = (key, params) => resolveUx(key, { language, params });
  const them = firstName(friend.student_name, ux('vqInviteFriend'));
  const theirs = friend.correct_answers || 0;
  const outOf = friend.total_questions_answered || 0;
  const mine = inviter.correct_answers || 0;

  let line;
  if (theirs > mine) {
    line = ux('vqCompareBehind', { them });
  } else if (theirs < mine) {
    line = ux('vqCompareAhead');
  } else {
    line = ux('vqCompareTie');
  }

  return ux('vqCompareMessage', { them, theirs, outOf, mine, line });
}

/**
 * Tell the inviter how their friend did. Best-effort throughout — this is a
 * nicety, and nothing about the friend's own quiz should fail because of it.
 *
 * `language` is the quiz's: the friend just took it in that language, and the
 * inviter took the same quiz. quiz_sessions carries no language, so the caller
 * (finish(), which holds the session state) passes it.
 */
async function notifyInviter(session, language = 'en') {
  try {
    if (!session || !session.invited_by_student_id) return false;
    const { data: inviterStudent } = await supabase
      .from('students').select('id, student_name, phone')
      .eq('id', session.invited_by_student_id).maybeSingle();
    if (!inviterStudent?.phone) return false;

    // The inviter's own run of the SAME quiz, for the comparison.
    const { data: mine } = await supabase
      .from('quiz_sessions')
      .select('correct_answers, total_questions_answered, mastery_percentage')
      .eq('student_id', inviterStudent.id)
      .eq('quiz_id', session.quiz_id)
      .eq('status', 'completed')
      .limit(1);
    const inviterRun = (mine || [])[0];
    if (!inviterRun) return false;   // nothing to compare against

    await WhatsAppService.sendMessage(inviterStudent.phone,
      buildComparison({ inviter: inviterRun, friend: session, topic: session.topic, language }));

    logEvent('video_quiz.invite_result_sent', {
      inviterStudentId: inviterStudent.id, quizId: session.quiz_id, language,
    });
    return true;
  } catch (err) {
    logToFile('⚠️ could not tell the inviter how their friend did', {
      error: err.message,
    });
    return false;
  }
}

module.exports = {
  offerInvite, handleInviteButton, resolveInvite, buildComparison,
  notifyInviter, offerVideosIfUnanswered, firstName,
  INVITE_YES, INVITE_NO, INVITE_KEY, VIDEOS_JOB, VIDEOS_AFTER_SILENCE_SECS,
};
