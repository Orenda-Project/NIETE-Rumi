'use strict';
/**
 * Make a quiz — what /quiz has always sent a teacher, and what the /quiz home's
 * "Make a quiz" button sends. Its own module so quiz-menu-entry (the /quiz door)
 * and teacher-quiz-home (the home's buttons) both call it without requiring each
 * other.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { resolveUx } = require('../../config/ux-strings');

/**
 * Make a quiz: the Flow when TRANSCRIPT_QUIZ_FLOW_ID is set and there is
 * something to list, the interactive list message otherwise. What /quiz has
 * always sent a teacher, and what the home's "Make a quiz" sends.
 * @returns {Promise<'flow'|'list'>}
 */
async function openMakeQuiz({ user, from, language = null }) {
  const userId = (user && user.id) || null;
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
    return 'flow';
  }
  await List.showList(teacher, from, language);
  return 'list';
}

module.exports = { openMakeQuiz };
