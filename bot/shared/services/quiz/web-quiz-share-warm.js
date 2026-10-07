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

/**
 * The card picture, started the moment its session is marked completed (from inside the finish, before the finish's
 * own answer is built: ~1.5-3 s earlier than afterFinish). A new card cannot be in R2, so R2 is not asked. afterFinish's
 * later ask for the same picture joins this draw (web-quiz-art keeps one draw per picture).
 */
function cardAtFinish(cardId) {
  if (!cardId) return;
  // Asked synchronously (not awaited): the draw is registered before anything else can ask for the same picture.
  try {
    require('./web-quiz-art').artImage(cardId, { size: 'og', fresh: true }).catch((e) => {
      logToFile('⚠️ web-quiz: share picture not drawn at finish', { kind: 'c', error: (e && e.message) || 'error' }, 'warn');
    });
  } catch (e) { /* the picture never decides the finish */ }
}

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
  for (const id of [out.art.card, out.art.invite]) {
    if (!id) continue;
    jobs.push(WebQuizArt.artImage(id, { size: 'og' }).catch((e) => {
      logToFile('⚠️ web-quiz: share picture not drawn at finish', { kind: id.slice(0, 1), error: (e && e.message) || 'error' }, 'warn');
    }));
  }
  await Promise.all(jobs);
}

module.exports = { afterFinish, cardAtFinish, _warm: warm };
