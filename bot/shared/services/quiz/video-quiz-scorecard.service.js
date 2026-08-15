'use strict';
/**
 * bd-2474 — the scorecard was designed (mockups/out/scorecard_src.html,
 * 09_scorecard.png showing the full intended WhatsApp sequence) but never
 * wired into finish() — a child who completes a video quiz has only ever
 * gotten a plain text summary. This renders the designed navy/gold card and
 * sends it in place of that text, with the same message as its caption.
 *
 * Best-effort throughout, same contract as the rest of finish()'s
 * post-completion side effects (notifyInviter, offerInvite, offerShare): a
 * render or send failure must never cost the child their result. On any
 * failure this falls back to the plain text finish() sent before this
 * feature existed, so "nothing" is never a possible outcome.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
// bd-2681 — this send never went through bd-2666's throttle at all (it isn't
// routed through video-quiz-sender.service.js's sendPhase()). It's the last
// message a completing quiz sends to the phone, so it can land right on top
// of an already-near-full window from the questions that preceded it.
const rateLimiter = require('./video-quiz-rate-limiter.service');

const TIER_LINE = {
  mastered: 'Brilliant work!',
  developing: "Nicely done — a little more practice and you'll have it.",
  needs_practice: 'Good effort — this one is worth another go.',
};

function tierFor(pct) {
  return pct >= 80 ? 'mastered' : pct >= 60 ? 'developing' : 'needs_practice';
}

function buildCaption({ correct, total, pct, stars }) {
  return `🎉 All done!\n\nYou got *${correct} out of ${total}* right (${pct}%). `
    + `You've earned ${stars} star${stars === 1 ? '' : 's'}!\n\n${TIER_LINE[tierFor(pct)]}`;
}

/** Pure render step — a PNG buffer, or null on failure. Testable without WhatsApp. */
async function renderScorecardImage({ topic, correct, total, pct, grade, subject, takerName }) {
  try {
    const renderHtml = require('../../templates/video-quiz-scorecard.template');
    const { htmlToImage } = require('../../utils/html-to-pdf');
    const html = renderHtml({ topic, correct, total, pct, grade, subject, takerName });
    const png = await htmlToImage(html, { width: 540, deviceScaleFactor: 2, selector: '.card' });
    return png || null;
  } catch (err) {
    logToFile('⚠️ video-quiz: scorecard render failed', { error: err.message });
    return null;
  }
}

/**
 * Render and send the scorecard. Returns true if the image sent, false if it
 * fell back (caller is expected to have already sent, or to send, the plain
 * text version — see finish() in video-quiz.service.js).
 */
async function sendScorecard(phone, { topic, correct, total, pct, grade, subject, takerName }) {
  const { starsAndBadge } = require('../../templates/video-quiz-scorecard.template');
  const { stars } = starsAndBadge(pct);
  const caption = buildCaption({ correct, total, pct, stars });

  const png = await renderScorecardImage({ topic, correct, total, pct, grade, subject, takerName });
  if (!png) return false;

  try {
    await rateLimiter.throttle(phone);
    const ok = await WhatsAppService.sendImageFromBuffer(phone, png, caption);
    return Boolean(ok);
  } catch (err) {
    logToFile('⚠️ video-quiz: scorecard send failed', { error: err.message });
    return false;
  }
}

module.exports = { renderScorecardImage, sendScorecard, buildCaption, tierFor };
