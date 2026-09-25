'use strict';
/**
 * Where a request for the quiz menu goes — ONE decision, whoever holds the phone.
 *
 * The text door (`text-message.handler.js`) hands every bare quiz request
 * (`quiz-menu-request.js`) here. Four answers, checked in this order:
 *
 *  1. A quiz QUESTION IS WAITING on this handset → stay in the quiz. One line in
 *     the quiz's own language, nothing else. Checked before the role because
 *     children take class quizzes on their teachers' phones (in production the
 *     adaptive-engine adoptions of 14–24 Sep were exactly that), so "who is
 *     typing" is unknowable here and the quiz in progress is the thing to keep.
 *  2. A PROVEN CHILD (student ingress persona) → the child's own quiz list, the
 *     same thing `/quiz` gives a child.
 *  3. A ROLE WITH NO QUIZ OF ITS OWN (coach, school leader, AEO, supervisor —
 *     `canSelfCoach` false) → that role's own menu. Their menu layout has no
 *     quiz row; "record a lesson for coaching first" was never true for them.
 *  4. EVERYONE ELSE → the teacher's /quiz menu: the Flow when
 *     TRANSCRIPT_QUIZ_FLOW_ID is set and there is something to list, the
 *     interactive list message otherwise (the rollback lever, unchanged).
 *
 * Every answer logs `quiz_menu.requested {userId, route}` — ids only.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { canSelfCoach } = require('../../config/role-features');
const QuizMenuFlags = require('./quiz-menu-flags');

const ROUTES = Object.freeze({
  STILL_IN_QUIZ: 'still_in_quiz',
  CHILD_QUIZZES: 'child_quizzes',
  ROLE_MENU: 'role_menu',
  TEACHER_MENU: 'teacher_menu',
});

/** The question a quiz on this handset is waiting on, or null. Never throws. */
async function waitingQuestion(from) {
  try {
    const VideoQuizService = require('./video-quiz.service');
    const state = await VideoQuizService.getActiveState(from);
    return state && state.currentQuestionId ? state : null;
  } catch (err) {
    // A state read that failed is not "no quiz": the menu below is the safe
    // default only because a reminder we cannot ground would be a guess.
    logToFile('❌ quiz menu: quiz-state read failed — answering with the menu', { error: err.message }, 'error');
    return null;
  }
}

/**
 * @param {object} args
 * @param {object} args.user       the users row (with the ingress `persona`, when set)
 * @param {string} args.from       the handset
 * @param {string|null} args.language the teacher's resolved language
 * @param {string|null} [args.sessionId] the chat session, for the role menu
 * @param {string} [args.trigger]  what asked: 'text' | 'ingress' (log only)
 * @returns {Promise<string>} the route taken (ROUTES)
 */
async function openQuizMenu({ user, from, language = null, sessionId = null, trigger = 'text' }) {
  const userId = (user && user.id) || null;
  const log = (route, extra = {}) => logEvent('quiz_menu.requested', { userId, route, trigger, ...extra });

  // QUIZ_MENU_HANDSET_ROUTING off: every handset gets the teacher menu, as before.
  const routing = QuizMenuFlags.handsetRouting();
  const live = routing ? await waitingQuestion(from) : null;
  if (live) {
    const lang = clampLanguage(live.language || language);
    await WhatsAppService.sendMessage(from, resolveUx('vqStillInQuiz', { language: lang }));
    log(ROUTES.STILL_IN_QUIZ, { quizSessionId: live.sessionId || null });
    return ROUTES.STILL_IN_QUIZ;
  }

  if (routing && user && user.persona === 'student') {
    const StudentQuiz = require('./student-quiz.service');
    await StudentQuiz.open(from, { language: clampLanguage(user.personaLanguage || user.preferred_language || language) });
    log(ROUTES.CHILD_QUIZZES);
    return ROUTES.CHILD_QUIZZES;
  }

  if (routing && user && !canSelfCoach(user)) {
    const MenuService = require('../menu.service');
    await MenuService.sendMenu(from, user.id, sessionId, clampLanguage(language || user.preferred_language), user);
    log(ROUTES.ROLE_MENU, { role: String(user.role || '') });
    return ROUTES.ROLE_MENU;
  }

  const List = require('./transcript-quiz-list.service');
  const teacher = { ...user, preferred_language: language || (user && user.preferred_language) };
  const flowId = process.env.TRANSCRIPT_QUIZ_FLOW_ID || '';
  // A NavigationList needs at least one item, so a teacher with nothing to
  // list is answered in chat by the list path ("no lessons yet").
  if (flowId && await List.hasEligibleLessons(userId)) {
    const uxLanguage = teacher.preferred_language;
    await WhatsAppService.sendFlow(from, {
      flowId,
      header: resolveUx('tqFlowChatHeader', { language: uxLanguage }),
      body: resolveUx('tqFlowChatBody', { language: uxLanguage }),
      buttonText: resolveUx('tqFlowChatCta', { language: uxLanguage }),
      flowToken: `${userId}:transcript-quiz:${Date.now()}`,
    });
    logToFile('📝 sent transcript quiz flow (/quiz)', { userId });
    log(ROUTES.TEACHER_MENU, { how: 'flow' });
    return ROUTES.TEACHER_MENU;
  }
  await List.showList(teacher, from, language);
  log(ROUTES.TEACHER_MENU, { how: 'list' });
  return ROUTES.TEACHER_MENU;
}

module.exports = { openQuizMenu };
