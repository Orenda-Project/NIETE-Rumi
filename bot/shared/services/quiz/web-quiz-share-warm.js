'use strict';
/**
 * Draw a finished child's share pictures as soon as the quiz finishes.
 *
 * WhatsApp builds a shared link's preview on the child's phone before the message goes; a picture not drawn yet
 * (a first draw takes 1-5 s) is a link sent without it. The scorecard used to warm its pictures only once it was
 * on screen. After a finish answers, this asks for the card and invite pictures and the challenge code's preview
 * facts all at once (web-quiz-art caps the renders). It never holds or fails the finish.
 */
const { logToFile } = require('../../utils/logger');

function afterFinish(out) {
  if (!out || !out.art) return;
  setImmediate(() => { warm(out).catch(() => {}); });
}

async function warm(out) {
  const WebQuizArt = require('./web-quiz-art');
  const jobs = [];
  // The challenge code's preview facts are a quiz load, not a render: learned alongside the pictures.
  if (out.challenge_code) {
    const WebQuiz = require('./web-quiz.service');
    jobs.push(require('./web-quiz-og').forCode(out.challenge_code, (c) => WebQuiz.getQuiz(c)).catch(() => {}));
  }
  // Both pictures are asked for at once; web-quiz-art keeps the renders to two at a time.
  // After the answer, never inside it: started during the finish, the draw's own reads slowed the answer by 0.2-0.5 s.
  // A card is new at its finish, so R2 cannot hold its picture yet and is not asked (fresh); an invite may exist.
  for (const [id, fresh] of [[out.art.card, true], [out.art.invite, false]]) {
    if (!id) continue;
    jobs.push(WebQuizArt.artImage(id, { size: 'og', fresh }).catch((e) => {
      logToFile('⚠️ web-quiz: share picture not drawn at finish', { kind: id.slice(0, 1), error: (e && e.message) || 'error' }, 'warn');
    }));
  }
  await Promise.all(jobs);
}

module.exports = { afterFinish, _warm: warm };
