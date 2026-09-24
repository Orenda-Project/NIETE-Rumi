'use strict';
/**
 * WHO IS HOLDING THIS HANDSET — decided ONCE, at the door.
 *
 * The student persona used to be consulted at a single call site at the tail
 * of free chat. Everything above that line — voice notes, the lesson-plan menu,
 * coaching, every button — never saw it, so a child who tapped a class link
 * and then sent a voice note was transcribed and answered as a teacher, and
 * hundreds of child handsets pulled pre-built lesson plans from the menu.
 *
 * This module classifies the handset right after the users row is loaded in
 * whatsapp-bot.js and, for a child, routes the message itself. The rules are
 * the operator's three (14 Sep 2026), made precise on the live data:
 *
 *   identity(user)   -> TEACHER   registration_completed | registration_state
 *                                 'completed' | a name | teacher_uuid | school_id |
 *                                 portal_activated | role coach/principal.
 *                                 NEVER bare role === 'teacher': it is the default
 *                                 on 14,154 of 14,951 rows.
 *   activity(user)   -> TEACHER   owns a quiz | a coaching session | a lesson plan
 *                                 WITH a gamma/pdf url (URL-less lp-v8 rows are the
 *                                 pre-built K-5 plans a child can pull) | a roster
 *                                 list | a training attempt | an assessment request.
 *   neither, AND an active quiz-joined students row on the handset -> STUDENT
 *   else             -> UNKNOWN   (today's behaviour; a cold first message
 *                                 still reaches registration)
 *
 * Measured on the prod replica, 14 Sep 2026: over the 3,534 handsets that had
 * taken a quiz, these rules put 0 known teachers in student mode and left 0
 * children on the teacher persona. THE ONE THING THIS MODULE MUST NEVER DO IS
 * LOCK A TEACHER OUT, so every failure resolves towards teacher: a lookup
 * error is UNKNOWN, a missing users row is UNKNOWN, the flag off is UNKNOWN,
 * and a first-person "I am a teacher" / a registration keyword is honoured
 * before any rule runs (student-mode.service looksLikeTeacherClaim).
 *
 * What a child can do (route()): join a quiz by its code and answer it, take
 * the videos path (/video and its Flow), answer the invite / watch-more /
 * feedback buttons, open the child menu, and ask a school question (the child
 * tutor prompt). Everything else — a voice note, an image, a document, every
 * other command and button — gets ONE short line in the quiz language.
 *
 * Behind STUDENT_MODE_ENABLED (unset = off): with the flag off classify()
 * reads nothing and route() is a no-op.
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx } = require('../config/ux-strings');
const StudentMode = require('./student-mode.service');

/** A verdict is cached per handset so a child's every message does not cost six head counts. */
const CACHE_TTL_SECS = 10 * 60;
const CACHE_KEY = (phone) => `student_ingress:${String(phone || '').replace(/^\+/, '')}`;

const IDENTITY_FIELDS = ['registration_completed', 'registration_state', 'name', 'teacher_uuid',
  'school_id', 'portal_activated', 'role'];

/** Any real sign that an ADULT registered or was rostered on this row. */
function identity(user) {
  if (!user) return false;
  return Boolean(
    user.registration_completed === true
    || user.registration_state === 'completed'
    || (typeof user.name === 'string' && user.name.trim())
    || user.teacher_uuid
    || user.school_id
    || user.portal_activated === true
    || user.role === 'coach' || user.role === 'principal',
  );
}

/**
 * Does this user own a row in `table` under `column` (optionally with an extra
 * `.or()` filter)? Head count only. null means the read FAILED — never
 * collapsed into "no rows": that collapse is how a teacher becomes a child
 * during a database hiccup.
 */
async function hasAnyRow(table, column, id, orFilter = null) {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, id);
    if (orFilter) q = q.or(orFilter);
    const { count, error } = await q;
    if (error) {
      logToFile('⚠️ student-ingress: activity lookup failed', { table, error: error.message });
      return null;
    }
    return (count || 0) > 0;
  } catch (err) {
    logToFile('⚠️ student-ingress: activity lookup threw', { table, error: err.message });
    return null;
  }
}

/** Teacher activity on this user id. true / false / null (a read failed). */
async function activity(userId) {
  if (!userId) return false;
  const checks = [
    ['quizzes', 'teacher_id', null],
    ['coaching_sessions', 'user_id', null],
    ['lesson_plans', 'user_id', 'gamma_url.not.is.null,pdf_url.not.is.null'],
    ['student_lists', 'user_id', null],
    ['training_assessment_attempts', 'user_id', null],
    ['assessment_requests', 'user_id', null],
  ];
  for (const [table, column, orFilter] of checks) {
    const r = await hasAnyRow(table, column, userId, orFilter);
    if (r === null) return null;
    if (r) return true;
  }
  return false;
}

/**
 * The users row from getOrCreateUser may not carry every identity column; if
 * one is missing, read them once rather than guess "no identity".
 */
