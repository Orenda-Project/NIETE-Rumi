'use strict';
/**
 * Today's WhatsApp report card for a coach's debrief: the praise and the rendered celebration card (or the text card).
 * Moved here unchanged from observe-debrief.service._deliverCoachFeedback (bd-9652yj, queue #166) so that BOTH the
 * debrief job and a coach's reply 1 to the report-ready line (coach-report-whatsapp.sendReportCardHere) send it,
 * without the two services requiring each other.
 */

const WhatsAppService = require('../whatsapp.service');

/**
 * Today's WhatsApp report card: the praise and the rendered card (or the text card). True when every part went.
 * The debrief job sends it on delivery; bd-9652yj — a coach's reply 1 to the report-ready line sends it again, here.
 */
async function sendCoachReportPicture(from, feedback, S, framework, lang = 'en') {
  const { renderCoachFeedbackMessages } = require('./observe-coach-feedback');
  const [praiseMsg, cardMsg] = renderCoachFeedbackMessages(feedback, S);
  // bd-44: the celebration card ships as a rendered image (hero design,
  // value-anchored). renderCoachCard returns null for harmful debriefs and on
  // any render failure — both fall back to the text card, so an officer can
  // never lose their feedback to a Playwright hiccup. Harm gate unchanged.
  // bd-2453: the card carries the framework's brand (fico → niete), same
  // routing as the hero report — one session, one brand, every surface.
  let sentCard = false;
  const { renderCoachCard } = require('./observe-coach-card');
  const { heroBrandFor } = require('../coaching/report-renderers/renderer-registry');
  // bd-y7jr8: the language is PASSED now. It used to be reverse-engineered by
  // string-matching S.coach_card_wins_label against a hardcoded Urdu literal —
  // so re-labelling the card silently flipped Urdu coaches to the English one.
  // Same failure shape as bd-2644 (tofu boxes), one layer up.
  const png = await renderCoachCard(feedback, { lang, brand: heroBrandFor(framework) });

  // The praise line rides on the card: its caption is the praise, then the
  // card's closing line — one message where there were two, every word kept.
  // Only with a rendered card (never on the harmful path, where renderCoachCard
  // returns null) and only when the caption fits 1,024 code points; otherwise the
  // praise goes first as its own message, exactly as before.
  // ur/en: the caption also carries the next focus's Coach Training module link (an image cannot be tapped).
  const { coachCardCaption } = require('./observe-coach-feedback');
  const praiseCaption = png ? coachCardCaption(praiseMsg, feedback, S) : null;
  let sentPraise = true;
  if (!praiseCaption) sentPraise = await WhatsAppService.sendMessage(from, praiseMsg);
  if (png) {
    sentCard = await WhatsAppService.sendImageFromBuffer(from, png, praiseCaption || coachCardCaption(null, feedback, S) || S.coach_card_closing);
  }
  if (!png || sentCard === false) {
    // The card image was refused: if the praise was riding on it, it goes first.
    if (praiseCaption) sentPraise = await WhatsAppService.sendMessage(from, praiseMsg);
    sentCard = await WhatsAppService.sendMessage(from, cardMsg);
  }
  return !(sentPraise === false || sentCard === false);
}

module.exports = { sendCoachReportPicture };
