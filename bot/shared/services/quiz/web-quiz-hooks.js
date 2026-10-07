'use strict';
/**
 * Moments in a web-quiz session that other parts of the bot act on, without the quiz service requiring them.
 *
 * A leaf: it requires nothing first-party, so the quiz service can announce a moment (a session finished) and a
 * listener elsewhere (web-quiz-share-warm.js draws the card picture) can act on it, with no require cycle between
 * them. Listeners run synchronously when the moment is announced and must never throw into the caller.
 *
 *   'session_completed'  { cardId }   the session was just marked completed (cardId: its card picture's signed id)
 */
const { EventEmitter } = require('events');

const hooks = new EventEmitter();

function emit(name, payload) {
  try { hooks.emit(name, payload); } catch (_) { /* a listener never decides the quiz's own answer */ }
}

module.exports = { on: (name, fn) => hooks.on(name, fn), off: (name, fn) => hooks.off(name, fn), emit };
