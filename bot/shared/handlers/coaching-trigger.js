'use strict';
/**
 * Pure, dependency-free decision helper for the coaching hot-trigger.
 * Mirrors homework-trigger.js — kept separate from text-message.handler so it
 * is unit-testable without the handler's full dependency graph.
 *
 * bd-60080: there was no interceptor at all for a typed coaching command —
 * only the tapped ice-breaker chip and the numeric menu choice reached
 * `_handleClassroomCoachingChoice`. A typed "/coaching" fell through to
 * general chat, which always includes the teacher's own conversation
 * history, so any /coaching after her first in a session got answered as if
 * continuing her last classroom recording instead of asking for a new one
 * (DC tracker row 84).
 */

// Whole message "coaching" / "/coaching" (any case, optional stray whitespace
// around the slash, as real teachers type it), or the Urdu equivalent.
// Anchored so it never fires on a sentence that merely mentions coaching.
const COACHING_TRIGGER_RX = /^\s*\/?\s*(coaching|کوچنگ)\s*$/i;

/**
 * @returns {{match:boolean}}
 */
function evaluateCoachingTrigger({ messageBody }) {
  return { match: COACHING_TRIGGER_RX.test(String(messageBody || '')) };
}

module.exports = { COACHING_TRIGGER_RX, evaluateCoachingTrigger };
