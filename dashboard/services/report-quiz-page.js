'use strict';
/**
 * qfix offers — the quiz-only page (/cq/:token) the closed-window report's "Make a quiz" button opens for a teacher
 * who does not get the new report (v10 arms A/B, schools outside the draw; bot quiz/report-page-quiz.js). It shows
 * the lesson and the quiz, nothing of the report, so the v10 report arms stay as they are.
 *   makeQuiz      the offer is still held → "Make a quiz" (wa.me to the bot, her prefill with the session's code)
 *   quizMessage   the quiz is made → the message to send to her class, as the report card shows it
 *   neither       the /quiz door, in the words WhatsApp uses
 * Pure HTML; every value escaped. Rendered by dashboard/routes/coaching-report.routes.js.
 */
const { esc, shell } = require('./coaching-report-style');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

function renderQuizPage({ language, topic, makeQuiz, quizMessage } = {}) {
  const l = language === 'ur' ? 'ur' : 'en';
  const ux = (key) => esc(resolveUx(key, { language: l }));
  const parts = [`<header><section><h1>${ux('qfix_offers_cr_quiz_head')}</h1>${topic ? `<p class="muted">${esc(topic)}</p>` : ''}</section></header>`];
  if (typeof quizMessage === 'string' && quizMessage.trim()) {
    const share = `https://wa.me/?text=${encodeURIComponent(quizMessage)}`;
    parts.push(`<section><p>${esc(quizMessage)}</p><a class="btn" href="${esc(share)}">${ux('qfix_offers_cq_send')}</a></section>`);
  } else if (makeQuiz) {
    parts.push(`<section><p>${ux('qfix_offers_cr_quiz_body')}</p><a class="btn" href="${esc(makeQuiz)}">${ux('qfix_offers_cr_quiz_button')}</a></section>`);
  } else {
    parts.push(`<section><p>${ux('tqOfferExpired')}</p></section>`);
  }
  return shell(l, resolveUx('qfix_offers_cr_quiz_head', { language: l }), parts.join('\n'));
}

module.exports = { renderQuizPage };
