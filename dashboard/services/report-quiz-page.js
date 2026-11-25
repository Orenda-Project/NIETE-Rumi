'use strict';
/**
 * qfix offers — the quiz-only page (/cq/:token) the closed-window report's "Make a quiz" button opens for a teacher
 * who does not get the new report (v10 arms A/B, schools outside the draw; bot quiz/report-page-quiz.js). It shows
 * the lesson and the quiz, nothing of the report, so the v10 report arms stay as they are.
 *   makeQuiz      the offer is still held → "Make a quiz" (wa.me to the bot, the prefill with the session's code)
 *   quizMessage   the quiz is made → the message to send to the class, as the report card shows it
 *   neither       the /quiz door in the page's own noun (کوئز), and a button to WhatsApp
 * Pure HTML; every value escaped. Rendered by dashboard/routes/coaching-report.routes.js.
 */
const { esc, shell } = require('./coaching-report-style');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

// The new buttons only: the page's shared a.btn is 44 px tall in English, under the 48 px touch target.
const QZ_CSS = '<style>.qz a.btn{display:inline-block;min-height:48px;box-sizing:border-box;padding:12px 16px}</style>';

function renderQuizPage({ language, topic, makeQuiz, quizMessage, bot } = {}) {
  const l = language === 'ur' ? 'ur' : 'en';
  const ux = (key) => esc(resolveUx(key, { language: l }));
  const parts = [`<header><section><h1>${ux('qfix_offers_cr_quiz_head')}</h1>${topic ? `<p class="muted">${esc(topic)}</p>` : ''}</section></header>`];
  if (typeof quizMessage === 'string' && quizMessage.trim()) {
    const share = `https://wa.me/?text=${encodeURIComponent(quizMessage)}`;
    parts.push(`<section class="qz">${QZ_CSS}<p>${esc(quizMessage)}</p><a class="btn" href="${esc(share)}">${ux('qfix_offers_cq_send')}</a></section>`);
  } else if (makeQuiz) {
    parts.push(`<section class="qz">${QZ_CSS}<p>${ux('qfix_offers_cr_quiz_body')}</p><a class="btn" href="${esc(makeQuiz)}">${ux('qfix_offers_cr_quiz_button')}</a></section>`);
  } else {
    const wa = bot ? `<a class="btn" href="${esc(`https://wa.me/${bot}?text=${encodeURIComponent('/quiz')}`)}">${ux('qfix_offers_cq_open_wa')}</a>` : '';
    parts.push(`<section class="qz">${QZ_CSS}<p>${ux('qfix_offers_cq_none')}</p>${wa}</section>`);
  }
  return shell(l, resolveUx('qfix_offers_cr_quiz_head', { language: l }), parts.join('\n'));
}

module.exports = { renderQuizPage, QZ_CSS };