async function withIdentityFields(user) {
  if (!user || !user.id) return user;
  const missing = IDENTITY_FIELDS.some((f) => !(f in user));
  if (!missing) return user;
  try {
    const { data, error } = await supabase.from('users').select(IDENTITY_FIELDS.join(','))
      .eq('id', user.id).maybeSingle();
    if (error || !data) return null;            // unknown, towards teacher
    return { ...user, ...data };
  } catch (err) {
    logToFile('⚠️ student-ingress: identity read threw', { error: err.message });
    return null;
  }
}

const NONE = (mode, reason) => ({ persona: null, mode, reason, language: null, studentClass: null });

/**
 * THE DECISION. Never throws. `persona` is 'student' only for a proven child;
 * every other outcome is null, which the caller treats as "today".
 *
 * @returns {Promise<{persona:'student'|null, mode:'teacher'|'student'|'unknown', reason:string,
 *                    language:string|null, studentClass:string|null}>}
 */
async function classify({ user, phone } = {}) {
  if (!StudentMode.isEnabled()) return NONE('unknown', 'flag_off');
  if (!user) return NONE('unknown', 'no_user');
  try {
    const cached = await Promise.resolve(redisService.get(CACHE_KEY(phone))).catch(() => null);
    if (cached && cached.mode) return cached;

    const full = await withIdentityFields(user);
    if (!full) return NONE('unknown', 'identity_read_failed');
    let verdict;
    if (identity(full)) {
      verdict = NONE('teacher', 'identity');
    } else {
      const act = await activity(full.id);
      if (act === null) return NONE('unknown', 'lookup_failed');      // not cached
      if (act) {
        verdict = NONE('teacher', 'activity');
      } else {
        const students = await StudentMode.quizStudentsForPhone(phone);
        if (!students.length) {
          verdict = NONE('unknown', 'no_student_row');
        } else {
          const { language, studentClass } = await StudentMode.lastQuizSessionForStudents(students.map((s) => s.id));
          verdict = {
            persona: 'student', mode: 'student', reason: 'no_identity_quiz_joined',
            language: language || null,
            studentClass: studentClass || students[0].self_reported_class || null,
          };
        }
      }
    }
    await Promise.resolve(redisService.set(CACHE_KEY(phone), verdict, CACHE_TTL_SECS)).catch(() => {});
    logEvent('student_ingress.decided', { mode: verdict.mode, reason: verdict.reason, userId: full.id });
    return verdict;
  } catch (err) {
    logToFile('⚠️ student-ingress: classify threw (non-fatal, towards teacher)', { error: err.message });
    return NONE('unknown', 'error');
  }
}

async function forget(phone) {
  await Promise.resolve(redisService.delete(CACHE_KEY(phone))).catch(() => {});
}

/** Attach the verdict to the users row so every handler reads one answer. */
async function attach(user, phone) {
  if (!user) return user;
  const v = await classify({ user, phone });
  user.persona = v.persona;                 // 'student' | null
  user.personaLanguage = v.language;
  user.personaClass = v.studentClass;
  user.personaReason = v.reason;
  return user;
}

// ── the child's own routes ────────────────────────────────────────────────

const ALLOWED_BUTTON_PREFIXES = ['vq_', 'student_video_feedback_'];
const CHILD_MENU_VIDEO = 'child_menu_video';
const CHILD_MENU_QUIZ = 'child_menu_quiz';

function childLanguage(user) {
  return user?.personaLanguage || user?.preferred_language || 'en';
}

async function say(from, key, language, params) {
  const WhatsAppService = require('./whatsapp.service');
  await WhatsAppService.sendMessage(from, resolveUx(key, { language, params }));
}

async function sendChildMenu(from, language) {
  const WhatsAppService = require('./whatsapp.service');
  await WhatsAppService.sendInteractiveButtons(from, {
    body: resolveUx('studentMenuBody', { language }),
    buttons: [
      { id: CHILD_MENU_VIDEO, title: resolveUx('studentMenuVideos', { language }) },   // ≤ 20 code points
      { id: CHILD_MENU_QUIZ, title: resolveUx('studentMenuQuizzes', { language }) },
    ],
  });
}

