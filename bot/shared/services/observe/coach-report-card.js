'use strict';
/**
 * Today's WhatsApp report card for a coach's debrief: the praise, then the rendered celebration card (or the text card).
 * Moved here unchanged from observe-debrief.service._deliverCoachFeedback (bd-9652yj, queue #166) so that BOTH the
 * debrief job and a coach's reply 1 to the report-ready line (coach-report-whatsapp.sendReportCardHere) send it,
 * without the two services requiring each other.
 */

const WhatsAppService = require('../whatsapp.service');

/** True when every part went. */
async function sendCoachReportPicture(from, feedback, S, framework, lang = 'en') {
  const { renderCoachFeedbackMessages } = require('./observe-coach-feedback');
  const [praiseMsg, cardMsg] = renderCoachFeedbackMessages(feedback, S);
  // Today's praise message, then the picture (staging sends the praise on its own; the report link replaces both,
  // so this goes only when the link does not).
  const sentPraise = await WhatsAppService.sendMessage(from, praiseMsg);

  // The celebration card ships as a rendered image (hero design,
  // value-anchored). renderCoachCard returns null for harmful debriefs and on
  // any render failure — both fall back to the text card, so an officer can
  // never lose their feedback to a Playwright hiccup. Harm gate unchanged.
  // The card carries the framework's brand (fico → niete), same
  // routing as the hero report — one session, one brand, every surface.
  let sentCard = false;
  const { renderCoachCard } = require('./observe-coach-card');
  const { heroBrandFor } = require('../coaching/report-renderers/renderer-registry');
  // bd-y7jr8: the language is PASSED now. It used to be reverse-engineered by
  // string-matching S.coach_card_wins_label against a hardcoded Urdu literal —
  // so re-labelling the card silently flipped Urdu coaches to the English one.
  // Same failure shape as the tofu-box bug, one layer up.
  const png = await renderCoachCard(feedback, { lang, brand: heroBrandFor(framework) });
  if (png) {
    sentCard = await WhatsAppService.sendImageFromBuffer(from, png, S.coach_card_closing);
  }
  if (!png || sentCard === false) {
    sentCard = await WhatsAppService.sendMessage(from, cardMsg);
  }
  return !(sentPraise === false || sentCard === false);
}

module.exports = { sendCoachReportPicture };
