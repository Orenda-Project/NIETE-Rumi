'use strict';
/**
 * The teacher's /quiz HOME (W37, M3 SPEC §1): one message, three reply buttons.
 *
 *   tqh_make     Make a quiz      → /quiz as it has always been (the Flow, or
 *                                   the lesson list) — teacher-quiz-make openMakeQuiz
 *   tqh_reports  My quiz reports  → the sent quizzes, each with who played and
 *                                   the average; a tap sends that quiz's report link
 *   tqh_class    Class progress   → the report link for all the teacher's classes
 *
 * Three reply buttons, not a list: one tap instead of two. Shown only to the
 * teachers app_settings `teacher_report_teachers` covers (teacher-report-gate);
 * for everyone else /quiz is exactly what it was. A button from an old home
 * tapped after the switch went off makes a quiz — today's /quiz — rather than
 * sending a report link the switch now withholds.
 *
 * Events (ids only): quiz_menu.home_shown {userId}, quiz_menu.choice {userId, choice}.
 */

const WhatsAppService = require('../whatsapp.service');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { teacherLanguageFor } = require('./transcript-quiz-language');
const Gate = require('./teacher-report-gate');

const MAKE = 'tqh_make';
const REPORTS = 'tqh_reports';
const CLASS = 'tqh_class';
const CHOICES = Object.freeze({ [MAKE]: 'make', [REPORTS]: 'reports', [CLASS]: 'class' });
const PREFIX = 'tqh_';

/** True when this teacher gets the home. Never throws (fails closed). */
async function homeOn(teacherUserId) {
  return Gate.teacherReportOn(teacherUserId);
}

function langOf(user, language = null) {
  return teacherLanguageFor({ preferredLanguage: language || (user && user.preferred_language) });
}

async function sendHome(user, from, language = null) {
  const lang = langOf(user, language);
  await WhatsAppService.sendInteractiveButtons(from, {
    // sendInteractiveButtons sends no header, so the title is the body's first line.
    body: resolveUx('tqhBody', { language: lang }),
    buttons: [
      { id: MAKE, title: resolveUx('tqhMake', { language: lang }) },
      { id: REPORTS, title: resolveUx('tqhReports', { language: lang }) },
      { id: CLASS, title: resolveUx('tqhClass', { language: lang }) },
    ],
  });
  logEvent('quiz_menu.home_shown', { userId: (user && user.id) || null });
  return true;
}

/**
 * A tap on one of the home's buttons. False for any id the home does not own,
 * so the router can keep looking.
 */
async function handleHomeButton(buttonId, from, user) {
  const choice = CHOICES[buttonId];
  if (!choice) return false;
  const userId = (user && user.id) || null;
  logEvent('quiz_menu.choice', { userId, choice });
  const lang = langOf(user);
  if (choice === 'make' || !(await homeOn(userId))) {
    const { openMakeQuiz } = require('./teacher-quiz-make.service');
    await openMakeQuiz({ user, from, language: lang });
    return true;
  }
  if (choice === 'reports') {
    const ReportList = require('./teacher-report-list.service');
    await ReportList.showReports(user, from, lang, 1);
    return true;
  }
  const Link = require('./teacher-report-link');
  await Link.sendTeacherReportLink({
    teacher: user, phone: from, quizId: null, topic: resolveUx('tqrAllClasses', { language: lang }), language: lang,
  });
  return true;
}

module.exports = {
  homeOn, sendHome, handleHomeButton, MAKE, REPORTS, CLASS, PREFIX,
};