const StudentQuizIds = { RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' };

/** The child's /quiz (bd-2yyry.13): the Flow, or the two-button fallback. */
async function openQuizzes(from, language) {
  const StudentQuiz = require('./quiz/student-quiz.service');
  await StudentQuiz.open(from, { language });
}

async function openVideos(from, language) {
  const { tryChildVideoMenu } = require('../handlers/text-message.handler');
  const opened = await tryChildVideoMenu(from, language);
  if (!opened) await say(from, 'studentVideosUnavailable', language);
}

/** Is a quiz, a join, or a post-quiz chat in flight on this handset? Those paths keep their own rules. */
async function quizInFlight(from) {
  try {
    const QuizSessionService = require('./quiz/quiz-session.service');
    if (await QuizSessionService.getActiveState(from)) return true;
    if (await QuizSessionService.getPostQuizState(from)) return true;
    // A class-link quiz runs on the VIDEO engine, whose state is its own key —
    // the adaptive engine above does not see it. While a question is waiting,
    // a typed "B" is that question's answer and must reach the quiz chain.
    const VideoQuizService = require('./quiz/video-quiz.service');
    const video = await VideoQuizService.getActiveState(from);
    if (video && video.currentQuestionId) return true;
    const VideoQuizShare = require('./quiz/video-quiz-share.service');
    if (await redisService.get(VideoQuizShare.JOIN_KEY(from))) return true;
  } catch (err) {
    logToFile('⚠️ student-ingress: in-flight check threw (letting the message through)', { error: err.message });
    return true;
  }
  return false;
}

async function refuse(from, language, what, key) {
  logEvent('student_ingress.refused', { what });
  await say(from, key, language);
  return true;
}

/**
 * Route a CHILD's message. Returns true when it answered the message itself
 * (the caller returns); false when the ordinary dispatch should run. For any
 * handset that is not a proven child this is a no-op.
 */
async function route({ message, messageType, messageBody = '', from, user } = {}) {
  if (!user || user.persona !== 'student') return false;
  const language = childLanguage(user);
  const type = messageType || (message && message.type) || '';

  try {
    if (type === 'text') {
      const body = String(messageBody || '').trim();
      if (!body) return false;

      // The escape hatch, before anything else: taken at their word, rows
      // retired, the cached verdict dropped, and the ordinary path runs.
      // A slash command is NOT a claim here — looksLikeTeacherClaim() treats
      // every "/x" as teacher vocabulary because it was written for a path no
      // command could reach; at the door a child's /video must never retire
      // their row. Only /register (and its keyword) is the way out.
      const isCommand = body.startsWith('/');
      const isRegister = /^\/register(?:\s|$)/i.test(body);
      if (isRegister || (!isCommand && StudentMode.looksLikeTeacherClaim(body))) {
        const retired = await StudentMode.retireQuizStudentRows(from, 'teacher_claim');
        await forget(from);
        user.persona = null;
        logEvent('student_mode.escaped', { reason: 'teacher_claim', retired, userId: user.id || null });
        return false;
      }

      const VideoQuizShare = require('./quiz/video-quiz-share.service');
      if (VideoQuizShare.parseShareCode(body)) return false;        // a quiz link tapped
      if (await quizInFlight(from)) return false;                   // answers, join replies, post-quiz chat

      if (body.startsWith('/')) {
        const cmd = body.split(/\s+/)[0].toLowerCase();
        if (cmd === '/video' || cmd === '/videos') return false;    // the handler's child videos path
        if (cmd === '/menu') { await sendChildMenu(from, language); return true; }
        if (cmd === '/quiz') { await openQuizzes(from, language); return true; }
        return refuse(from, language, `command:${cmd}`, 'studentTeacherOnly');
      }

      // A school question: the child tutor, directly. The ordinary text path
      // would first offer registration, lesson plans and coaching on the way.
      const { handleGeneralConversation } = require('../handlers/text-message.handler');
      const { getOrCreateSession, storeConversation } = require('../database/bot-helpers');
      const WhatsAppService = require('./whatsapp.service');
      let sessionId = null;
      try {
        sessionId = await getOrCreateSession(user.id);
        await storeConversation(user.id, 'user', body, 'text', sessionId);
      } catch (err) {
        logToFile('⚠️ student-ingress: session/store failed (answering anyway)', { error: err.message });
      }
      const typing = WhatsAppService.startContinuousTypingIndicator(from, message && message.id);
      try {
        await handleGeneralConversation(from, body, user, sessionId, language, typing);
      } finally {
        if (typing && typing.stop) typing.stop();
      }
      return true;
    }

    if (type === 'audio' || type === 'voice') {
      return refuse(from, language, 'voice', 'studentVoiceNotSupported');
    }
    if (type === 'image' || type === 'document' || type === 'video' || type === 'sticker') {
      return refuse(from, language, type, 'studentMediaNotSupported');
    }

    if (type === 'interactive') {
      const kind = message && message.interactive && message.interactive.type;
      if (kind === 'button_reply') {
        const id = String(message.interactive.button_reply.id || '');
        if (id === CHILD_MENU_VIDEO) { await openVideos(from, language); return true; }
        if (id === CHILD_MENU_QUIZ) { await openQuizzes(from, language); return true; }
        if (id === StudentQuizIds.RETRY_ID || id === StudentQuizIds.CARD_ID) {
          const StudentQuiz = require('./quiz/student-quiz.service');
          await StudentQuiz.handleButton(id, from);
          return true;
        }
        if (ALLOWED_BUTTON_PREFIXES.some((p) => id.startsWith(p))) return false;
        return refuse(from, language, `button:${id.split('_').slice(0, 2).join('_')}`, 'studentTeacherOnly');
      }
      // A Flow or list reply answers something WE sent this handset.
      return false;
    }
    return false;
  } catch (err) {
    // Fail towards today's behaviour rather than silence.
    logToFile('⚠️ student-ingress: route threw (falling through)', { error: err.message });
    return false;
  }
}

module.exports = {
  identity, activity, classify, attach, route, forget,
  CACHE_KEY, CACHE_TTL_SECS, CHILD_MENU_VIDEO, CHILD_MENU_QUIZ, ALLOWED_BUTTON_PREFIXES,
};
