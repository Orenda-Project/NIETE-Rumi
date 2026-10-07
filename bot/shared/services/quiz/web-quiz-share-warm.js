'use strict';
/**
 * Draw a finished child's share pictures as soon as the quiz finishes.
 *
 * WhatsApp builds a shared link's preview on the child's phone before the message goes; a picture not drawn yet
 * (a first draw takes 1-5 s) is a link sent without it. The scorecard used to warm its pictures only once it was
 * on screen. After a finish answers, this draws the card and invite pictures one after the other (one headless
 * render at a time) and learns the challenge code's preview facts. It never holds or fails the finish.
 */
const { logToFile } = require('../../utils/logger');

function afterFinish(out) {
  if (!out || !out.art) return;
  setImmediate(() => { warm(out).catch(() => {}); });
}

async function warm(out) {
  const WebQuizArt = require('./web-quiz-art');
  for (const id of [out.art.card, out.art.invite]) {
    if (!id) continue;
    try { await WebQuizArt.artImage(id, { size: 'og' }); } catch (e) {
      logToFile('⚠️ web-quiz: share picture not drawn at finish', { kind: id.slice(0, 1), error: (e && e.message) || 'error' }, 'warn');
    }
  }
  if (out.challenge_code) {
    const WebQuiz = require('./web-quiz.service');
    await require('./web-quiz-og').forCode(out.challenge_code, (c) => WebQuiz.getQuiz(c)).catch(() => {});
  }
}

module.exports = { afterFinish, _warm: warm };
